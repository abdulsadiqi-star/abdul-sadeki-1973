import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  getContinueWatching,
  getFollowedLatest,
  getHomeFeed,
  getPersonalizedFeed,
  getRelatedVideos,
  getTrendingVideoIds,
  getTrendingVideos,
  hydrateCards,
} from '@/features/recommendations';
import { createCategory, createChannel, createUser, createVideo } from '../helpers/factories';
import { addLikes, addViews, daysAgoDate, follow, watch } from '../support/discovery';

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

async function channelWith(name: string) {
  const owner = await createUser({ withChannel: true, displayName: name });
  return { owner, channel: owner.channel! };
}

describe('getRelatedVideos', () => {
  it('ranks same-category / shared-tag videos first and never includes the source video', async () => {
    const cooking = await createCategory('cooking', 'آشپزی');
    const tech = await createCategory('tech', 'فناوری');
    const { channel: a } = await channelWith('الف');
    const { channel: b } = await channelWith('ب');
    const source = await createVideo(a.id, { title: 'قورمه‌سبزی', categoryId: cooking.id, tags: ['غذا', 'ایرانی'] });
    const sibling = await createVideo(b.id, { title: 'کوکو سبزی', categoryId: cooking.id, tags: ['غذا'] });
    const unrelated = await createVideo(b.id, { title: 'نقد گوشی', categoryId: tech.id, tags: ['گجت'], viewCount: 50 });

    const related = ids(await getRelatedVideos(source.id));
    expect(related).not.toContain(source.id);
    expect(related.indexOf(sibling.id)).toBeLessThan(related.indexOf(unrelated.id));
  });

  it('only returns public videos of the same kind (hidden states and shorts never leak)', async () => {
    const { channel } = await channelWith('الف');
    const { channel: suspended } = await channelWith('معلق');
    await db.channel.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });
    const source = await createVideo(channel.id, { title: 'مبدأ', tags: ['x'] });
    const visible = await createVideo(channel.id, { title: 'قابل نمایش', tags: ['x'] });
    const hidden = await Promise.all([
      createVideo(channel.id, { state: 'private', tags: ['x'] }),
      createVideo(channel.id, { state: 'unlisted', tags: ['x'] }),
      createVideo(channel.id, { state: 'draft', tags: ['x'] }),
      createVideo(channel.id, { state: 'processing', tags: ['x'] }),
      createVideo(channel.id, { state: 'failed', tags: ['x'] }),
      createVideo(channel.id, { state: 'scheduled', tags: ['x'] }),
      createVideo(channel.id, { state: 'takedown', tags: ['x'] }),
      createVideo(suspended.id, { title: 'از کانال معلق', tags: ['x'] }),
      createVideo(channel.id, { kind: 'SHORT', tags: ['x'] }),
    ]);
    const related = ids(await getRelatedVideos(source.id, { limit: 50 }));
    expect(related).toContain(visible.id);
    for (const h of hidden) expect(related).not.toContain(h.id);
  });

  it('caps videos per channel but back-fills a small catalogue so the list is not empty', async () => {
    const { channel: a } = await channelWith('الف');
    const { channel: b } = await channelWith('ب');
    const source = await createVideo(a.id, { tags: ['t'] });
    for (let i = 0; i < 6; i++) await createVideo(a.id, { title: `از همان کانال ${i}`, tags: ['t'] });
    for (let i = 0; i < 2; i++) await createVideo(b.id, { title: `کانال دیگر ${i}`, tags: ['t'] });

    // limit 6, cap = max(2, ceil(6/4)) = 2 per channel → 2 from A + 2 from B, then back-filled from A
    const related = await getRelatedVideos(source.id, { limit: 6 });
    expect(related).toHaveLength(6);
    const firstFour = related.slice(0, 4).map((c) => c.channel.id);
    expect(firstFour.filter((c) => c === a.id)).toHaveLength(2);
    expect(firstFour.filter((c) => c === b.id)).toHaveLength(2);
  });

  it('penalizes videos the viewer already finished', async () => {
    const viewer = await createUser();
    const { channel: a } = await channelWith('الف');
    const { channel: b } = await channelWith('ب');
    const { channel: c } = await channelWith('ج');
    const source = await createVideo(a.id, { tags: ['t'] });
    // `seen` is slightly MORE popular, so without the penalty it would come first
    const seen = await createVideo(b.id, { title: 'قبلاً دیده‌ام', tags: ['t'], viewCount: 120 });
    const fresh = await createVideo(c.id, { title: 'تازه', tags: ['t'], viewCount: 100 });
    await watch(viewer.id, seen.id, { completed: true, position: 120, daysAgo: 1 });

    const anonymous = ids(await getRelatedVideos(source.id, { limit: 10 }));
    expect(anonymous.indexOf(seen.id)).toBeLessThan(anonymous.indexOf(fresh.id));
    const personal = ids(await getRelatedVideos(source.id, { limit: 10, viewerId: viewer.id }));
    expect(personal.indexOf(seen.id)).toBeGreaterThan(personal.indexOf(fresh.id));
  });

  it('boosts videos from channels the viewer follows', async () => {
    const viewer = await createUser();
    const { channel: a } = await channelWith('الف');
    const { channel: b } = await channelWith('ب');
    const { channel: c } = await channelWith('ج');
    const source = await createVideo(a.id, { tags: ['t'] });
    // `popular` is slightly more viewed than `loved`; following loved's channel must flip the order
    const popular = await createVideo(b.id, { title: 'پربازدیدتر', tags: ['t'], viewCount: 100 });
    const loved = await createVideo(c.id, { title: 'کانال دنبال‌شده', tags: ['t'], viewCount: 90 });
    const before = ids(await getRelatedVideos(source.id, { limit: 10, viewerId: viewer.id }));
    expect(before.indexOf(popular.id)).toBeLessThan(before.indexOf(loved.id));
    await follow(viewer.id, c.id);
    const after = ids(await getRelatedVideos(source.id, { limit: 10, viewerId: viewer.id }));
    expect(after.indexOf(loved.id)).toBeLessThan(after.indexOf(popular.id));
  });

  it('returns [] for an unknown video and respects `limit`', async () => {
    expect(await getRelatedVideos('doesNotExist')).toEqual([]);
    const { channel } = await channelWith('الف');
    const source = await createVideo(channel.id);
    for (let i = 0; i < 5; i++) await createVideo(channel.id);
    expect(await getRelatedVideos(source.id, { limit: 3 })).toHaveLength(3);
  });
});

describe('getTrendingVideos', () => {
  it('ranks by recent activity inside the window, not by lifetime views', async () => {
    const { channel: a } = await channelWith('الف');
    const { channel: b } = await channelWith('ب');
    const legacy = await createVideo(a.id, { title: 'قدیمی پربازدید', viewCount: 90_000, publishedAt: daysAgoDate(300) });
    const surging = await createVideo(b.id, { title: 'در حال اوج', viewCount: 120, publishedAt: daysAgoDate(2) });
    await addViews(legacy, 2, { daysAgo: 30 }); // outside the 7-day window
    await addViews(surging, 80, { daysAgo: 1 });
    const trending = ids(await getTrendingVideos({ kind: 'VIDEO', limit: 5 }));
    expect(trending[0]).toBe(surging.id);
  });

  it('counts SEED and REAL events alike and honours the `days` window', async () => {
    const { channel } = await channelWith('الف');
    const { channel: other } = await channelWith('ب');
    const seeded = await createVideo(channel.id, { title: 'سید', publishedAt: daysAgoDate(20) });
    const real = await createVideo(other.id, { title: 'واقعی', publishedAt: daysAgoDate(20) });
    await addViews(seeded, 40, { source: 'SEED', daysAgo: 2 });
    await addViews(real, 5, { source: 'REAL', daysAgo: 2 });
    expect((await getTrendingVideoIds({ limit: 2 }))[0]).toBe(seeded.id);

    // a 1-day window sees neither (both were 2 days ago) → ordering falls back to recency/popularity but nothing breaks
    const narrow = await getTrendingVideoIds({ limit: 2, days: 1 });
    expect(narrow).toHaveLength(2);
  });

  it('likes inside the window lift a video', async () => {
    const { channel: a } = await channelWith('الف');
    const { channel: b } = await channelWith('ب');
    const quiet = await createVideo(a.id, { title: 'آرام', publishedAt: daysAgoDate(3) });
    const loved = await createVideo(b.id, { title: 'محبوب', publishedAt: daysAgoDate(3) });
    const fans = await Promise.all(Array.from({ length: 12 }, () => createUser()));
    await addLikes(
      loved.id,
      fans.map((u) => u.id),
      1,
    );
    expect((await getTrendingVideoIds({ limit: 2 }))[0]).toBe(loved.id);
    expect(quiet.id).not.toBe(loved.id);
  });

  it('filters by kind and category and never returns hidden videos', async () => {
    const cat = await createCategory('music', 'موسیقی');
    const { channel } = await channelWith('الف');
    const short = await createVideo(channel.id, { kind: 'SHORT', title: 'کوتاه' });
    const inCat = await createVideo(channel.id, { title: 'در دسته', categoryId: cat.id });
    const outCat = await createVideo(channel.id, { title: 'بیرون دسته' });
    const hidden = await Promise.all([
      createVideo(channel.id, { state: 'private', categoryId: cat.id }),
      createVideo(channel.id, { state: 'takedown', categoryId: cat.id }),
      createVideo(channel.id, { state: 'draft', categoryId: cat.id }),
    ]);
    for (const v of [short, inCat, outCat, ...hidden]) await addViews(v, 10);

    expect(ids(await getTrendingVideos({ kind: 'SHORT' }))).toEqual([short.id]);
    const videos = ids(await getTrendingVideos({ kind: 'VIDEO', limit: 20 }));
    expect(videos).toContain(inCat.id);
    expect(videos).not.toContain(short.id);
    for (const h of hidden) expect(videos).not.toContain(h.id);
    expect(ids(await getTrendingVideos({ kind: 'VIDEO', categoryId: cat.id }))).toEqual([inCat.id]);
    expect(videos).toContain(outCat.id);
  });

  it('is deterministic for a fixed `now` and works on an empty catalogue', async () => {
    expect(await getTrendingVideos()).toEqual([]);
    const { channel } = await channelWith('الف');
    for (let i = 0; i < 4; i++) await createVideo(channel.id, { title: `ویدیو ${i}`, viewCount: i * 10 });
    const now = new Date();
    expect(ids(await getTrendingVideos({ now, limit: 4 }))).toEqual(ids(await getTrendingVideos({ now, limit: 4 })));
  });
});

describe('getPersonalizedFeed', () => {
  it('is empty for a viewer without any signal (cold start)', async () => {
    const viewer = await createUser();
    const { channel } = await channelWith('الف');
    await createVideo(channel.id);
    expect(await getPersonalizedFeed(viewer.id)).toEqual([]);
  });

  it('prefers the categories the viewer watches, skips finished videos and their own channel', async () => {
    const cooking = await createCategory('cooking', 'آشپزی');
    const sports = await createCategory('sports', 'ورزش');
    const viewer = await createUser({ withChannel: true });
    const { channel: chef } = await channelWith('سرآشپز');
    const { channel: coach } = await channelWith('مربی');

    const watchedCooking = await createVideo(chef.id, { title: 'دیده‌شده', categoryId: cooking.id, tags: ['غذا'] });
    const newCooking = await createVideo(chef.id, { title: 'غذای تازه', categoryId: cooking.id, tags: ['غذا'], viewCount: 20 });
    const newSports = await createVideo(coach.id, { title: 'تمرین', categoryId: sports.id, tags: ['ورزش'], viewCount: 20 });
    const own = await createVideo(viewer.channel!.id, { title: 'ویدیوی خودم', categoryId: cooking.id, tags: ['غذا'] });
    await watch(viewer.id, watchedCooking.id, { completed: true, position: 120 });

    const feed = ids(await getPersonalizedFeed(viewer.id, { limit: 10 }));
    expect(feed).not.toContain(watchedCooking.id);
    expect(feed).not.toContain(own.id);
    expect(feed.indexOf(newCooking.id)).toBeLessThan(feed.indexOf(newSports.id));
  });

  it('follows alone are a signal, hidden videos never appear, excludeIds is honoured', async () => {
    const viewer = await createUser();
    const { channel } = await channelWith('الف');
    await follow(viewer.id, channel.id);
    const v1 = await createVideo(channel.id, { title: 'یک' });
    const v2 = await createVideo(channel.id, { title: 'دو' });
    const priv = await createVideo(channel.id, { state: 'private' });
    const feed = ids(await getPersonalizedFeed(viewer.id, { limit: 10, excludeIds: [v2.id] }));
    expect(feed).toContain(v1.id);
    expect(feed).not.toContain(v2.id);
    expect(feed).not.toContain(priv.id);
  });
});

describe('home feed', () => {
  it('is entirely empty for an empty catalogue (visitor and viewer)', async () => {
    const empty = { continueWatching: [], fromFollowed: [], forYou: [], trending: [], latest: [], shorts: [], categoryRows: [] };
    expect(await getHomeFeed(null)).toEqual(empty);
    const viewer = await createUser();
    expect(await getHomeFeed(viewer.id)).toEqual(empty);
  });

  it('serves visitors trending / latest / shorts / category rows and nothing personal', async () => {
    const cat = await createCategory('music', 'موسیقی');
    const { channel } = await channelWith('الف');
    const v = await createVideo(channel.id, { title: 'ویدیو', categoryId: cat.id });
    const s = await createVideo(channel.id, { kind: 'SHORT', title: 'شورت' });
    await addViews(v, 5);
    const feed = await getHomeFeed(null);
    expect(ids(feed.trending)).toEqual([v.id]);
    expect(ids(feed.latest)).toEqual([v.id]);
    expect(ids(feed.shorts)).toEqual([s.id]);
    expect(feed.categoryRows.map((r) => r.category.slug)).toEqual(['music']);
    expect(feed.continueWatching).toEqual([]);
    expect(feed.fromFollowed).toEqual([]);
    expect(feed.forYou).toEqual([]);
  });

  it('never lists hidden videos in any section', async () => {
    const { channel } = await channelWith('الف');
    const visible = await createVideo(channel.id, { title: 'عمومی' });
    const hidden = await Promise.all(
      (['private', 'unlisted', 'draft', 'processing', 'failed', 'scheduled', 'takedown'] as const).map((state) => createVideo(channel.id, { state })),
    );
    const viewer = await createUser();
    await follow(viewer.id, channel.id);
    for (const h of hidden) await watch(viewer.id, h.id, { position: 30 });
    await watch(viewer.id, visible.id, { position: 30 });

    for (const feed of [await getHomeFeed(null), await getHomeFeed(viewer.id)]) {
      const everything = [
        ...feed.continueWatching,
        ...feed.fromFollowed,
        ...feed.forYou,
        ...feed.trending,
        ...feed.latest,
        ...feed.shorts,
        ...feed.categoryRows.flatMap((r) => r.videos),
      ].map((c) => c.id);
      for (const h of hidden) {
        // unlisted videos are never LISTED (they may only appear in "continue watching", which uses link access)
        if (h.visibility === 'UNLISTED') continue;
        expect(everything).not.toContain(h.id);
      }
    }
  });

  it('hydrateCards drops anything that stopped being public after ranking (the cache holds ids only)', async () => {
    const { channel } = await channelWith('الف');
    const a = await createVideo(channel.id, { title: 'الف' });
    const b = await createVideo(channel.id, { title: 'ب' });
    const c = await createVideo(channel.id, { title: 'ج' });
    await db.video.update({ where: { id: b.id }, data: { takedownAt: new Date() } });
    await db.video.update({ where: { id: c.id }, data: { visibility: 'PRIVATE' } });
    expect(ids(await hydrateCards([c.id, b.id, a.id, 'nope']))).toEqual([a.id]);
    expect(ids(await hydrateCards([a.id, b.id, c.id]))).toEqual([a.id]);
  });

  it('continue watching: unfinished, linkable videos with progress, most recent first', async () => {
    const viewer = await createUser();
    const { channel } = await channelWith('الف');
    const half = await createVideo(channel.id, { title: 'نیمه‌کاره', durationSeconds: 200 });
    const almostDone = await createVideo(channel.id, { title: 'تقریباً تمام', durationSeconds: 200 });
    const done = await createVideo(channel.id, { title: 'تمام‌شده', durationSeconds: 200 });
    const barely = await createVideo(channel.id, { title: 'تازه شروع', durationSeconds: 200 });
    const unlisted = await createVideo(channel.id, { title: 'فقط لینک', state: 'unlisted', durationSeconds: 200 });
    const priv = await createVideo(channel.id, { title: 'خصوصی', state: 'private', durationSeconds: 200 });
    await watch(viewer.id, half.id, { position: 100, daysAgo: 2 });
    await watch(viewer.id, unlisted.id, { position: 50, daysAgo: 1 });
    await watch(viewer.id, almostDone.id, { position: 196 });
    await watch(viewer.id, done.id, { position: 200, completed: true });
    await watch(viewer.id, barely.id, { position: 2 });
    await watch(viewer.id, priv.id, { position: 100 });

    const items = await getContinueWatching(viewer.id);
    expect(ids(items)).toEqual([unlisted.id, half.id]);
    expect(items[1]!.progress).toBeCloseTo(0.5);
    // someone else's history is not visible
    const other = await createUser();
    expect(await getContinueWatching(other.id)).toEqual([]);
  });

  it('from followed channels: newest first, public only, only followed', async () => {
    const viewer = await createUser();
    const { channel: followed } = await channelWith('دنبال‌شده');
    const { channel: stranger } = await channelWith('غریبه');
    await follow(viewer.id, followed.id);
    const older = await createVideo(followed.id, { title: 'قدیمی‌تر', publishedAt: daysAgoDate(5) });
    const newer = await createVideo(followed.id, { title: 'جدیدتر', publishedAt: daysAgoDate(1) });
    await createVideo(followed.id, { state: 'private' });
    await createVideo(stranger.id, { title: 'از غریبه' });
    expect(ids(await getFollowedLatest(viewer.id))).toEqual([newer.id, older.id]);
    expect((await getHomeFeed(viewer.id)).fromFollowed.map((c) => c.id)).toEqual([newer.id, older.id]);
  });

  it('a channel suspended after ranking is dropped on the next request', async () => {
    const owner = await createUser({ withChannel: true });
    const other = await createChannel((await createUser()).id, { name: 'دیگر' });
    const v = await createVideo(owner.channel!.id, { title: 'ویدیو' });
    await createVideo(other.id, { title: 'دیگری' });
    expect(ids((await getHomeFeed(null)).latest)).toContain(v.id);
    await db.channel.update({ where: { id: owner.channel!.id }, data: { suspendedAt: new Date() } });
    expect(ids((await getHomeFeed(null)).latest)).not.toContain(v.id);
  });
});
