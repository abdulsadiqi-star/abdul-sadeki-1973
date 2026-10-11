/**
 * Database access for the recommendation engine. Everything here only ever returns PUBLIC videos
 * (`publicVideoWhere` / `PUBLIC_VIDEO_SQL`), so no ranking can leak a hidden video.
 */
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { sortByIds, toVideoCard, videoCardSelect, type VideoCardData } from '@/features/videos/card';
import { PUBLIC_VIDEO_SQL, publicVideoWhere } from '@/features/videos/visibility';
import {
  buildViewerProfile,
  type HistoryEntry,
  type LikeEntry,
  type VideoSignals,
  type ViewerSignals,
  type WatchedState,
} from './scoring';

/** What scoring needs about a candidate, on top of the card fields. */
export const candidateSelect = {
  ...videoCardSelect,
  categoryId: true,
  tags: true,
  likeCount: true,
} satisfies Prisma.VideoSelect;

export type CandidateRow = Prisma.VideoGetPayload<{ select: typeof candidateSelect }>;

export type WindowStat = { views: number; likes: number };

export const DEFAULT_TRENDING_DAYS = 7;

export const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * 86_400_000);

const kindFilter = (kind: 'VIDEO' | 'SHORT' | undefined) => (kind ? Prisma.sql`AND v."kind" = ${kind}::"VideoKind"` : Prisma.empty);

/** Views and likes per video inside the rolling window (REAL and SEED events both count). */
export async function loadWindowStats(videoIds: readonly string[], since: Date): Promise<Map<string, WindowStat>> {
  const stats = new Map<string, WindowStat>();
  if (videoIds.length === 0) return stats;
  const ids = Prisma.join([...videoIds]);
  const [views, likes] = await Promise.all([
    db.$queryRaw<{ id: string; n: number }[]>`
      SELECT "videoId" AS id, count(*)::int AS n FROM "ViewEvent"
      WHERE "videoId" IN (${ids}) AND "createdAt" >= ${since} GROUP BY "videoId"`,
    db.$queryRaw<{ id: string; n: number }[]>`
      SELECT "videoId" AS id, count(*)::int AS n FROM "VideoLike"
      WHERE "videoId" IN (${ids}) AND "createdAt" >= ${since} GROUP BY "videoId"`,
  ]);
  for (const r of views) stats.set(r.id, { views: r.n, likes: 0 });
  for (const r of likes) stats.set(r.id, { views: stats.get(r.id)?.views ?? 0, likes: r.n });
  return stats;
}

/**
 * Candidate pool for "recent activity" ranking: the most-viewed and the newest PUBLIC videos of a kind/category.
 * Window activity is then counted for the pool only, with one index probe per video on `ViewEvent(videoId, createdAt)`.
 * That keeps the cost proportional to the pool (≤ 500 videos) instead of to the number of events in the window — the
 * whole-window `GROUP BY` it replaces took ~280 ms on 1.5 M events, this takes ~8 ms. A video that is hot but neither
 * among the 300 most-viewed nor the 200 newest of its category cannot appear; a surge raises the all-time counter too,
 * so in practice that only affects long-tail videos.
 */
export const HOT_POOL = { popular: 300, newest: 200 } as const;

function candidatePool(opts: { kind?: 'VIDEO' | 'SHORT'; categoryId?: string }): Prisma.Sql {
  const category = opts.categoryId ? Prisma.sql`AND v."categoryId" = ${opts.categoryId}` : Prisma.empty;
  const source = Prisma.sql`FROM "Video" v JOIN "Channel" c ON c.id = v."channelId" WHERE ${Prisma.raw(PUBLIC_VIDEO_SQL)} ${kindFilter(opts.kind)} ${category}`;
  return Prisma.sql`
    (SELECT v.id, v."categoryId" ${source} ORDER BY v."viewCount" DESC, v.id ASC LIMIT ${HOT_POOL.popular}::int)
    UNION
    (SELECT v.id, v."categoryId" ${source} ORDER BY v."publishedAt" DESC, v.id ASC LIMIT ${HOT_POOL.newest}::int)`;
}

/** The public videos with the most activity (views + weighted likes) inside the window, best first (see `HOT_POOL`). */
export async function loadHotVideoIds(opts: {
  since: Date;
  kind?: 'VIDEO' | 'SHORT';
  categoryId?: string;
  limit: number;
}): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH pool AS (${candidatePool(opts)})
    SELECT p.id
    FROM pool p
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS n FROM "ViewEvent" e WHERE e."videoId" = p.id AND e."createdAt" >= ${opts.since}
    ) ve
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS n FROM "VideoLike" l WHERE l."videoId" = p.id AND l."createdAt" >= ${opts.since}
    ) vl
    WHERE ve.n > 0 OR vl.n > 0
    ORDER BY (ve.n + 5 * vl.n) DESC, p.id ASC
    LIMIT ${opts.limit}::int`;
  return rows.map((r) => r.id);
}

/** Candidate rows (with scoring fields) for explicit ids; hidden videos are silently dropped. */
export async function loadCandidates(ids: readonly string[]): Promise<CandidateRow[]> {
  if (ids.length === 0) return [];
  return db.video.findMany({ where: { ...publicVideoWhere, id: { in: [...ids] } }, select: candidateSelect });
}

/** Popular and newest public videos — the pool every list falls back to on small catalogues. */
export async function loadBaselineCandidates(opts: {
  kind?: 'VIDEO' | 'SHORT';
  categoryId?: string;
  excludeIds?: readonly string[];
  popular?: number;
  newest?: number;
}): Promise<CandidateRow[]> {
  const where: Prisma.VideoWhereInput = {
    ...publicVideoWhere,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    ...(opts.excludeIds?.length ? { id: { notIn: [...opts.excludeIds] } } : {}),
  };
  const [popular, newest] = await Promise.all([
    db.video.findMany({ where, orderBy: [{ viewCount: 'desc' }, { id: 'asc' }], take: opts.popular ?? 40, select: candidateSelect }),
    db.video.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: opts.newest ?? 40, select: candidateSelect }),
  ]);
  return dedupeRows([...popular, ...newest]);
}

export function dedupeRows<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function toSignals(row: CandidateRow, stats: ReadonlyMap<string, WindowStat>): VideoSignals {
  const stat = stats.get(row.id);
  return {
    id: row.id,
    channelId: row.channel.id,
    categoryId: row.categoryId,
    tags: row.tags,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    publishedAt: row.publishedAt ?? row.createdAt,
    windowViews: stat?.views ?? 0,
    windowLikes: stat?.likes ?? 0,
  };
}

/** Public videos by id, in the order of `ids` (re-checks visibility: callers may pass ids from a cache). */
export async function hydrateCards(ids: readonly string[]): Promise<VideoCardData[]> {
  if (ids.length === 0) return [];
  const rows = await db.video.findMany({ where: { ...publicVideoWhere, id: { in: [...ids] } }, select: videoCardSelect });
  return sortByIds(rows, ids).map(toVideoCard);
}

// ---------------------------------------------------------------------------
// Viewer signals
// ---------------------------------------------------------------------------

function fractionWatched(entry: { completed: boolean; positionSeconds: number; watchedSeconds: number }, durationSeconds: number | null): number {
  if (entry.completed) return 1;
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.min(1, Math.max(entry.positionSeconds, entry.watchedSeconds) / durationSeconds);
}

/** Follows + watch states for a bounded candidate set — all a "related" list needs from the viewer. */
export async function loadViewerStateFor(
  viewerId: string,
  videoIds: readonly string[],
  channelIds: readonly string[],
): Promise<Pick<ViewerSignals, 'followedChannelIds' | 'watched'>> {
  const [follows, history] = await Promise.all([
    channelIds.length
      ? db.follow.findMany({ where: { userId: viewerId, channelId: { in: [...channelIds] } }, select: { channelId: true } })
      : Promise.resolve([]),
    videoIds.length
      ? db.watchHistory.findMany({
          where: { userId: viewerId, videoId: { in: [...videoIds] } },
          select: { videoId: true, completed: true, positionSeconds: true, watchedSeconds: true, video: { select: { durationSeconds: true } } },
        })
      : Promise.resolve([]),
  ]);
  const watched = new Map<string, WatchedState>();
  for (const h of history) watched.set(h.videoId, { completed: h.completed, fraction: fractionWatched(h, h.video.durationSeconds) });
  return { followedChannelIds: new Set(follows.map((f) => f.channelId)), watched };
}

/** The viewer's taste profile (watch history, likes, follows) used by "recommended for you". */
export async function loadViewerProfile(viewerId: string, now: Date): Promise<ViewerSignals> {
  const [follows, history, likes] = await Promise.all([
    db.follow.findMany({ where: { userId: viewerId }, select: { channelId: true } }),
    db.watchHistory.findMany({
      where: { userId: viewerId },
      orderBy: [{ lastWatchedAt: 'desc' }, { videoId: 'asc' }],
      take: 100,
      select: {
        videoId: true,
        completed: true,
        positionSeconds: true,
        watchedSeconds: true,
        lastWatchedAt: true,
        video: { select: { categoryId: true, tags: true, channelId: true, durationSeconds: true } },
      },
    }),
    db.videoLike.findMany({
      where: { userId: viewerId },
      orderBy: [{ createdAt: 'desc' }, { videoId: 'asc' }],
      take: 50,
      select: { createdAt: true, video: { select: { categoryId: true, tags: true, channelId: true } } },
    }),
  ]);

  const entries: HistoryEntry[] = history.map((h) => ({
    videoId: h.videoId,
    categoryId: h.video.categoryId,
    channelId: h.video.channelId,
    tags: h.video.tags,
    lastWatchedAt: h.lastWatchedAt,
    completed: h.completed,
    fraction: fractionWatched(h, h.video.durationSeconds),
  }));
  const likeEntries: LikeEntry[] = likes.map((l) => ({
    categoryId: l.video.categoryId,
    channelId: l.video.channelId,
    tags: l.video.tags,
    likedAt: l.createdAt,
  }));
  return buildViewerProfile(entries, likeEntries, follows.map((f) => f.channelId), now);
}

/**
 * Top categories by views inside the window among the candidate pool (see `HOT_POOL`); ties fall back to how many pool
 * videos the category has, then to its configured sort order.
 */
export async function loadTopCategoryIds(opts: { since: Date; limit: number }): Promise<string[]> {
  const hot = await db.$queryRaw<{ id: string }[]>`
    WITH pool AS (${candidatePool({ kind: 'VIDEO' })})
    SELECT p."categoryId" AS id
    FROM pool p
    JOIN "Category" cat ON cat.id = p."categoryId" AND cat."isActive" = true
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS n FROM "ViewEvent" e WHERE e."videoId" = p.id AND e."createdAt" >= ${opts.since}
    ) ve
    GROUP BY p."categoryId", cat."sortOrder"
    ORDER BY sum(ve.n) DESC, count(*) DESC, cat."sortOrder" ASC, p."categoryId" ASC
    LIMIT ${opts.limit}::int`;
  return hot.map((r) => r.id);
}
