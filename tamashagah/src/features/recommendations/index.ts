/**
 * Recommendation entry points.
 *
 * STATUS: foundation version — simple but correct (public videos only, no ML claimed). The discovery
 * feature replaces the internals with the transparent scoring described in docs/architecture.md §6
 * WITHOUT changing these signatures, so the watch page, shorts and home can already depend on them.
 */
import { db } from '@/lib/db';
import { toVideoCard, videoCardSelect, type VideoCardData } from '@/features/videos/card';
import { publicVideoWhere } from '@/features/videos/visibility';

type Opts = { limit?: number };

/** "Up next" / related list for a video: same category, channel or tags first, then popularity. */
export async function getRelatedVideos(
  videoId: string,
  opts: Opts & { viewerId?: string | null } = {},
): Promise<VideoCardData[]> {
  const limit = opts.limit ?? 12;
  const current = await db.video.findUnique({
    where: { id: videoId },
    select: { categoryId: true, channelId: true, tags: true, kind: true },
  });
  if (!current) return [];

  const related = await db.video.findMany({
    where: {
      ...publicVideoWhere,
      id: { not: videoId },
      kind: current.kind,
      OR: [
        ...(current.categoryId ? [{ categoryId: current.categoryId }] : []),
        { channelId: current.channelId },
        ...(current.tags.length ? [{ tags: { hasSome: current.tags } }] : []),
      ],
    },
    orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
    take: limit,
    select: videoCardSelect,
  });

  if (related.length >= limit) return related.map(toVideoCard);
  // Top up with popular videos so the list is never empty on small catalogues.
  const filler = await db.video.findMany({
    where: { ...publicVideoWhere, kind: current.kind, id: { notIn: [videoId, ...related.map((r) => r.id)] } },
    orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
    take: limit - related.length,
    select: videoCardSelect,
  });
  return [...related, ...filler].map(toVideoCard);
}

/** Trending: most viewed public videos (the discovery feature narrows this to a recent window). */
export async function getTrendingVideos(opts: Opts & { kind?: 'VIDEO' | 'SHORT' } = {}): Promise<VideoCardData[]> {
  const rows = await db.video.findMany({
    where: { ...publicVideoWhere, ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
    take: opts.limit ?? 12,
    select: videoCardSelect,
  });
  return rows.map(toVideoCard);
}
