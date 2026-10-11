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

/** The public videos with the most activity (views + weighted likes) inside the window, best first. */
export async function loadHotVideoIds(opts: {
  since: Date;
  kind?: 'VIDEO' | 'SHORT';
  categoryId?: string;
  limit: number;
}): Promise<string[]> {
  const category = opts.categoryId ? Prisma.sql`AND v."categoryId" = ${opts.categoryId}` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT v.id
    FROM "Video" v
    JOIN "Channel" c ON c.id = v."channelId"
    LEFT JOIN (
      SELECT "videoId", count(*)::int AS n FROM "ViewEvent" WHERE "createdAt" >= ${opts.since} GROUP BY "videoId"
    ) ve ON ve."videoId" = v.id
    LEFT JOIN (
      SELECT "videoId", count(*)::int AS n FROM "VideoLike" WHERE "createdAt" >= ${opts.since} GROUP BY "videoId"
    ) vl ON vl."videoId" = v.id
    WHERE ${Prisma.raw(PUBLIC_VIDEO_SQL)} ${kindFilter(opts.kind)} ${category}
      AND (ve.n IS NOT NULL OR vl.n IS NOT NULL)
    ORDER BY (COALESCE(ve.n, 0) + 5 * COALESCE(vl.n, 0)) DESC, v.id ASC
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

/** Top categories by activity inside the window (views + weighted likes); falls back to catalogue size. */
export async function loadTopCategoryIds(opts: { since: Date; limit: number }): Promise<string[]> {
  const hot = await db.$queryRaw<{ id: string }[]>`
    SELECT v."categoryId" AS id
    FROM "Video" v
    JOIN "Channel" c ON c.id = v."channelId"
    LEFT JOIN "Category" cat ON cat.id = v."categoryId"
    LEFT JOIN (
      SELECT "videoId", count(*)::int AS n FROM "ViewEvent" WHERE "createdAt" >= ${opts.since} GROUP BY "videoId"
    ) ve ON ve."videoId" = v.id
    WHERE ${Prisma.raw(PUBLIC_VIDEO_SQL)} AND v."kind" = 'VIDEO' AND cat."isActive" = true
    GROUP BY v."categoryId", cat."sortOrder"
    ORDER BY sum(COALESCE(ve.n, 0)) DESC, count(*) DESC, cat."sortOrder" ASC, v."categoryId" ASC
    LIMIT ${opts.limit}::int`;
  return hot.map((r) => r.id);
}
