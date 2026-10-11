/**
 * Development helper: fills a channel with SYNTHETIC analytics so the studio dashboard, the analytics page and
 * the benchmark have something to show.
 *
 *   pnpm exec tsx --env-file-if-exists=.env scripts/seed-demo-analytics.ts --channel=sara-cooks
 *   pnpm exec tsx --env-file-if-exists=.env scripts/seed-demo-analytics.ts --channel=sara-cooks --days=120 --views-per-day=300 --clear
 *   pnpm exec tsx --env-file-if-exists=.env scripts/seed-demo-analytics.ts --channel=sara-cooks --total=200000 --days=365 --clear   # benchmark
 *
 * Options
 *   --channel=<handle>     required: the channel that receives the events
 *   --days=<n>             how many Tehran days back (default 90, max 730)
 *   --views-per-day=<n>    average views per day at the start of the window (default 120; grows over the window)
 *   --total=<n>            scale the event counts so that about n view events are created (overrides --views-per-day)
 *   --create-videos=<n>    if the channel has no READY video, create n placeholder videos (no media files)
 *   --clear                delete this channel's earlier SEED view/follow events first (idempotent re-runs)
 *   --clear-only           delete them and stop (removes all synthetic analytics of the channel)
 *   --no-sync-counters     do not recompute Video.viewCount from the events afterwards
 *   --seed=<n>             random seed (default 20261011) — same seed, same data
 *   --force                allow running with NODE_ENV=production (never do this on a real site)
 *
 * HONESTY: every row is written with source = 'SEED', the analytics UI labels them ("نمونهٔ آزمایشی") and the monetization
 * eligibility ignores them. Likes and comments are NOT fabricated (they have no source column). Follow events do not
 * create Follow rows and do not change Channel.followerCount.
 */
import { db } from '../src/lib/db';
import { buildVideoSearchFields } from '../src/lib/persian';
import { newVideoId } from '../src/lib/ids';
import { dayKeyToInstant, enumerateDayKeys, addDaysToKey, todayKey } from '../src/lib/analytics/time';
import { jalaliWeekday } from '../src/lib/jalali';
import type { DeviceType } from '../src/generated/prisma/enums';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => args.includes(`--${name}`);
const int = (name: string, fallback: number, min: number, max: number): number => {
  const raw = opt(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer between ${min} and ${max}`);
  return n;
};

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, weighted: readonly (readonly [T, number])[]): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, weight] of weighted) {
    r -= weight;
    if (r <= 0) return value;
  }
  return weighted[weighted.length - 1]![0];
}

const DEVICES: readonly (readonly [DeviceType, number])[] = [
  ['MOBILE', 0.62],
  ['DESKTOP', 0.28],
  ['TABLET', 0.07],
  ['TV', 0.01],
  ['OTHER', 0.02],
];
const REFERRERS: readonly (readonly [string, number])[] = [
  ['direct', 0.38],
  ['internal', 0.27],
  ['google.com', 0.14],
  ['t.me', 0.08],
  ['instagram.com', 0.06],
  ['x.com', 0.04],
  ['youtube.com', 0.03],
];
/** Hour-of-day weights (Tehran): quiet at night, peak in the evening. */
const HOURS: readonly (readonly [number, number])[] = Array.from({ length: 24 }, (_, h) => {
  const weight = h < 6 ? 0.4 : h < 9 ? 1 : h < 17 ? 1.6 : h < 20 ? 2.2 : h < 24 ? 3 : 1;
  return [h, weight] as const;
});
/** Saturday = 0 … Friday = 6: the Iranian weekend (Thursday/Friday) is the busiest. */
const WEEKDAY_FACTOR = [1, 0.95, 0.9, 0.9, 0.95, 1.15, 1.3] as const;

/** Mirrors what the worker's reconcile job does: counters follow the events. */
async function syncCounters(channelId: string): Promise<void> {
  await db.$executeRaw`
    UPDATE "Video" v SET "viewCount" = (SELECT count(*) FROM "ViewEvent" e WHERE e."videoId" = v."id")
    WHERE v."channelId" = ${channelId}`;
}

async function main() {
  const handle = opt('channel');
  if (!handle) throw new Error('--channel=<handle> is required');
  if (process.env.NODE_ENV === 'production' && !flag('force')) {
    throw new Error('Refusing to write synthetic data with NODE_ENV=production (pass --force if you really mean it).');
  }
  const days = int('days', 90, 1, 730);
  const total = opt('total') ? int('total', 0, 1, 5_000_000) : null;
  const viewsPerDay = int('views-per-day', 120, 1, 100_000);
  const seed = int('seed', 20_261_011, 0, 2_147_483_647);
  const rand = rng(seed);

  const channel = await db.channel.findUnique({ where: { handle }, select: { id: true, name: true } });
  if (!channel) throw new Error(`No channel with handle "${handle}".`);

  if (flag('clear') || flag('clear-only')) {
    const [views, follows] = await Promise.all([
      db.viewEvent.deleteMany({ where: { channelId: channel.id, source: 'SEED' } }),
      db.followEvent.deleteMany({ where: { channelId: channel.id, source: 'SEED' } }),
    ]);
    console.log(`✔ cleared ${views.count} SEED view events and ${follows.count} SEED follow events`);
    if (flag('clear-only')) {
      if (!flag('no-sync-counters')) await syncCounters(channel.id);
      return;
    }
  }

  let videos = await db.video.findMany({
    where: { channelId: channel.id, processingStatus: 'READY' },
    select: { id: true, durationSeconds: true, publishedAt: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const toCreate = int('create-videos', 0, 0, 200);
  if (videos.length === 0 && toCreate > 0) {
    const today = todayKey();
    for (let i = 1; i <= toCreate; i++) {
      const title = `ویدیوی آزمایشی ${i}`;
      const publishedAt = new Date(dayKeyToInstant(addDaysToKey(today, -Math.floor(rand() * Math.max(days, 7)))).getTime() + 3_600_000 * 12);
      await db.video.create({
        data: {
          id: newVideoId(),
          channelId: channel.id,
          title,
          description: 'ویدیوی آزمایشی بدون فایل رسانه‌ای؛ فقط برای نمایش آمار.',
          durationSeconds: 60 + Math.floor(rand() * 840),
          width: 1280,
          height: 720,
          processingStatus: 'READY',
          publishStatus: 'PUBLISHED',
          visibility: 'PUBLIC',
          publishedAt,
          ...buildVideoSearchFields({ title, channelName: channel.name }),
        },
      });
    }
    console.log(`✔ created ${toCreate} placeholder videos (no media files)`);
    videos = await db.video.findMany({
      where: { channelId: channel.id, processingStatus: 'READY' },
      select: { id: true, durationSeconds: true, publishedAt: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  if (videos.length === 0) throw new Error(`Channel "${handle}" has no READY video. Upload one or pass --create-videos=<n>.`);

  // --- plan the number of views per Tehran day -------------------------------------------------------------
  const today = todayKey();
  const dayKeys = enumerateDayKeys(addDaysToKey(today, -(days - 1)), today);
  const nowMs = Date.now();
  const plan = dayKeys.map((key, i) => {
    const growth = 1 + (0.8 * i) / Math.max(1, dayKeys.length - 1);
    const weekday = WEEKDAY_FACTOR[jalaliWeekday(new Date(dayKeyToInstant(key).getTime() + 12 * 3_600_000))] ?? 1;
    const noise = 0.75 + rand() * 0.5;
    const elapsed = key === today ? Math.min(1, Math.max(0.05, (nowMs - dayKeyToInstant(key).getTime()) / 86_400_000)) : 1;
    return { key, weight: growth * weekday * noise * elapsed, growth, elapsed };
  });
  const baseTotal = total ?? Math.round(plan.reduce((s, p) => s + viewsPerDay * p.weight, 0));
  const weightSum = plan.reduce((s, p) => s + p.weight, 0);

  const viewerPool = Math.max(50, Math.round(baseTotal * 0.55));
  const videoWeights = videos.map((v, i) => [v, 1 / Math.pow(i + 1, 0.8)] as const);

  type ViewRow = {
    videoId: string;
    channelId: string;
    viewerKey: string;
    watchSeconds: number;
    device: DeviceType;
    referrer: string;
    source: 'SEED';
    createdAt: Date;
    lastBeatAt: Date;
  };
  type FollowRow = { channelId: string; type: 'FOLLOW' | 'UNFOLLOW'; source: 'SEED'; createdAt: Date };

  const BATCH = 5_000;
  let viewBuffer: ViewRow[] = [];
  let followBuffer: FollowRow[] = [];
  let insertedViews = 0;
  let insertedFollows = 0;
  const flushViews = async () => {
    if (viewBuffer.length === 0) return;
    await db.viewEvent.createMany({ data: viewBuffer });
    insertedViews += viewBuffer.length;
    viewBuffer = [];
  };
  const flushFollows = async () => {
    if (followBuffer.length === 0) return;
    await db.followEvent.createMany({ data: followBuffer });
    insertedFollows += followBuffer.length;
    followBuffer = [];
  };

  for (const day of plan) {
    const dayStart = dayKeyToInstant(day.key).getTime();
    const count = Math.round((baseTotal * day.weight) / weightSum);
    const published = videoWeights.filter(([v]) => (v.publishedAt ?? v.createdAt).getTime() <= dayStart + 86_400_000);
    const candidates = published.length > 0 ? published : videoWeights;

    for (let i = 0; i < count; i++) {
      const hour = pick(rand, HOURS);
      const offset = (hour * 3600 + Math.floor(rand() * 3600)) * 1000 + Math.floor(rand() * 1000);
      const at = Math.min(dayStart + offset, nowMs - 1_000);
      const video = pick(rand, candidates);
      const duration = video.durationSeconds ?? 120;
      const completed = rand() < 0.12;
      const watch = completed ? duration : Math.max(3, Math.round(duration * Math.pow(rand(), 1.6)));
      viewBuffer.push({
        videoId: video.id,
        channelId: channel.id,
        viewerKey: `vk_seed_${Math.floor(rand() * viewerPool).toString(36)}`,
        watchSeconds: watch,
        device: pick(rand, DEVICES),
        referrer: pick(rand, REFERRERS),
        source: 'SEED',
        createdAt: new Date(at),
        lastBeatAt: new Date(at),
      });
      if (viewBuffer.length >= BATCH) await flushViews();
    }

    const follows = Math.round((2 + rand() * 4) * day.growth * day.elapsed);
    const unfollows = Math.round(follows * (0.1 + rand() * 0.3));
    for (let i = 0; i < follows + unfollows; i++) {
      const at = Math.min(dayStart + Math.floor(rand() * 86_400_000), nowMs - 1_000);
      followBuffer.push({ channelId: channel.id, type: i < follows ? 'FOLLOW' : 'UNFOLLOW', source: 'SEED', createdAt: new Date(at) });
    }
    if (followBuffer.length >= BATCH) await flushFollows();
  }
  await flushViews();
  await flushFollows();

  if (!flag('no-sync-counters')) await syncCounters(channel.id);

  console.log(`✔ ${insertedViews} SEED view events and ${insertedFollows} SEED follow events for "${handle}" (${dayKeys[0]} … ${today}, seed ${seed})`);
  console.log(`  remove them again with:  --channel=${handle} --clear-only`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await db.$disconnect();
    process.exit(1);
  });
