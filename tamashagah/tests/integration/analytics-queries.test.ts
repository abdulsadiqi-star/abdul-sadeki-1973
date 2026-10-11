import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { resolveRange } from '@/lib/analytics/ranges';
import { instantToDayKey } from '@/lib/analytics/time';
import { getAnalyticsOverview, listVideoPerformance } from '@/features/analytics/queries';
import { tehranDayOf } from '@/features/analytics/sql';
import { createUser, createVideo } from '../helpers/factories';
import { addComment, addFollowEvent, addLike, addViews, mulberry32, oracleTehranDay } from '../helpers/insights-fixtures';

// 2026-10-11 23:00 in Tehran (19 Mehr 1405).
const NOW = new Date('2026-10-11T19:30:00.000Z');
const last7 = () => resolveRange({ preset: 'last7' }, NOW); // 2026-10-05 … 2026-10-11, previous 2026-09-28 … 2026-10-04

async function world() {
  const ownerA = await createUser({ withChannel: true });
  const ownerB = await createUser({ withChannel: true });
  const chA = ownerA.channel!;
  const chB = ownerB.channel!;
  const v1 = await createVideo(chA.id, { title: 'ویدیوی اول' });
  const v2 = await createVideo(chA.id, { title: 'ویدیوی دوم' });
  const vb = await createVideo(chB.id, { title: 'ویدیوی کانال دیگر' });
  const fans = await Promise.all([createUser(), createUser(), createUser()]);
  return { ownerA, ownerB, chA, chB, v1, v2, vb, fans };
}

/** The hand-computed fixture described in the expectations below. */
async function seedFixture(w: Awaited<ReturnType<typeof world>>) {
  const { chA, chB, v1, v2, vb, fans } = w;
  await addViews([
    { channelId: chA.id, videoId: v1.id, at: '2026-10-04T20:29:59.999Z', viewer: 'a', watch: 10 }, // Tehran 10-04 23:59 → previous period
    { channelId: chA.id, videoId: v1.id, at: '2026-10-04T20:30:00.000Z', viewer: 'a', watch: 20, device: 'MOBILE', referrer: 'direct' }, // 10-05 00:00 sharp
    { channelId: chA.id, videoId: v1.id, at: '2026-10-08T20:35:00.000Z', viewer: 'b', watch: 30, device: 'DESKTOP', referrer: 'google.com' }, // 10-09 00:05
    { channelId: chA.id, videoId: v2.id, at: '2026-10-08T20:29:00.000Z', viewer: 'a', watch: 40, device: 'MOBILE', referrer: 'google.com' }, // 10-08 23:59
    { channelId: chA.id, videoId: v2.id, at: '2026-10-09T10:00:00.000Z', viewer: 'c', watch: 60, device: 'TABLET', referrer: null, source: 'SEED' },
    { channelId: chA.id, videoId: v2.id, at: '2026-10-09T11:00:00.000Z', viewer: 'c', watch: 0, device: 'MOBILE', referrer: 'internal' },
    { channelId: chA.id, videoId: v1.id, at: '2026-10-11T19:00:00.000Z', viewer: 'd', watch: 5, device: 'OTHER', referrer: 'direct' },
    { channelId: chA.id, videoId: v1.id, at: '2026-10-11T20:30:00.000Z', viewer: 'e', watch: 100 }, // 10-12 00:00 sharp → after the range
    { channelId: chB.id, videoId: vb.id, at: '2026-10-09T10:00:00.000Z', viewer: 'z', watch: 1000 }, // someone else's channel
  ]);
  await addLike(fans[0]!.id, v1.id, '2026-10-08T20:35:00.000Z'); // 10-09
  await addLike(fans[1]!.id, v1.id, '2026-10-04T20:29:00.000Z'); // previous period
  await addLike(fans[2]!.id, v2.id, '2026-10-11T08:00:00.000Z'); // 10-11
  await addLike(fans[0]!.id, vb.id, '2026-10-09T10:00:00.000Z'); // other channel
  await addComment(v1.id, fans[0]!.id, '2026-10-09T10:00:00.000Z', 'APPROVED');
  await addComment(v1.id, fans[1]!.id, '2026-10-09T10:05:00.000Z', 'PENDING');
  await addComment(v2.id, fans[1]!.id, '2026-10-09T10:06:00.000Z', 'SPAM');
  await addComment(v2.id, fans[1]!.id, '2026-10-09T10:07:00.000Z', 'DELETED');
  await addComment(v2.id, fans[1]!.id, '2026-10-09T10:08:00.000Z', 'REJECTED');
  await addComment(v2.id, fans[2]!.id, '2026-10-10T20:31:00.000Z', 'APPROVED'); // 10-11 00:01 Tehran
  await addComment(vb.id, fans[0]!.id, '2026-10-09T10:00:00.000Z', 'APPROVED'); // other channel
  await addFollowEvent(chA.id, 'FOLLOW', '2026-10-05T10:00:00.000Z');
  await addFollowEvent(chA.id, 'FOLLOW', '2026-10-05T11:00:00.000Z', 'SEED');
  await addFollowEvent(chA.id, 'FOLLOW', '2026-10-08T20:40:00.000Z'); // 10-09 00:10
  await addFollowEvent(chA.id, 'UNFOLLOW', '2026-10-09T09:00:00.000Z');
  await addFollowEvent(chA.id, 'UNFOLLOW', '2026-10-04T20:20:00.000Z'); // previous period
  await addFollowEvent(chB.id, 'FOLLOW', '2026-10-06T10:00:00.000Z'); // other channel
  await db.channel.update({ where: { id: chA.id }, data: { followerCount: 42 } });
  await db.follow.createMany({
    data: [
      { userId: fans[0]!.id, channelId: chA.id, notify: true },
      { userId: fans[1]!.id, channelId: chA.id, notify: false },
      { userId: fans[2]!.id, channelId: chB.id, notify: true },
    ],
  });
}

describe('analytics overview — exact figures from the database', () => {
  it('computes totals, series, comparison, cards and breakdowns for a channel', async () => {
    const w = await world();
    await seedFixture(w);
    const o = await getAnalyticsOverview({ channelId: w.chA.id }, last7(), NOW);

    // range metadata
    expect(o.video).toBeNull();
    expect(o.range).toMatchObject({ fromKey: '2026-10-05', toKey: '2026-10-11', days: 7, granularity: 'day' });
    expect(o.range.previous).toMatchObject({ fromKey: '2026-09-28', toKey: '2026-10-04', days: 7 });

    // gap-filled daily series: seven points, quiet days are zeros
    expect(o.series.map((p) => p.key)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(o.series.map((p) => p.views)).toEqual([1, 0, 0, 1, 3, 0, 1]);
    expect(o.series.map((p) => p.uniqueViewers)).toEqual([1, 0, 0, 1, 2, 0, 1]);
    expect(o.series.map((p) => p.watchSeconds)).toEqual([20, 0, 0, 40, 90, 0, 5]);
    expect(o.series.map((p) => p.seedViews)).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(o.series.map((p) => p.likes)).toEqual([0, 0, 0, 0, 1, 0, 1]);
    expect(o.series.map((p) => p.comments)).toEqual([0, 0, 0, 0, 1, 0, 1]); // the 20:31 UTC comment is on 10-11 in Tehran
    expect(o.series.map((p) => p.newFollowers)).toEqual([2, 0, 0, 0, 1, 0, 0]);
    expect(o.series.map((p) => p.unfollows)).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(o.series.map((p) => p.netFollowers)).toEqual([2, 0, 0, 0, 0, 0, 0]);

    // period totals: unique viewers are distinct over the WHOLE period (a, b, c, d), not 1+1+2+1
    expect(o.totals).toMatchObject({
      views: 6,
      uniqueViewers: 4,
      watchSeconds: 155,
      likes: 2,
      comments: 2,
      newFollowers: 3,
      unfollows: 1,
      netFollowers: 2,
    });
    expect(o.totals.avgViewSeconds).toBeCloseTo(155 / 6, 10);

    // previous period (09-28 … 10-04) and the % change against it
    expect(o.previous).toMatchObject({ views: 1, uniqueViewers: 1, watchSeconds: 10, likes: 1, comments: 0, newFollowers: 0, unfollows: 1, netFollowers: -1 });
    expect(o.changes).toMatchObject({
      views: 500,
      uniqueViewers: 300,
      watchSeconds: 1450,
      avgViewSeconds: 158.3,
      likes: 100,
      comments: null, // nothing to compare with
      newFollowers: null,
      netFollowers: 300, // −1 → +2 is an improvement of 3 on a base of 1
    });

    // provenance of the rows inside the range
    expect(o.data).toEqual({ views: { real: 5, seed: 1 }, followEvents: { real: 3, seed: 1 } });

    // cards (independent of the range): today = 10-11, this month = Mehr 1405 (since 2026-09-23)
    expect(o.cards).toEqual({
      todayViews: 1,
      monthViews: 7,
      seedToday: false,
      seedMonth: true,
      followers: 42,
      notifySubscribers: 1,
    });

    // breakdowns (range only)
    expect(o.devices).toEqual([
      { device: 'MOBILE', views: 3 },
      { device: 'DESKTOP', views: 1 },
      { device: 'OTHER', views: 1 },
      { device: 'TABLET', views: 1 },
    ]);
    expect(o.sources).toEqual([
      { source: 'direct', views: 3 }, // 2 × 'direct' + 1 NULL referrer
      { source: 'google.com', views: 2 },
      { source: 'internal', views: 1 },
    ]);
    const top = Object.fromEntries(o.topVideos.map((t) => [t.id, t]));
    expect(Object.keys(top)).toHaveLength(2);
    expect(top[w.v1.id]).toMatchObject({ title: 'ویدیوی اول', views: 3, watchSeconds: 55 });
    expect(top[w.v2.id]).toMatchObject({ title: 'ویدیوی دوم', views: 3, watchSeconds: 100 });
  });

  it('never mixes in another channel (even when the other channel is the only one with data)', async () => {
    const w = await world();
    await addViews([{ channelId: w.chB.id, videoId: w.vb.id, at: '2026-10-09T10:00:00.000Z', watch: 500 }]);
    await addLike(w.fans[0]!.id, w.vb.id, '2026-10-09T10:00:00.000Z');
    await addFollowEvent(w.chB.id, 'FOLLOW', '2026-10-09T10:00:00.000Z');
    const o = await getAnalyticsOverview({ channelId: w.chA.id }, last7(), NOW);
    expect(o.totals).toMatchObject({ views: 0, uniqueViewers: 0, watchSeconds: 0, likes: 0, comments: 0, newFollowers: 0, unfollows: 0, avgViewSeconds: 0 });
    expect(o.series).toHaveLength(7);
    expect(o.series.every((p) => p.views === 0 && p.likes === 0 && p.newFollowers === 0)).toBe(true);
    expect(o.devices).toEqual([]);
    expect(o.sources).toEqual([]);
    expect(o.topVideos).toEqual([]);
    expect(o.cards).toMatchObject({ todayViews: 0, monthViews: 0 });
    expect(o.changes.views).toBe(0); // 0 → 0
  });

  it('puts an event at 20:35 UTC on the NEXT Tehran day, and flips exactly at 20:30:00.000', async () => {
    const w = await world();
    const at = (iso: string, viewer: string) => ({ channelId: w.chA.id, videoId: w.v1.id, at: iso, viewer });
    await addViews([
      at('2026-10-07T20:29:59.999Z', 'a'), // 10-07 23:59:59.999
      at('2026-10-07T20:30:00.000Z', 'b'), // 10-08 00:00:00.000
      at('2026-10-07T20:35:00.000Z', 'c'), // 10-08 00:05
      at('2026-10-08T20:29:59.999Z', 'd'), // 10-08 23:59:59.999
      at('2026-10-08T20:30:00.000Z', 'e'), // 10-09 00:00:00.000
    ]);
    const o = await getAnalyticsOverview({ channelId: w.chA.id }, last7(), NOW);
    const byDay = Object.fromEntries(o.series.map((p) => [p.key, p.views]));
    expect(byDay['2026-10-07']).toBe(1);
    expect(byDay['2026-10-08']).toBe(3);
    expect(byDay['2026-10-09']).toBe(1);
  });

  it('keeps the SQL bucketing identical to an independent time-zone oracle on hundreds of instants', async () => {
    const rand = mulberry32(7);
    const instants: Date[] = [];
    for (let i = 0; i < 400; i++) instants.push(new Date(Date.parse('2026-01-01T00:00:00Z') + Math.floor(rand() * 365 * 86_400_000)));
    // plus every boundary neighbourhood of the 3 busiest weeks
    for (let d = 0; d < 21; d++) {
      const midnight = Date.parse('2026-10-01T20:30:00Z') + d * 86_400_000;
      instants.push(new Date(midnight - 1), new Date(midnight), new Date(midnight + 1));
    }
    const rows = await db.$queryRaw<{ ms: number; day: string }[]>`
      SELECT (extract(epoch from e."createdAt" AT TIME ZONE 'UTC') * 1000)::float8 AS ms, ${tehranDayOf('e."createdAt"')} AS day
      FROM (SELECT (unnest(${instants.map((d) => d.toISOString())}::timestamptz[]) AT TIME ZONE 'UTC') AS "createdAt") e`;
    expect(rows).toHaveLength(instants.length);
    for (const row of rows) {
      const instant = new Date(row.ms);
      expect(row.day).toBe(oracleTehranDay(instant));
      expect(row.day).toBe(instantToDayKey(instant)); // and the JS helper used for ranges agrees too
    }
  });
});

describe('analytics overview — one video', () => {
  it('narrows every metric to the video and drops channel-level figures', async () => {
    const w = await world();
    await seedFixture(w);
    const o = await getAnalyticsOverview({ channelId: w.chA.id, videoId: w.v1.id }, last7(), NOW);
    expect(o.video).toEqual({ id: w.v1.id, title: 'ویدیوی اول' });
    expect(o.totals).toMatchObject({ views: 3, uniqueViewers: 3, watchSeconds: 55, likes: 1, comments: 1, newFollowers: 0, unfollows: 0 });
    expect(o.series.map((p) => p.views)).toEqual([1, 0, 0, 0, 1, 0, 1]);
    expect(o.devices).toEqual([
      { device: 'DESKTOP', views: 1 },
      { device: 'MOBILE', views: 1 },
      { device: 'OTHER', views: 1 },
    ]);
    expect(o.topVideos).toEqual([]);
    expect(o.cards.followers).toBeNull();
    expect(o.cards.notifySubscribers).toBeNull();
    expect(o.cards).toMatchObject({ todayViews: 1, monthViews: 4 }); // e1, e2, e3, e7 of v1 since 2026-09-23
  });

  it('answers NOT_FOUND for a video of another channel and for unknown ids (never leaks existence)', async () => {
    const w = await world();
    await seedFixture(w);
    await expect(getAnalyticsOverview({ channelId: w.chA.id, videoId: w.vb.id }, last7(), NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getAnalyticsOverview({ channelId: w.chA.id, videoId: 'doesNotExist' }, last7(), NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // the foreign owner can of course read their own
    await expect(getAnalyticsOverview({ channelId: w.chB.id, videoId: w.vb.id }, last7(), NOW)).resolves.toMatchObject({ totals: { views: 1 } });
  });
});

describe('seed vs real data', () => {
  it('reports SEED rows only when they fall inside the range', async () => {
    const w = await world();
    await addViews([
      { channelId: w.chA.id, videoId: w.v1.id, at: '2026-10-09T10:00:00.000Z', viewer: 'r1' },
      { channelId: w.chA.id, videoId: w.v1.id, at: '2026-08-01T10:00:00.000Z', viewer: 's1', source: 'SEED' }, // long before the range
    ]);
    const inRange = await getAnalyticsOverview({ channelId: w.chA.id }, last7(), NOW);
    expect(inRange.data).toEqual({ views: { real: 1, seed: 0 }, followEvents: { real: 0, seed: 0 } });
    expect(inRange.cards).toMatchObject({ seedToday: false, seedMonth: false });

    await addViews([{ channelId: w.chA.id, videoId: w.v1.id, at: '2026-10-10T10:00:00.000Z', viewer: 's2', source: 'SEED' }]);
    await addFollowEvent(w.chA.id, 'FOLLOW', '2026-10-10T10:00:00.000Z', 'SEED');
    const after = await getAnalyticsOverview({ channelId: w.chA.id }, last7(), NOW);
    expect(after.data).toEqual({ views: { real: 1, seed: 1 }, followEvents: { real: 0, seed: 1 } });
    expect(after.cards.seedMonth).toBe(true);

    // the earlier SEED row shows up when (and only when) its own range is selected
    const august = await getAnalyticsOverview({ channelId: w.chA.id }, resolveRange({ preset: 'custom', from: '2026-07-30', to: '2026-08-02' }, NOW), NOW);
    expect(august.data.views).toEqual({ real: 0, seed: 1 });
  });
});

describe('monthly granularity (Jalali months)', () => {
  it('sums additive metrics per month and counts distinct viewers per month', async () => {
    const w = await world();
    const ev = (iso: string, viewer: string, watch = 10) => ({ channelId: w.chA.id, videoId: w.v1.id, at: iso, viewer, watch });
    await addViews([
      ev('2026-09-22T10:00:00.000Z', 'x'), // 22 Shahrivar
      ev('2026-09-22T20:29:59.999Z', 'y'), // 22 Shahrivar 23:59:59.999
      ev('2026-09-22T20:30:00.000Z', 'x'), // 1 Mehr 00:00 sharp — the Jalali month flips at Tehran midnight
      ev('2026-10-02T10:00:00.000Z', 'x'),
      ev('2026-10-03T10:00:00.000Z', 'z'),
    ]);
    const range = resolveRange({ preset: 'custom', from: '2026-09-20', to: '2026-10-05', granularity: 'month' }, NOW);
    const o = await getAnalyticsOverview({ channelId: w.chA.id }, range, NOW);
    expect(o.series.map((p) => [p.key, p.fromKey, p.toKey])).toEqual([
      ['1405-06', '2026-09-20', '2026-09-22'],
      ['1405-07', '2026-09-23', '2026-10-05'],
    ]);
    expect(o.series[0]).toMatchObject({ views: 2, uniqueViewers: 2, watchSeconds: 20 }); // x, y
    expect(o.series[1]).toMatchObject({ views: 3, uniqueViewers: 2, watchSeconds: 30 }); // x, z — x repeats within the month
    expect(o.totals).toMatchObject({ views: 5, uniqueViewers: 3 }); // x, y, z over the whole period
  });
});

describe('randomized check against an independent oracle', () => {
  it('matches a JS re-implementation on 700 random events over 45 days', async () => {
    const w = await world();
    const rand = mulberry32(20261011);
    const videos = [w.v1, w.v2];
    const devices = ['DESKTOP', 'MOBILE', 'TABLET', 'TV', 'OTHER'] as const;
    const referrers = ['direct', 'google.com', 't.me', 'internal', null] as const;
    const start = Date.parse('2026-08-20T00:00:00Z');
    const events = Array.from({ length: 700 }, () => ({
      channelId: w.chA.id,
      videoId: videos[Math.floor(rand() * videos.length)]!.id,
      at: new Date(start + Math.floor(rand() * 52 * 86_400_000)),
      viewer: `v${Math.floor(rand() * 60)}`,
      watch: Math.floor(rand() * 600),
      device: devices[Math.floor(rand() * devices.length)]!,
      referrer: referrers[Math.floor(rand() * referrers.length)]!,
      source: rand() < 0.2 ? ('SEED' as const) : ('REAL' as const),
    }));
    await addViews(events);

    const range = resolveRange({ preset: 'last30' }, NOW); // 2026-09-12 … 2026-10-11
    const o = await getAnalyticsOverview({ channelId: w.chA.id }, range, NOW);

    const inRange = events.filter((e) => {
      const day = oracleTehranDay(e.at);
      return day >= range.fromKey && day <= range.toKey;
    });
    const byDay = new Map<string, typeof inRange>();
    for (const e of inRange) byDay.set(oracleTehranDay(e.at), [...(byDay.get(oracleTehranDay(e.at)) ?? []), e]);

    for (const point of o.series) {
      const rows = byDay.get(point.key) ?? [];
      expect(point.views, point.key).toBe(rows.length);
      expect(point.uniqueViewers, point.key).toBe(new Set(rows.map((r) => r.viewer)).size);
      expect(point.watchSeconds, point.key).toBe(rows.reduce((s, r) => s + r.watch, 0));
      expect(point.seedViews, point.key).toBe(rows.filter((r) => r.source === 'SEED').length);
    }
    expect(o.totals.views).toBe(inRange.length);
    expect(o.totals.uniqueViewers).toBe(new Set(inRange.map((r) => r.viewer)).size);
    expect(o.totals.watchSeconds).toBe(inRange.reduce((s, r) => s + r.watch, 0));
    expect(o.data.views).toEqual({
      real: inRange.filter((r) => r.source === 'REAL').length,
      seed: inRange.filter((r) => r.source === 'SEED').length,
    });

    const deviceCounts = new Map<string, number>();
    for (const r of inRange) deviceCounts.set(r.device, (deviceCounts.get(r.device) ?? 0) + 1);
    expect(Object.fromEntries(o.devices.map((d) => [d.device, d.views]))).toEqual(Object.fromEntries(deviceCounts));
    expect(o.sources.reduce((s, r) => s + r.views, 0)).toBe(inRange.length); // top sources + "other" always add up

    const perVideo = new Map<string, number>();
    for (const r of inRange) perVideo.set(r.videoId, (perVideo.get(r.videoId) ?? 0) + 1);
    for (const t of o.topVideos) expect(t.views).toBe(perVideo.get(t.id));
  });
});

describe('per-video performance table', () => {
  async function tableWorld() {
    const w = await world();
    const quiet = await createVideo(w.chA.id, { title: 'ویدیوی بی‌بازدید' });
    await createVideo(w.chA.id, { state: 'processing', title: 'در حال پردازش' }); // still counts: it is a real video
    // an abandoned upload placeholder must not appear
    await db.video.update({ where: { id: (await createVideo(w.chA.id, { title: 'ناتمام' })).id }, data: { processingStatus: 'AWAITING_UPLOAD' } });
    await seedFixture(w);
    return { ...w, quiet };
  }

  it('lists only this channel\'s videos with range-scoped metrics, zero rows included', async () => {
    const w = await tableWorld();
    const page = await listVideoPerformance(w.chA.id, last7(), { sort: 'views', dir: 'desc', pageSize: 50 });
    expect(page.total).toBe(4); // v1, v2, quiet, processing (not the abandoned upload, not the other channel's)
    const byId = Object.fromEntries(page.rows.map((r) => [r.id, r]));
    expect(byId[w.v1.id]).toMatchObject({ views: 3, uniqueViewers: 3, watchSeconds: 55, likes: 1, comments: 1 });
    expect(byId[w.v1.id]!.avgViewSeconds).toBeCloseTo(55 / 3, 10);
    expect(byId[w.v2.id]).toMatchObject({ views: 3, uniqueViewers: 2, watchSeconds: 100, likes: 1, comments: 1 });
    expect(byId[w.quiet.id]).toMatchObject({ views: 0, watchSeconds: 0, avgViewSeconds: 0, likes: 0, comments: 0 });
    expect(page.rows.some((r) => r.id === w.vb.id)).toBe(false);
  });

  it('sorts (with a stable id tie-breaker) and paginates', async () => {
    const w = await tableWorld();
    const byViewsDesc = await listVideoPerformance(w.chA.id, last7(), { sort: 'views', dir: 'desc', pageSize: 50 });
    expect(byViewsDesc.rows.map((r) => r.views)).toEqual([3, 3, 0, 0]);
    const byViewsAsc = await listVideoPerformance(w.chA.id, last7(), { sort: 'views', dir: 'asc', pageSize: 50 });
    expect(byViewsAsc.rows.map((r) => r.views)).toEqual([0, 0, 3, 3]);

    const byWatch = await listVideoPerformance(w.chA.id, last7(), { sort: 'watch', dir: 'desc', pageSize: 50 });
    expect(byWatch.rows[0]!.id).toBe(w.v2.id); // 100 s beats 55 s
    const byAvg = await listVideoPerformance(w.chA.id, last7(), { sort: 'avg', dir: 'desc', pageSize: 50 });
    expect(byAvg.rows[0]!.id).toBe(w.v2.id); // 100/3 = 33.3 beats 55/3 = 18.3
    const byTitle = await listVideoPerformance(w.chA.id, last7(), { sort: 'title', dir: 'asc', pageSize: 50 });
    expect(byTitle.rows.map((r) => r.title)).toEqual([...byTitle.rows.map((r) => r.title)].sort((a, b) => a.localeCompare(b, 'fa')));

    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await listVideoPerformance(w.chA.id, last7(), { sort: 'views', dir: 'desc', pageSize: 2, page }));
    expect(pages.map((p) => p.rows.length)).toEqual([2, 2, 2]); // the third request is clamped to the last page
    const ids = pages.slice(0, 2).flatMap((p) => p.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(4); // no row twice, none missing
    expect(pages[0]).toMatchObject({ total: 4, pageCount: 2, page: 1 });
    // a page beyond the end is clamped to the last page instead of returning nothing
    expect(pages[2]).toMatchObject({ page: 2 });
  });
});

describe('empty channel', () => {
  it('returns a complete zero series so the UI can draw an empty chart', async () => {
    const owner = await createUser({ withChannel: true });
    const o = await getAnalyticsOverview({ channelId: owner.channel!.id }, resolveRange({ preset: 'last30' }, NOW), NOW);
    expect(o.series).toHaveLength(30);
    expect(o.totals.views).toBe(0);
    expect(o.data).toEqual({ views: { real: 0, seed: 0 }, followEvents: { real: 0, seed: 0 } });
    expect(o.cards).toMatchObject({ todayViews: 0, monthViews: 0, followers: 0, notifySubscribers: 0 });
    const table = await listVideoPerformance(owner.channel!.id, resolveRange({ preset: 'last30' }, NOW));
    expect(table).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1 });
  });
});
