/**
 * `pnpm seed:media` — demo videos for the demo creators, made the same way real ones are:
 *
 *   generated clip (ffmpeg `lavfi`, no copyrighted media)
 *     → upload record + source object in storage (the service layer the tus hooks use)
 *     → studio metadata (the same code path as the edit form)
 *     → queue → worker pipeline (ffprobe, HLS renditions, thumbnails) → READY / FAILED
 *
 * Nothing is faked: durations, renditions and posters come out of ffmpeg, FAILED comes from a really corrupt file,
 * and view / like / comment counters stay at zero. Only `createdAt` / `publishedAt` are moved back in time so the
 * studio lists have a realistic spread of dates.
 *
 * Needs: migrated database + `pnpm db:seed` (demo accounts), Redis, ffmpeg. If no worker is attached to the queue the
 * script runs the pipeline in-process for each video (identical code to the worker).
 * Safe to run again: a video whose title already exists on the channel is skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/lib/db';
import { closeQueues, getQueue } from '../src/lib/queue';
import { getStorage, keys } from '../src/lib/storage';
import { newVideoId } from '../src/lib/ids';
import { completeUpload, createAwaitingUpload } from '../src/features/uploads/service';
import { updateVideoMetadata } from '../src/features/videos-studio/service';
import { videoMetadataSchema } from '../src/features/videos-studio/schemas';
import { processVideo } from '../worker/pipeline/process-video';
import type { FixtureName } from './make-test-video.mjs';

type Demo = {
  channel: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  clip: FixtureName;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  /** `draft`: stays unpublished; `scheduled`: publishes in two days; default: published. */
  state?: 'draft' | 'scheduled';
  daysAgo: number;
};

const DEMOS: Demo[] = [
  { channel: 'sara-cooks', title: 'خورش قیمه‌ی مجلسی؛ دستور کامل', description: 'مواد لازم، زمان پخت و نکته‌های طعم‌دار شدن خورش قیمه.', tags: ['آشپزی', 'خورش', 'قیمه'], category: 'cooking', clip: 'landscape-1080p', daysAgo: 21 },
  { channel: 'sara-cooks', title: 'املت اسفناج در ۱۰ دقیقه', description: 'صبحانه‌ی سریع و سالم.', tags: ['صبحانه', 'املت'], category: 'cooking', clip: 'portrait-short', daysAgo: 9 },
  { channel: 'sara-cooks', title: 'کیک یزدی با دستور خانگی', description: 'کیک کوچک و خوشمزه برای مهمانی.', tags: ['کیک', 'دسر'], category: 'cooking', clip: 'landscape-720p', visibility: 'UNLISTED', daysAgo: 6 },
  { channel: 'sara-cooks', title: 'منوی مهمانی آخر هفته (پیش‌نویس)', description: 'هنوز آماده‌ی انتشار نیست.', tags: ['منو'], category: 'cooking', clip: 'landscape-720p', state: 'draft', daysAgo: 2 },
  { channel: 'arman-tech', title: 'بررسی یک گوشی میان‌رده؛ ارزش خرید دارد؟', description: 'نمایشگر، باتری و دوربین در یک نگاه.', tags: ['گوشی', 'بررسی'], category: 'technology', clip: 'landscape-1080p', daysAgo: 14 },
  { channel: 'arman-tech', title: 'آموزش تایپ‌اسکریپت از صفر', description: 'قسمت اول: نوع‌ها و رابط‌ها.', tags: ['تایپ‌اسکریپت', 'برنامه‌نویسی'], category: 'education', clip: 'landscape-720p', daysAgo: 5 },
  { channel: 'arman-tech', title: 'معرفی دستگاه جدید (انتشار زمان‌بندی‌شده)', description: 'دو روز دیگر منتشر می‌شود.', tags: ['معرفی'], category: 'technology', clip: 'landscape-360p', state: 'scheduled', daysAgo: 1 },
  { channel: 'arman-tech', title: 'فایل ناقص برای آزمایش خطا', description: 'این فایل عمداً خراب است تا وضعیت «ناموفق» دیده شود.', tags: [], category: 'technology', clip: 'corrupt', daysAgo: 1 },
  { channel: 'nika-travel', title: 'اصفهان در یک روز؛ مسیر پیشنهادی', description: 'میدان نقش جهان، سی‌وسه‌پل و بازار.', tags: ['اصفهان', 'سفر'], category: 'travel', clip: 'landscape-1080p', daysAgo: 30 },
  { channel: 'nika-travel', title: 'سفر به شمال؛ جاده‌ی چالوس', description: 'از تهران تا ساحل.', tags: ['شمال', 'جاده'], category: 'travel', clip: 'landscape-720p', daysAgo: 12 },
  { channel: 'nika-travel', title: 'آلبوم خصوصی سفر', description: 'فقط برای خودم.', tags: [], category: 'travel', clip: 'landscape-360p', visibility: 'PRIVATE', daysAgo: 3 },
];

const FIXTURE_DIR = path.resolve('.data/fixtures');
const OPEN_LIMITS = { maxBytes: 2 ** 40, maxPerDay: 10_000, dailyQuotaBytes: 2 ** 45 };
const DAY = 24 * 3_600_000;

async function waitForFinal(videoId: string, timeoutMs = 10 * 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await db.video.findUnique({ where: { id: videoId }, select: { processingStatus: true } });
    if (!row) return 'MISSING';
    if (row.processingStatus === 'READY' || row.processingStatus === 'FAILED') return row.processingStatus;
    if (Date.now() > deadline) return 'TIMEOUT';
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function main() {
  const queue = getQueue('video');
  const embedded = (await queue.getWorkers()).length === 0;
  console.log(embedded ? 'No worker attached: processing in-process.' : 'A worker is attached: waiting for it to process each video.');

  // Dynamic import: the generator is an ES module with top-level await, this script runs as CommonJS under tsx.
  const { generateFixture } = await import('./make-test-video.mjs');
  const clips = new Map<FixtureName, string>();
  for (const name of new Set(DEMOS.map((d) => d.clip))) clips.set(name, await generateFixture(name, { dir: FIXTURE_DIR, seconds: 6 }));

  const storage = getStorage();
  const categories = new Map((await db.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
  const summary: Record<string, number> = {};

  for (const demo of DEMOS) {
    const channel = await db.channel.findUnique({ where: { handle: demo.channel }, select: { id: true, name: true, ownerId: true, defaultVisibility: true } });
    if (!channel) {
      console.warn(`✖ channel ${demo.channel} not found — run \`pnpm db:seed\` first`);
      continue;
    }
    if (await db.video.findFirst({ where: { channelId: channel.id, title: demo.title }, select: { id: true } })) {
      console.log(`· ${demo.title} (already there)`);
      continue;
    }
    const owner = await db.user.findUniqueOrThrow({ where: { id: channel.ownerId }, select: { id: true, role: true } });
    const actor = { id: owner.id, role: owner.role, channelId: channel.id, emailVerified: true };

    const file = clips.get(demo.clip)!;
    const stat = fs.statSync(file);
    const videoId = newVideoId();
    await createAwaitingUpload(
      { videoId, channelId: channel.id, channelName: channel.name, defaultVisibility: channel.defaultVisibility, filename: `${demo.clip}.mp4`, mime: 'video/mp4', size: stat.size },
      OPEN_LIMITS,
    );
    await storage.put(keys.upload(videoId), fs.createReadStream(file), { contentType: 'video/mp4' });

    // The same call the studio form makes: records title, tags, visibility and the publish intent (also while processing).
    const scheduledFor = demo.state === 'scheduled' ? new Date(Date.now() + 2 * DAY) : null;
    await updateVideoMetadata(
      actor,
      videoId,
      videoMetadataSchema.parse({
        title: demo.title,
        description: demo.description,
        tags: demo.tags,
        categoryId: categories.get(demo.category) ?? null,
        visibility: demo.visibility ?? 'PUBLIC',
        publishMode: demo.state === 'draft' ? 'DRAFT' : scheduledFor ? 'SCHEDULE' : 'PUBLISH',
        scheduledFor: scheduledFor?.toISOString() ?? null,
        commentsEnabled: true,
        language: 'fa',
        kindChoice: 'auto',
      }),
    );

    const result = await completeUpload(videoId);
    if (result !== 'queued') throw new Error(`upload of "${demo.title}" was not queued (${result})`);

    let status: string;
    if (embedded) {
      const job = await db.transcodeJob.findFirst({ where: { videoId }, orderBy: { createdAt: 'desc' }, select: { queueJobId: true } });
      if (job?.queueJobId) await queue.remove(job.queueJobId).catch(() => undefined); // the in-process run replaces the queued job
      const outcome = await processVideo(videoId, { attempt: 1, maxAttempts: 1, queueJobId: job?.queueJobId ?? null });
      status = outcome.status === 'ready' ? 'READY' : outcome.status === 'failed' ? 'FAILED' : outcome.status;
    } else {
      status = await waitForFinal(videoId);
    }

    // Spread the dates (the only thing that is not "as it really happened").
    const created = new Date(Date.now() - demo.daysAgo * DAY);
    const row = await db.video.findUnique({ where: { id: videoId }, select: { publishedAt: true } });
    await db.video.update({ where: { id: videoId }, data: { createdAt: created, ...(row?.publishedAt ? { publishedAt: created } : {}) } });

    summary[status] = (summary[status] ?? 0) + 1;
    console.log(`${status === 'READY' ? '✔' : status === 'FAILED' ? '!' : '?'} ${demo.channel}: ${demo.title} → ${status}`);
  }

  console.log('Done:', summary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues().catch(() => undefined);
    await db.$disconnect();
    process.exit();
  });
