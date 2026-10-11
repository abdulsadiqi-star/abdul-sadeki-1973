/**
 * Ranked lists: related ("up next"), trending and "recommended for you".
 * Candidate generation hits the database; ranking itself is pure (see ./scoring.ts) and deterministic for a given `now`.
 */
import { db } from '@/lib/db';
import { clamp } from '@/lib/utils';
import { toVideoCard, type VideoCardData } from '@/features/videos/card';
import { publicVideoWhere } from '@/features/videos/visibility';
import type { Prisma } from '@/generated/prisma/client';
import {
  DEFAULT_TRENDING_DAYS,
  candidateSelect,
  daysAgo,
  dedupeRows,
  loadBaselineCandidates,
  loadCandidates,
  loadHotVideoIds,
  loadViewerProfile,
  loadViewerStateFor,
  loadWindowStats,
  toSignals,
  type CandidateRow,
} from './queries';
import {
  EMPTY_VIEWER,
  diversifyByChannel,
  isColdStart,
  rankScored,
  scorePersonal,
  scoreRelated,
  scoreTrending,
  type ViewerSignals,
} from './scoring';

type Ranked = { id: string; channelId: string; row: CandidateRow };

const asRanked = (row: CandidateRow): Ranked => ({ id: row.id, channelId: row.channel.id, row });

/** Per-channel cap that scales with the list length (12 → 3, 8 → 2, 4 → 2). */
export const maxPerChannelFor = (limit: number): number => Math.max(2, Math.ceil(limit / 4));

function topKeys(map: ReadonlyMap<string, number>, count: number): string[] {
  return [...map]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, count)
    .map(([key]) => key);
}

// ---------------------------------------------------------------------------
// Related
// ---------------------------------------------------------------------------

export type RelatedOptions = { limit?: number; viewerId?: string | null; now?: Date; maxPerChannel?: number };

/**
 * "Up next" list for a video: same category / overlapping tags / same channel first, boosted by recent activity,
 * popularity, recency and engagement, penalizing what the viewer already watched; at most 3 per channel.
 * Weights: `RELATED_WEIGHTS` in ./scoring.ts. Public videos of the same kind only.
 */
export async function getRelatedVideos(videoId: string, opts: RelatedOptions = {}): Promise<VideoCardData[]> {
  const limit = clamp(Math.trunc(opts.limit ?? 12), 1, 50);
  const now = opts.now ?? new Date();
  const source = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, channelId: true, categoryId: true, tags: true, kind: true },
  });
  if (!source) return [];

  const base: Prisma.VideoWhereInput = { ...publicVideoWhere, kind: source.kind, id: { not: videoId } };
  const primary = await db.video.findMany({
    where: {
      ...base,
      OR: [
        ...(source.categoryId ? [{ categoryId: source.categoryId }] : []),
        { channelId: source.channelId },
        ...(source.tags.length ? [{ tags: { hasSome: [...source.tags] } }] : []),
      ],
    },
    orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
    take: 150,
    select: candidateSelect,
  });

  let candidates = primary;
  if (primary.length < limit * 3) {
    // Small catalogue: top up with popular/new videos so the list is never needlessly short.
    const filler = await loadBaselineCandidates({
      kind: source.kind,
      excludeIds: [videoId, ...primary.map((r) => r.id)],
      popular: 40,
      newest: 20,
    });
    candidates = dedupeRows([...primary, ...filler]);
  }
  if (candidates.length === 0) return [];

  const ids = candidates.map((r) => r.id);
  const channelIds = [...new Set(candidates.map((r) => r.channel.id))];
  const [stats, viewerState] = await Promise.all([
    loadWindowStats(ids, daysAgo(now, DEFAULT_TRENDING_DAYS)),
    opts.viewerId ? loadViewerStateFor(opts.viewerId, ids, channelIds) : Promise.resolve(null),
  ]);
  const viewer: ViewerSignals | null = viewerState ? { ...EMPTY_VIEWER, ...viewerState } : null;

  const scored = candidates.map((row) => ({ item: asRanked(row), score: scoreRelated(source, toSignals(row, stats), viewer, now).total }));
  const ordered = rankScored(scored).map((s) => s.item);
  return diversifyByChannel(ordered, limit, opts.maxPerChannel ?? maxPerChannelFor(limit)).map((r) => toVideoCard(r.row));
}

// ---------------------------------------------------------------------------
// Trending
// ---------------------------------------------------------------------------

export type TrendingOptions = {
  kind?: 'VIDEO' | 'SHORT';
  limit?: number;
  /** Rolling window for "recent activity" (default 7 days, 1–90). */
  days?: number;
  categoryId?: string;
  now?: Date;
};

async function rankTrending(opts: TrendingOptions): Promise<Ranked[]> {
  const limit = clamp(Math.trunc(opts.limit ?? 12), 1, 100);
  const days = clamp(Math.trunc(opts.days ?? DEFAULT_TRENDING_DAYS), 1, 90);
  const now = opts.now ?? new Date();
  const since = daysAgo(now, days);

  const hotIds = await loadHotVideoIds({ since, kind: opts.kind, categoryId: opts.categoryId, limit: Math.max(150, limit * 3) });
  const [hot, baseline] = await Promise.all([
    loadCandidates(hotIds),
    loadBaselineCandidates({ kind: opts.kind, categoryId: opts.categoryId, popular: 30, newest: 30 }),
  ]);
  const candidates = dedupeRows([...hot, ...baseline]);
  if (candidates.length === 0) return [];

  const stats = await loadWindowStats(
    candidates.map((r) => r.id),
    since,
  );
  const scored = candidates.map((row) => ({ item: asRanked(row), score: scoreTrending(toSignals(row, stats), now).total }));
  return diversifyByChannel(
    rankScored(scored).map((s) => s.item),
    limit,
    maxPerChannelFor(limit),
  );
}

/** Ids only (what the home page caches); callers must hydrate through `hydrateCards`, which re-checks visibility. */
export async function getTrendingVideoIds(opts: TrendingOptions = {}): Promise<string[]> {
  return (await rankTrending(opts)).map((r) => r.id);
}

/**
 * Trending: recent activity (views + likes inside the rolling window, REAL and SEED events alike) combined with
 * recency, engagement and a small popularity prior. Weights: `TRENDING_WEIGHTS`. Public videos only.
 */
export async function getTrendingVideos(opts: TrendingOptions = {}): Promise<VideoCardData[]> {
  return (await rankTrending(opts)).map((r) => toVideoCard(r.row));
}

// ---------------------------------------------------------------------------
// Personalized
// ---------------------------------------------------------------------------

export type PersonalizedOptions = { limit?: number; now?: Date; excludeIds?: readonly string[] };

/**
 * "Recommended for you": scored from the viewer's own watch history, likes and follows (category/tag/channel affinity,
 * followed-channel boost) plus recent activity and recency; skips finished videos and the viewer's own channel.
 * Returns an empty list for viewers without any signal (new accounts) — the caller shows trending instead.
 */
export async function getPersonalizedFeed(viewerId: string, opts: PersonalizedOptions = {}): Promise<VideoCardData[]> {
  const limit = clamp(Math.trunc(opts.limit ?? 12), 1, 50);
  const now = opts.now ?? new Date();
  const profile = await loadViewerProfile(viewerId, now);
  if (isColdStart(profile)) return [];

  const ownChannel = await db.channel.findUnique({ where: { ownerId: viewerId }, select: { id: true } });
  const finished = [...profile.watched].filter(([, state]) => state.completed).map(([id]) => id);
  const blocked = [...new Set([...finished, ...(opts.excludeIds ?? [])])];

  const base: Prisma.VideoWhereInput = {
    ...publicVideoWhere,
    kind: 'VIDEO',
    ...(ownChannel ? { channelId: { not: ownChannel.id } } : {}),
    ...(blocked.length ? { id: { notIn: blocked } } : {}),
  };
  const topCategories = topKeys(profile.categoryAffinity, 3);
  const topTags = topKeys(profile.tagAffinity, 8);
  const followed = [...profile.followedChannelIds];
  const affinityFilter: Prisma.VideoWhereInput[] = [
    ...(topCategories.length ? [{ categoryId: { in: topCategories } }] : []),
    ...(followed.length ? [{ channelId: { in: followed } }] : []),
    ...(topTags.length ? [{ tags: { hasSome: topTags } }] : []),
  ];

  const hotIds = await loadHotVideoIds({ since: daysAgo(now, DEFAULT_TRENDING_DAYS), kind: 'VIDEO', limit: 60 });
  const [popular, newest, hot, baseline] = await Promise.all([
    affinityFilter.length
      ? db.video.findMany({ where: { ...base, OR: affinityFilter }, orderBy: [{ viewCount: 'desc' }, { id: 'asc' }], take: 100, select: candidateSelect })
      : Promise.resolve([]),
    affinityFilter.length
      ? db.video.findMany({ where: { ...base, OR: affinityFilter }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: 100, select: candidateSelect })
      : Promise.resolve([]),
    loadCandidates(hotIds),
    loadBaselineCandidates({ kind: 'VIDEO', excludeIds: blocked, popular: 20, newest: 20 }),
  ]);
  const hotAllowed = hot.filter((r) => !blocked.includes(r.id) && r.channel.id !== ownChannel?.id);
  const baselineAllowed = baseline.filter((r) => r.channel.id !== ownChannel?.id);
  const candidates = dedupeRows([...popular, ...newest, ...hotAllowed, ...baselineAllowed]);
  if (candidates.length === 0) return [];

  const stats = await loadWindowStats(
    candidates.map((r) => r.id),
    daysAgo(now, DEFAULT_TRENDING_DAYS),
  );
  const scored = candidates.map((row) => ({ item: asRanked(row), score: scorePersonal(toSignals(row, stats), profile, now).total }));
  return diversifyByChannel(
    rankScored(scored).map((s) => s.item),
    limit,
    maxPerChannelFor(limit),
  ).map((r) => toVideoCard(r.row));
}
