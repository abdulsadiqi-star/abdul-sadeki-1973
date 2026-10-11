/**
 * The home feed. Non-personalized sections (trending, latest, shorts, per-category rows) are RANKED once and cached
 * for everyone (`unstable_cache`, tag "home", 60 s) — but the cache stores only video ids: cards are hydrated fresh on
 * every request through `publicVideoWhere`, so a video that is taken down or made private can never be served from the
 * cache. Personalized sections are computed per request and never cached across users.
 */
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';
import { toVideoCard, videoCardSelect, type VideoCardData } from '@/features/videos/card';
import { linkableVideoWhere, publicVideoWhere } from '@/features/videos/visibility';
import { DEFAULT_TRENDING_DAYS, daysAgo, hydrateCards, loadTopCategoryIds } from './queries';
import { getPersonalizedFeed, getTrendingVideoIds } from './ranking';

export type ContinueWatchingItem = VideoCardData & { progress: number };

export type HomeCategoryRow = {
  category: { id: string; slug: string; nameFa: string; icon: string | null };
  videos: VideoCardData[];
};

export type HomeFeed = {
  /** Logged-in viewers only: unfinished videos, most recently watched first. */
  continueWatching: ContinueWatchingItem[];
  /** Logged-in viewers only: newest videos of followed channels. */
  fromFollowed: VideoCardData[];
  /** Logged-in viewers with some history/likes/follows only. */
  forYou: VideoCardData[];
  trending: VideoCardData[];
  latest: VideoCardData[];
  shorts: VideoCardData[];
  categoryRows: HomeCategoryRow[];
};

export const HOME_CACHE_SECONDS = 60;

type GlobalHome = {
  trendingIds: string[];
  latestIds: string[];
  shortIds: string[];
  categoryRows: { category: HomeCategoryRow['category']; ids: string[] }[];
};

async function computeGlobalHome(): Promise<GlobalHome> {
  const now = new Date();
  const [trendingIds, shortIds, latest, topCategoryIds] = await Promise.all([
    getTrendingVideoIds({ kind: 'VIDEO', limit: 12, days: DEFAULT_TRENDING_DAYS, now }),
    getTrendingVideoIds({ kind: 'SHORT', limit: 12, days: DEFAULT_TRENDING_DAYS, now }),
    db.video.findMany({
      where: { ...publicVideoWhere, kind: 'VIDEO' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: 12,
      select: { id: true },
    }),
    loadTopCategoryIds({ since: daysAgo(now, 14), limit: 3 }),
  ]);
  const categories = topCategoryIds.length
    ? await db.category.findMany({
        where: { id: { in: topCategoryIds }, isActive: true },
        select: { id: true, slug: true, nameFa: true, icon: true },
      })
    : [];
  const rows = await Promise.all(
    topCategoryIds.map((categoryId) => getTrendingVideoIds({ kind: 'VIDEO', limit: 8, days: 14, categoryId, now })),
  );
  const categoryRows = topCategoryIds.flatMap((id, i) => {
    const category = categories.find((c) => c.id === id);
    return category && rows[i]!.length > 0 ? [{ category, ids: rows[i]! }] : [];
  });
  return { trendingIds, latestIds: latest.map((r) => r.id), shortIds, categoryRows };
}

const getGlobalHome = unstable_cache(computeGlobalHome, ['discovery:home:v1'], {
  revalidate: HOME_CACHE_SECONDS,
  tags: ['home', 'videos'],
});

/** Unfinished videos the viewer can still open (public or unlisted-by-link), with a 0..1 progress. */
export async function getContinueWatching(viewerId: string, limit = 8): Promise<ContinueWatchingItem[]> {
  const rows = await db.watchHistory.findMany({
    where: { userId: viewerId, completed: false, positionSeconds: { gte: 5 }, video: { ...linkableVideoWhere, kind: 'VIDEO' } },
    orderBy: [{ lastWatchedAt: 'desc' }, { videoId: 'asc' }],
    take: limit * 2,
    select: { positionSeconds: true, video: { select: videoCardSelect } },
  });
  const items: ContinueWatchingItem[] = [];
  for (const row of rows) {
    const duration = row.video.durationSeconds;
    if (!duration || duration <= 0) continue;
    const progress = Math.min(1, row.positionSeconds / duration);
    if (progress >= 0.95) continue; // practically finished
    items.push({ ...toVideoCard(row.video), progress });
    if (items.length >= limit) break;
  }
  return items;
}

/** Newest public videos from channels the viewer follows. */
export async function getFollowedLatest(viewerId: string, limit = 12): Promise<VideoCardData[]> {
  const rows = await db.video.findMany({
    where: { ...publicVideoWhere, kind: 'VIDEO', channel: { suspendedAt: null, followers: { some: { userId: viewerId } } } },
    orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    take: limit,
    select: videoCardSelect,
  });
  return rows.map(toVideoCard);
}

export async function getHomeFeed(viewerId?: string | null): Promise<HomeFeed> {
  const now = new Date();
  const global = await getGlobalHome();

  let continueWatching: ContinueWatchingItem[] = [];
  let fromFollowed: VideoCardData[] = [];
  let forYou: VideoCardData[] = [];
  if (viewerId) {
    [continueWatching, fromFollowed] = await Promise.all([getContinueWatching(viewerId), getFollowedLatest(viewerId)]);
    forYou = await getPersonalizedFeed(viewerId, {
      limit: 12,
      now,
      excludeIds: [...continueWatching.map((v) => v.id), ...fromFollowed.map((v) => v.id)],
    });
  }

  // Cached ids → fresh cards. Anything no longer public silently disappears from its section.
  const allIds = [...new Set([...global.trendingIds, ...global.latestIds, ...global.shortIds, ...global.categoryRows.flatMap((r) => r.ids)])];
  const cards = new Map((await hydrateCards(allIds)).map((card) => [card.id, card]));
  const pick = (ids: readonly string[]) => ids.flatMap((id) => (cards.has(id) ? [cards.get(id)!] : []));

  return {
    continueWatching,
    fromFollowed,
    forYou,
    trending: pick(global.trendingIds),
    latest: pick(global.latestIds),
    shorts: pick(global.shortIds),
    categoryRows: global.categoryRows
      .map((row) => ({ category: row.category, videos: pick(row.ids) }))
      .filter((row) => row.videos.length > 0),
  };
}
