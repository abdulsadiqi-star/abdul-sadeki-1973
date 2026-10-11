/**
 * Transparent, rule-based scoring for recommendations (pure functions: no I/O, no clock).
 *
 * There is NO machine learning here. Every score is a documented weighted sum of simple, explainable signals;
 * the weights live in the `*_WEIGHTS` constants below and are mirrored in docs/features/discovery.md.
 * Callers pass `now` explicitly so results are deterministic (and unit-testable).
 *
 * Every signal is normalized to [0, 1]; a score is `Σ weight × signal − penalties`.
 */
import { normalizeSearchText } from '@/lib/persian';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Weights (the single source of truth — keep docs/features/discovery.md in sync)
// ---------------------------------------------------------------------------

/** "Up next" for a given video. Positive weights sum to 1.00. */
export const RELATED_WEIGHTS = {
  sameCategory: 0.2,
  tagOverlap: 0.25,
  sameChannel: 0.1,
  followedChannel: 0.05,
  popularity: 0.12,
  trending: 0.1,
  recency: 0.1,
  engagement: 0.08,
  /** Subtracted when the viewer already watched the candidate (scaled by how much of it they watched). */
  watched: 0.4,
} as const;

/** Trending: recent activity dominates. Positive weights sum to 1.00. */
export const TRENDING_WEIGHTS = {
  recentActivity: 0.55,
  recency: 0.2,
  engagement: 0.1,
  popularity: 0.15,
} as const;

/** "Recommended for you" — built from the viewer's own watch history, likes and follows. Positive weights sum to 1.00. */
export const PERSONAL_WEIGHTS = {
  categoryAffinity: 0.22,
  tagAffinity: 0.2,
  channelAffinity: 0.1,
  followedChannel: 0.15,
  popularity: 0.08,
  trending: 0.1,
  recency: 0.1,
  engagement: 0.05,
  watched: 0.4,
} as const;

/** Half-lives (days) of the recency decay per list type. */
export const HALF_LIFE_DAYS = { related: 21, trending: 4, personal: 14 } as const;

/** Maximum videos of one channel in a returned list (the rest is back-filled only when the list would be short). */
export const DEFAULT_MAX_PER_CHANNEL = 3;

/** Weight of a like relative to a view when measuring recent activity. */
export const LIKE_ACTIVITY_WEIGHT = 5;

/** Smoothing prior for the engagement rate: behave like `PRIOR_VIEWS` views with a `PRIOR_RATE` like rate. */
export const ENGAGEMENT_PRIOR = { rate: 0.03, views: 50 } as const;
/** A like rate at or above this counts as full engagement (1.0). */
export const ENGAGEMENT_FULL_RATE = 0.1;

/** Reference points for the log scales: 1,000,000 views = full popularity, 1,000 weighted events = full recent activity. */
export const POPULARITY_REFERENCE_VIEWS = 1_000_000;
export const ACTIVITY_REFERENCE_EVENTS = 1_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VideoSignals = {
  id: string;
  channelId: string;
  categoryId: string | null;
  tags: readonly string[];
  viewCount: number;
  likeCount: number;
  publishedAt: Date;
  /** Views (REAL + SEED) inside the trending window. */
  windowViews: number;
  /** Likes inside the trending window. */
  windowLikes: number;
};

/** What the viewer has already seen: 0 = nothing, 1 = finished. */
export type WatchedState = { fraction: number; completed: boolean };

export type ViewerSignals = {
  followedChannelIds: ReadonlySet<string>;
  watched: ReadonlyMap<string, WatchedState>;
  /** 0..1 — normalized so the strongest category/tag/channel is 1. */
  categoryAffinity: ReadonlyMap<string, number>;
  tagAffinity: ReadonlyMap<string, number>;
  channelAffinity: ReadonlyMap<string, number>;
};

export const EMPTY_VIEWER: ViewerSignals = {
  followedChannelIds: new Set(),
  watched: new Map(),
  categoryAffinity: new Map(),
  tagAffinity: new Map(),
  channelAffinity: new Map(),
};

export type ScoreBreakdown = { total: number; parts: Record<string, number> };

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Tags are compared after the same folding used for search ("آموزش" = "اموزش", case-insensitive). */
export function normalizeTag(tag: string): string {
  return normalizeSearchText(tag);
}

/** Jaccard similarity |A ∩ B| / |A ∪ B| of two tag lists (0 when either is empty). */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a.map(normalizeTag).filter(Boolean));
  const setB = new Set(b.map(normalizeTag).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/** log10(1 + views) / log10(1 + 1,000,000), capped at 1. */
export function logPopularity(views: number): number {
  return clamp01(Math.log10(1 + Math.max(0, views)) / Math.log10(1 + POPULARITY_REFERENCE_VIEWS));
}

/** 0.5 ^ (age / halfLife): 1 for a brand-new video, 0.5 after one half-life. Future dates count as brand new. */
export function recencyDecay(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

export function ageInDays(publishedAt: Date, now: Date): number {
  return (now.getTime() - publishedAt.getTime()) / DAY_MS;
}

/**
 * Bayesian-smoothed like rate, so a video with 1 view and 1 like does not outrank one with 10,000 views and 800 likes:
 * `(likes + prior.rate × prior.views) / (views + prior.views)`, scaled so `ENGAGEMENT_FULL_RATE` = 1.
 */
export function smoothedEngagement(likes: number, views: number): number {
  const l = Math.max(0, likes);
  const v = Math.max(0, views);
  const rate = (l + ENGAGEMENT_PRIOR.rate * ENGAGEMENT_PRIOR.views) / (v + ENGAGEMENT_PRIOR.views);
  return clamp01(rate / ENGAGEMENT_FULL_RATE);
}

/** Recent activity in the rolling window: log10(1 + views + 5 × likes) / log10(1 + 1,000), capped at 1. */
export function recentActivity(windowViews: number, windowLikes: number): number {
  const events = Math.max(0, windowViews) + LIKE_ACTIVITY_WEIGHT * Math.max(0, windowLikes);
  return clamp01(Math.log10(1 + events) / Math.log10(1 + ACTIVITY_REFERENCE_EVENTS));
}

/** How strongly "already watched" counts against a candidate: 1 when finished, `fraction` otherwise (ignored under 10 %). */
export function watchedPenaltyFactor(state: WatchedState | undefined): number {
  if (!state) return 0;
  if (state.completed) return 1;
  return state.fraction >= 0.1 ? clamp01(state.fraction) : 0;
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

function finish(parts: Record<string, number>): ScoreBreakdown {
  let total = 0;
  for (const value of Object.values(parts)) total += value;
  return { total: round6(total), parts };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export type RelatedSource = { id: string; channelId: string; categoryId: string | null; tags: readonly string[] };

/** Score `candidate` as a "related to `source`" video. */
export function scoreRelated(source: RelatedSource, candidate: VideoSignals, viewer: ViewerSignals | null, now: Date): ScoreBreakdown {
  const w = RELATED_WEIGHTS;
  const age = ageInDays(candidate.publishedAt, now);
  return finish({
    sameCategory: w.sameCategory * (source.categoryId && candidate.categoryId === source.categoryId ? 1 : 0),
    tagOverlap: w.tagOverlap * jaccard(source.tags, candidate.tags),
    sameChannel: w.sameChannel * (candidate.channelId === source.channelId ? 1 : 0),
    followedChannel: w.followedChannel * (viewer?.followedChannelIds.has(candidate.channelId) ? 1 : 0),
    popularity: w.popularity * logPopularity(candidate.viewCount),
    trending: w.trending * recentActivity(candidate.windowViews, candidate.windowLikes),
    recency: w.recency * recencyDecay(age, HALF_LIFE_DAYS.related),
    engagement: w.engagement * smoothedEngagement(candidate.likeCount, candidate.viewCount),
    watched: -w.watched * watchedPenaltyFactor(viewer?.watched.get(candidate.id)),
  });
}

/** Score `candidate` for the trending lists (no viewer involved: identical for everyone). */
export function scoreTrending(candidate: VideoSignals, now: Date): ScoreBreakdown {
  const w = TRENDING_WEIGHTS;
  return finish({
    recentActivity: w.recentActivity * recentActivity(candidate.windowViews, candidate.windowLikes),
    recency: w.recency * recencyDecay(ageInDays(candidate.publishedAt, now), HALF_LIFE_DAYS.trending),
    engagement: w.engagement * smoothedEngagement(candidate.likeCount, candidate.viewCount),
    popularity: w.popularity * logPopularity(candidate.viewCount),
  });
}

/** Score `candidate` for "recommended for you" using the viewer's own signals. */
export function scorePersonal(candidate: VideoSignals, viewer: ViewerSignals, now: Date): ScoreBreakdown {
  const w = PERSONAL_WEIGHTS;
  const tagAffinity = tagAffinityOf(candidate.tags, viewer.tagAffinity);
  return finish({
    categoryAffinity: w.categoryAffinity * (candidate.categoryId ? (viewer.categoryAffinity.get(candidate.categoryId) ?? 0) : 0),
    tagAffinity: w.tagAffinity * tagAffinity,
    channelAffinity: w.channelAffinity * (viewer.channelAffinity.get(candidate.channelId) ?? 0),
    followedChannel: w.followedChannel * (viewer.followedChannelIds.has(candidate.channelId) ? 1 : 0),
    popularity: w.popularity * logPopularity(candidate.viewCount),
    trending: w.trending * recentActivity(candidate.windowViews, candidate.windowLikes),
    recency: w.recency * recencyDecay(ageInDays(candidate.publishedAt, now), HALF_LIFE_DAYS.personal),
    engagement: w.engagement * smoothedEngagement(candidate.likeCount, candidate.viewCount),
    watched: -w.watched * watchedPenaltyFactor(viewer.watched.get(candidate.id)),
  });
}

/** Mean affinity of a candidate's tags with the viewer's tag profile (0 when the candidate has no tags). */
export function tagAffinityOf(tags: readonly string[], affinity: ReadonlyMap<string, number>): number {
  const normalized = [...new Set(tags.map(normalizeTag).filter(Boolean))];
  if (normalized.length === 0 || affinity.size === 0) return 0;
  let sum = 0;
  for (const t of normalized) sum += affinity.get(t) ?? 0;
  return sum / normalized.length;
}

// ---------------------------------------------------------------------------
// Viewer profile
// ---------------------------------------------------------------------------

export type HistoryEntry = {
  videoId: string;
  categoryId: string | null;
  channelId: string;
  tags: readonly string[];
  lastWatchedAt: Date;
  /** 0..1 share of the video the viewer watched (1 when completed). */
  fraction: number;
  completed: boolean;
};

export type LikeEntry = { categoryId: string | null; channelId: string; tags: readonly string[]; likedAt: Date };

/** Half-life (days) of a watch/like as a taste signal. */
export const PROFILE_HALF_LIFE_DAYS = 30;
/** Weight of an explicit like relative to a fully watched video. */
export const LIKE_PROFILE_WEIGHT = 1.5;
/** Videos watched less than this share barely say anything about taste. */
const MIN_TASTE_FRACTION = 0.1;

/**
 * Turn watch history + likes into 0..1 affinity maps (strongest = 1). Each entry counts
 * `fractionWatched × 0.5^(daysAgo / 30)`; a like counts `1.5 × 0.5^(daysAgo / 30)`.
 */
export function buildViewerProfile(
  history: readonly HistoryEntry[],
  likes: readonly LikeEntry[],
  followedChannelIds: Iterable<string>,
  now: Date,
): ViewerSignals {
  const category = new Map<string, number>();
  const tag = new Map<string, number>();
  const channel = new Map<string, number>();
  const watched = new Map<string, WatchedState>();

  const add = (map: Map<string, number>, key: string | null, weight: number) => {
    if (key) map.set(key, (map.get(key) ?? 0) + weight);
  };
  const addEntry = (e: { categoryId: string | null; channelId: string; tags: readonly string[] }, weight: number) => {
    add(category, e.categoryId, weight);
    add(channel, e.channelId, weight);
    for (const t of new Set(e.tags.map(normalizeTag).filter(Boolean))) add(tag, t, weight);
  };

  for (const h of history) {
    watched.set(h.videoId, { fraction: clamp01(h.fraction), completed: h.completed });
    const fraction = h.completed ? 1 : clamp01(h.fraction);
    if (fraction < MIN_TASTE_FRACTION) continue;
    addEntry(h, fraction * recencyDecay(ageInDays(h.lastWatchedAt, now), PROFILE_HALF_LIFE_DAYS));
  }
  for (const l of likes) addEntry(l, LIKE_PROFILE_WEIGHT * recencyDecay(ageInDays(l.likedAt, now), PROFILE_HALF_LIFE_DAYS));

  return {
    followedChannelIds: new Set(followedChannelIds),
    watched,
    categoryAffinity: normalizeToMax(category),
    tagAffinity: normalizeToMax(tag),
    channelAffinity: normalizeToMax(channel),
  };
}

function normalizeToMax(map: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of map.values()) max = Math.max(max, v);
  if (max <= 0) return new Map();
  return new Map([...map].map(([k, v]) => [k, round6(v / max)]));
}

/** True when the viewer has no usable taste signal (new account / no history, likes or follows). */
export function isColdStart(viewer: ViewerSignals): boolean {
  return viewer.followedChannelIds.size === 0 && viewer.categoryAffinity.size === 0 && viewer.channelAffinity.size === 0;
}

// ---------------------------------------------------------------------------
// Ranking helpers
// ---------------------------------------------------------------------------

export type Scored<T> = { item: T; score: number };

/** Highest score first; ties broken by id so the order never depends on input order. */
export function rankScored<T extends { id: string }>(items: readonly Scored<T>[]): Scored<T>[] {
  return [...items].sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
}

/**
 * Take the top `limit` items but at most `maxPerChannel` per channel. If that leaves the list short (a small
 * catalogue dominated by one channel) the remaining slots are back-filled from the skipped items, best first.
 */
export function diversifyByChannel<T extends { channelId: string }>(sorted: readonly T[], limit: number, maxPerChannel = DEFAULT_MAX_PER_CHANNEL): T[] {
  const picked: T[] = [];
  const skipped: T[] = [];
  const perChannel = new Map<string, number>();
  for (const item of sorted) {
    if (picked.length >= limit) break;
    const used = perChannel.get(item.channelId) ?? 0;
    if (used >= maxPerChannel) {
      skipped.push(item);
      continue;
    }
    perChannel.set(item.channelId, used + 1);
    picked.push(item);
  }
  for (const item of skipped) {
    if (picked.length >= limit) break;
    picked.push(item);
  }
  return picked;
}
