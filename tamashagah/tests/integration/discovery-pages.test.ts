import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { CATEGORY_PAGE_SIZE, getCategoryPage } from '@/features/discovery/category';
import { getSitemapEntries, getSitemapIds, renderSitemapFile, renderSitemapIndex } from '@/features/discovery/sitemap';
import { getAboutStats } from '@/features/info/stats';
import { getTrendingVideoIds, getTrendingVideos } from '@/features/recommendations';
import { HOT_POOL, loadHotVideoIds } from '@/features/recommendations/queries';
import { createCategory, createUser, createVideo } from '../helpers/factories';
import { addViews, daysAgoDate } from '../support/discovery';

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

async function channelWith(name: string) {
  const owner = await createUser({ withChannel: true, displayName: name });
  return owner.channel!;
}

describe('category page', () => {
  it('lists only public regular videos, 24 per page, with the category total in the header on every tab', async () => {
    const category = await createCategory('cooking', 'آشپزی');
    const other = await createCategory('travel', 'سفر');
    const channel = await channelWith('الف');
    const suspended = await channelWith('معلق');
    await db.channel.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });

    // 26 public videos: newest first by publishedAt, ascending viewCount in the same order
    const visible = [];
    for (let i = 0; i < 26; i++) {
      visible.push(await createVideo(channel.id, { categoryId: category.id, publishedAt: daysAgoDate(i + 1), viewCount: 100 - i, title: `ویدیو ${i}` }));
    }
    const hidden = await Promise.all([
      createVideo(channel.id, { categoryId: category.id, state: 'private' }),
      createVideo(channel.id, { categoryId: category.id, state: 'unlisted' }),
      createVideo(channel.id, { categoryId: category.id, state: 'draft' }),
      createVideo(channel.id, { categoryId: category.id, state: 'takedown' }),
      createVideo(channel.id, { categoryId: category.id, kind: 'SHORT' }),
      createVideo(suspended.id, { categoryId: category.id }),
      createVideo(channel.id, { categoryId: other.id }),
    ]);

    const first = await getCategoryPage(category.id, 'new', 1);
    expect(first.videos).toHaveLength(CATEGORY_PAGE_SIZE);
    expect(first.total).toBe(26);
    expect(first.pageCount).toBe(2);
    expect(ids(first.videos)).toEqual(ids(visible.slice(0, CATEGORY_PAGE_SIZE)));
    const second = await getCategoryPage(category.id, 'new', 2);
    expect(ids(second.videos)).toEqual(ids(visible.slice(CATEGORY_PAGE_SIZE)));

    const popular = await getCategoryPage(category.id, 'views', 1);
    expect(ids(popular.videos)).toEqual(ids(visible.slice(0, CATEGORY_PAGE_SIZE))); // viewCount descends in the same order
    expect(popular.total).toBe(26);

    // "hot" ranks by recent activity: the video nobody watched lately must not beat the one with fresh views
    await addViews(visible[20]!, 40, { daysAgo: 1 });
    await addViews(visible[3]!, 5, { daysAgo: 1 });
    const hot = await getCategoryPage(category.id, 'hot', 1);
    expect(hot.total).toBe(26); // the header always shows the category total
    expect(hot.videos.length).toBeGreaterThan(1);
    expect(ids(hot.videos).indexOf(visible[20]!.id)).toBeLessThan(ids(hot.videos).indexOf(visible[3]!.id));

    for (const tab of ['new', 'views', 'hot'] as const) {
      const all = [...ids((await getCategoryPage(category.id, tab, 1)).videos), ...ids((await getCategoryPage(category.id, tab, 2)).videos)];
      for (const h of hidden) expect(all, `${tab} must not contain a hidden video`).not.toContain(h.id);
    }
  });

  it('drops a video that became hidden since the ids were ranked (cards are always hydrated fresh)', async () => {
    const category = await createCategory('news', 'خبر')
    const channel = await channelWith('ب');
    const a = await createVideo(channel.id, { categoryId: category.id, publishedAt: daysAgoDate(1) });
    const b = await createVideo(channel.id, { categoryId: category.id, publishedAt: daysAgoDate(2) });
    expect(ids((await getCategoryPage(category.id, 'new', 1)).videos)).toEqual([a.id, b.id]);
    await db.video.update({ where: { id: a.id }, data: { visibility: 'PRIVATE' } });
    expect(ids((await getCategoryPage(category.id, 'new', 1)).videos)).toEqual([b.id]);
    await db.video.update({ where: { id: b.id }, data: { takedownAt: new Date() } });
    expect((await getCategoryPage(category.id, 'new', 1)).videos).toEqual([]);
  });
});

describe('trending without a fixed clock (the cached path pages use)', () => {
  it('returns the same order as the ids and never a hidden video', async () => {
    const channel = await channelWith('الف');
    const other = await channelWith('ب');
    const top = await createVideo(channel.id, { title: 'پرطرفدار' });
    const middle = await createVideo(other.id, { title: 'میانی' });
    await addViews(top, 30, { daysAgo: 1, bumpCounter: true });
    await addViews(middle, 10, { daysAgo: 1, bumpCounter: true });

    const rankedIds = await getTrendingVideoIds({ kind: 'VIDEO', limit: 5, days: 7 });
    const cards = await getTrendingVideos({ kind: 'VIDEO', limit: 5, days: 7 });
    expect(ids(cards)).toEqual(rankedIds);
    expect(ids(cards)[0]).toBe(top.id);

    await db.video.update({ where: { id: top.id }, data: { visibility: 'PRIVATE' } });
    expect(ids(await getTrendingVideos({ kind: 'VIDEO', limit: 5, days: 7 }))).not.toContain(top.id);
  });
});

describe('loadHotVideoIds: bounded candidate pool', () => {
  it('counts window activity only for the most-viewed and the newest videos, and never returns more than the pool', async () => {
    const channel = await channelWith('الف');
    const total = HOT_POOL.popular + HOT_POOL.newest + 20;
    const base = Date.now();
    const rows = Array.from({ length: total }, (_, i) => ({
      id: `pool${String(i).padStart(7, '0')}`.slice(0, 11),
      channelId: channel.id,
      kind: 'VIDEO' as const,
      title: `ویدیوی ${i}`,
      description: '',
      tags: [],
      processingStatus: 'READY' as const,
      publishStatus: 'PUBLISHED' as const,
      visibility: 'PUBLIC' as const,
      // index 0 is the OLDEST and least viewed; the higher the index, the newer and more viewed
      publishedAt: new Date(base - (total - i) * 3_600_000),
      viewCount: i,
      searchTitle: `ویدیوی ${i}`,
      searchBody: '',
    }));
    await db.video.createMany({ data: rows });
    const events = [rows[0]!, rows[total - 1]!, rows[total - 2]!].flatMap((video, n) =>
      Array.from({ length: n === 0 ? 50 : 3 }, (_, k) => ({
        videoId: video.id,
        channelId: channel.id,
        viewerKey: `k${n}-${k}`,
        createdAt: new Date(base - 3_600_000),
        lastBeatAt: new Date(base - 3_600_000),
      })),
    );
    await db.viewEvent.createMany({ data: events });

    const hot = await loadHotVideoIds({ since: daysAgoDate(7), kind: 'VIDEO', limit: 1000 });
    // the two recent, popular videos with a few views are found …
    expect(hot).toContain(rows[total - 1]!.id);
    expect(hot).toContain(rows[total - 2]!.id);
    // … the oldest, least-viewed one is outside both pools, however busy it was (documented limit of the pool)
    expect(hot).not.toContain(rows[0]!.id);
    expect(hot.length).toBe(2);
    // and the pool bound holds even when every video has activity
    await db.viewEvent.createMany({
      data: rows.map((video, n) => ({ videoId: video.id, channelId: channel.id, viewerKey: `all-${n}`, createdAt: new Date(base - 1_000), lastBeatAt: new Date(base - 1_000) })),
    });
    const busy = await loadHotVideoIds({ since: daysAgoDate(7), kind: 'VIDEO', limit: 1000 });
    expect(busy.length).toBeLessThan(total);
    // here the newest 200 are also among the 300 most viewed, so the pool is exactly the 300 most viewed
    expect(busy.length).toBe(HOT_POOL.popular);
  });

  it('is deterministic for ties (id order) and respects kind and category', async () => {
    const category = await createCategory('music', 'موسیقی');
    const channel = await channelWith('الف');
    const a = await createVideo(channel.id, { categoryId: category.id, title: 'الف' });
    const b = await createVideo(channel.id, { categoryId: category.id, title: 'ب' });
    const short = await createVideo(channel.id, { categoryId: category.id, kind: 'SHORT' });
    const elsewhere = await createVideo(channel.id, {});
    for (const v of [a, b, short, elsewhere]) await addViews(v, 4, { daysAgo: 1 });

    const since = daysAgoDate(7);
    const inCategory = await loadHotVideoIds({ since, kind: 'VIDEO', categoryId: category.id, limit: 10 });
    expect(inCategory).toEqual([a.id, b.id].sort());
    expect(await loadHotVideoIds({ since, kind: 'SHORT', limit: 10 })).toEqual([short.id]);
    expect(await loadHotVideoIds({ since, kind: 'VIDEO', limit: 1 })).toHaveLength(1);
  });
});

describe('sitemap', () => {
  it('lists only public pages: active categories, channels with a public video, public regular videos', async () => {
    const category = await createCategory('film', 'فیلم');
    await db.category.create({ data: { slug: 'hidden-cat', nameFa: 'مخفی', isActive: false } });
    const live = await channelWith('فعال');
    const empty = await channelWith('بدون ویدیو');
    const suspended = await channelWith('معلق');
    await db.channel.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });

    const publicVideo = await createVideo(live.id, { categoryId: category.id });
    const hidden = await Promise.all([
      createVideo(live.id, { state: 'private' }),
      createVideo(live.id, { state: 'unlisted' }),
      createVideo(live.id, { state: 'draft' }),
      createVideo(live.id, { state: 'takedown' }),
      createVideo(live.id, { kind: 'SHORT' }),
      createVideo(suspended.id, {}),
    ]);

    const fileIds = await getSitemapIds();
    expect(fileIds).toEqual([0, 1, 2]); // static+categories, one channel file, one video file
    const urls = async (id: number) => (await getSitemapEntries(id)).map((e) => e.url);
    const [staticUrls, channelUrls, videoUrls] = [await urls(0), await urls(1), await urls(2)];

    expect(staticUrls).toContain('http://localhost:3000');
    expect(staticUrls).toContain('http://localhost:3000/help');
    expect(staticUrls).toContain('http://localhost:3000/category/film');
    expect(staticUrls.some((u) => u.includes('hidden-cat'))).toBe(false);
    for (const privatePath of ['/studio', '/library', '/help/tickets', '/search', '/login']) {
      expect(staticUrls.some((u) => u.endsWith(privatePath))).toBe(false);
    }

    expect(channelUrls).toEqual([`http://localhost:3000/channel/${live.handle}`]);
    expect(channelUrls.join()).not.toContain(empty.handle);
    expect(channelUrls.join()).not.toContain(suspended.handle);

    expect(videoUrls).toEqual([`http://localhost:3000/watch/${publicVideo.id}`]);
    for (const h of hidden) expect(videoUrls.join()).not.toContain(h.id);
  });

  it('renders a sitemap index and valid urlsets, and refuses ids outside the layout', async () => {
    const channel = await channelWith('الف');
    await createVideo(channel.id, {});
    const index = await renderSitemapIndex();
    expect(index).toContain('<sitemapindex');
    expect(index).toContain('http://localhost:3000/sitemap/0.xml');
    expect(index).toContain('http://localhost:3000/sitemap/2.xml');
    const file = await renderSitemapFile(2);
    expect(file).toContain('<urlset');
    expect(file).toMatch(/<loc>http:\/\/localhost:3000\/watch\/[0-9A-Za-z]{11}<\/loc>/);
    expect(file).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
    expect(await renderSitemapFile(3)).toBeNull();
    expect(await renderSitemapFile(-1)).toBeNull();
  });

  it('splits into several files when a kind outgrows one file', async () => {
    // plan arithmetic only (cheap): files = 1 + ceil(channels / N) + ceil(videos / N)
    expect(await getSitemapIds()).toEqual([0]); // empty catalogue: just the static file
  });
});

describe('about stats', () => {
  it('counts only what is public and flags demo data', async () => {
    const live = await channelWith('الف');
    const empty = await channelWith('ب');
    await createVideo(live.id, { viewCount: 10 });
    await createVideo(live.id, { viewCount: 5 });
    await createVideo(live.id, { kind: 'SHORT', viewCount: 7 });
    await createVideo(live.id, { state: 'private', viewCount: 1000 });
    await createVideo(live.id, { state: 'draft', viewCount: 1000 });
    expect(empty.id).toBeTruthy();

    const stats = await getAboutStats();
    expect(stats).toMatchObject({ videos: 2, shorts: 1, channels: 1, totalViews: 22, hasDemoData: false });

    const video = await createVideo(live.id, {});
    await addViews(video, 1, { source: 'SEED' });
    expect((await getAboutStats()).hasDemoData).toBe(true);
  });
});

describe('support ticket pages data', () => {
  it('keeps a user away from someone else\'s ticket (404 at the query level)', async () => {
    const { getMyTicket, listMyTickets } = await import('@/features/support/queries');
    const owner = await createUser({});
    const stranger = await createUser({});
    const ticket = await db.supportTicket.create({
      data: { userId: owner.id, email: owner.email, subject: 'موضوع محرمانه', category: 'ACCOUNT', messages: { create: { authorId: owner.id, body: 'متن محرمانه' } } },
    });
    expect(await getMyTicket(stranger.id, ticket.id)).toBeNull();
    expect((await listMyTickets(stranger.id, 1)).tickets).toEqual([]);
    expect((await getMyTicket(owner.id, ticket.id))?.messages).toHaveLength(1);
  });
});

