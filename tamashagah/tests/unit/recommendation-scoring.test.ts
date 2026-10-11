import { describe, expect, it } from 'vitest';
import {
  EMPTY_VIEWER,
  ENGAGEMENT_FULL_RATE,
  ENGAGEMENT_PRIOR,
  HALF_LIFE_DAYS,
  PERSONAL_WEIGHTS,
  RELATED_WEIGHTS,
  TRENDING_WEIGHTS,
  buildViewerProfile,
  diversifyByChannel,
  isColdStart,
  jaccard,
  logPopularity,
  rankScored,
  recencyDecay,
  recentActivity,
  scorePersonal,
  scoreRelated,
  scoreTrending,
  smoothedEngagement,
  tagAffinityOf,
  watchedPenaltyFactor,
  type VideoSignals,
  type ViewerSignals,
} from '@/features/recommendations/scoring';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const video = (over: Partial<VideoSignals> = {}): VideoSignals => ({
  id: 'v1',
  channelId: 'c1',
  categoryId: 'cat1',
  tags: [],
  viewCount: 0,
  likeCount: 0,
  publishedAt: NOW,
  windowViews: 0,
  windowLikes: 0,
  ...over,
});

const sum = (o: Record<string, number>, skip: string[] = []) =>
  Object.entries(o)
    .filter(([k]) => !skip.includes(k))
    .reduce((a, [, v]) => a + v, 0);

describe('weights', () => {
  it('positive weights of every list sum to exactly 1 so scores stay in [0, 1]', () => {
    expect(sum(RELATED_WEIGHTS, ['watched'])).toBeCloseTo(1, 10);
    expect(sum(TRENDING_WEIGHTS)).toBeCloseTo(1, 10);
    expect(sum(PERSONAL_WEIGHTS, ['watched'])).toBeCloseTo(1, 10);
  });
});

describe('signals', () => {
  it('jaccard: identical, disjoint, partial, empty', () => {
    expect(jaccard(['a', 'b'], ['b', 'a'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(2 / 4);
    expect(jaccard([], ['a'])).toBe(0);
    expect(jaccard([], [])).toBe(0);
  });

  it('jaccard compares tags with the search folding (Arabic yeh/kaf, case, ZWNJ, digits)', () => {
    expect(jaccard(['آموزش'], ['اموزش'])).toBe(1);
    expect(jaccard(['علي'], ['علی'])).toBe(1);
    expect(jaccard(['Python'], ['python'])).toBe(1);
    expect(jaccard(['می‌خواهم'], ['می خواهم'])).toBe(1);
    expect(jaccard(['۲۰۲۶'], ['2026'])).toBe(1);
  });

  it('logPopularity is monotonic, 0 for no views and capped at 1', () => {
    expect(logPopularity(0)).toBe(0);
    expect(logPopularity(-5)).toBe(0);
    expect(logPopularity(10)).toBeLessThan(logPopularity(1_000));
    expect(logPopularity(1_000)).toBeLessThan(logPopularity(100_000));
    expect(logPopularity(1_000_000)).toBeCloseTo(1, 10);
    expect(logPopularity(50_000_000)).toBe(1);
  });

  it('recencyDecay halves after one half-life and never exceeds 1', () => {
    expect(recencyDecay(0, 14)).toBe(1);
    expect(recencyDecay(14, 14)).toBeCloseTo(0.5, 10);
    expect(recencyDecay(28, 14)).toBeCloseTo(0.25, 10);
    expect(recencyDecay(-3, 14)).toBe(1); // clock skew / scheduled publish
  });

  it('smoothedEngagement uses a prior so tiny samples cannot win', () => {
    const prior = ENGAGEMENT_PRIOR.rate / ENGAGEMENT_FULL_RATE;
    expect(smoothedEngagement(0, 0)).toBeCloseTo(prior, 10);
    // 1 view / 1 like is NOT a 100 % like rate…
    expect(smoothedEngagement(1, 1)).toBeLessThan(0.5);
    // …while a proven 8 % rate over 10k views is high.
    expect(smoothedEngagement(800, 10_000)).toBeGreaterThan(0.7);
    expect(smoothedEngagement(800, 10_000)).toBeGreaterThan(smoothedEngagement(1, 1));
    expect(smoothedEngagement(5_000, 100)).toBe(1); // capped
  });

  it('recentActivity grows with views and likes (a like counts 5 views)', () => {
    expect(recentActivity(0, 0)).toBe(0);
    expect(recentActivity(100, 0)).toBeGreaterThan(recentActivity(10, 0));
    expect(recentActivity(0, 20)).toBeCloseTo(recentActivity(100, 0), 10);
    expect(recentActivity(100_000, 0)).toBe(1);
  });

  it('watchedPenaltyFactor: finished = 1, barely started = 0, partial = fraction', () => {
    expect(watchedPenaltyFactor(undefined)).toBe(0);
    expect(watchedPenaltyFactor({ completed: true, fraction: 1 })).toBe(1);
    expect(watchedPenaltyFactor({ completed: false, fraction: 0.05 })).toBe(0);
    expect(watchedPenaltyFactor({ completed: false, fraction: 0.6 })).toBe(0.6);
  });
});

describe('scoreRelated', () => {
  const source = { id: 'src', channelId: 'c1', categoryId: 'cat1', tags: ['a', 'b'] };

  it('is deterministic for the same inputs', () => {
    const c = video({ id: 'x', tags: ['a'], viewCount: 500, likeCount: 20, windowViews: 40, publishedAt: daysBefore(3) });
    expect(scoreRelated(source, c, null, NOW)).toEqual(scoreRelated(source, c, null, NOW));
  });

  it('adds exactly the documented components', () => {
    const c = video({ id: 'x', channelId: 'c2', categoryId: 'cat1', tags: ['a', 'z'], viewCount: 0, likeCount: 0, publishedAt: daysBefore(HALF_LIFE_DAYS.related) });
    const r = scoreRelated(source, c, null, NOW);
    expect(r.parts.sameCategory).toBeCloseTo(RELATED_WEIGHTS.sameCategory, 10);
    expect(r.parts.tagOverlap).toBeCloseTo(RELATED_WEIGHTS.tagOverlap * (1 / 3), 10);
    expect(r.parts.sameChannel).toBe(0);
    expect(r.parts.followedChannel).toBe(0);
    expect(r.parts.popularity).toBe(0);
    expect(r.parts.trending).toBe(0);
    expect(r.parts.recency).toBeCloseTo(RELATED_WEIGHTS.recency * 0.5, 10);
    expect(r.parts.engagement).toBeCloseTo(RELATED_WEIGHTS.engagement * (ENGAGEMENT_PRIOR.rate / ENGAGEMENT_FULL_RATE), 10);
    expect(r.parts.watched).toBe(-0);
    expect(r.total).toBeCloseTo(sum(r.parts), 5);
  });

  it('prefers same category + tags over an unrelated, equally popular video', () => {
    const related = video({ id: 'r', channelId: 'c2', categoryId: 'cat1', tags: ['a', 'b'], viewCount: 1000 });
    const other = video({ id: 'o', channelId: 'c3', categoryId: 'cat9', tags: ['q'], viewCount: 1000 });
    expect(scoreRelated(source, related, null, NOW).total).toBeGreaterThan(scoreRelated(source, other, null, NOW).total);
  });

  it('boosts followed channels and penalizes what the viewer already finished', () => {
    const c = video({ id: 'x', channelId: 'c2', viewCount: 100 });
    const base = scoreRelated(source, c, EMPTY_VIEWER, NOW).total;
    const followed: ViewerSignals = { ...EMPTY_VIEWER, followedChannelIds: new Set(['c2']) };
    const finished: ViewerSignals = { ...EMPTY_VIEWER, watched: new Map([['x', { completed: true, fraction: 1 }]]) };
    expect(scoreRelated(source, c, followed, NOW).total).toBeCloseTo(base + RELATED_WEIGHTS.followedChannel, 6);
    expect(scoreRelated(source, c, finished, NOW).total).toBeCloseTo(base - RELATED_WEIGHTS.watched, 6);
  });

  it('a fresh, trending video outranks an old one with the same static signals', () => {
    const fresh = video({ id: 'f', viewCount: 100, publishedAt: daysBefore(1), windowViews: 80 });
    const stale = video({ id: 's', viewCount: 100, publishedAt: daysBefore(200), windowViews: 0 });
    expect(scoreRelated(source, fresh, null, NOW).total).toBeGreaterThan(scoreRelated(source, stale, null, NOW).total);
  });
});

describe('scoreTrending', () => {
  it('recent activity beats a bigger lifetime total', () => {
    const surging = video({ id: 'a', viewCount: 300, windowViews: 250, windowLikes: 20, publishedAt: daysBefore(2) });
    const legacy = video({ id: 'b', viewCount: 90_000, windowViews: 3, publishedAt: daysBefore(400) });
    expect(scoreTrending(surging, NOW).total).toBeGreaterThan(scoreTrending(legacy, NOW).total);
  });

  it('with no events at all, falls back to recency + popularity prior (cold start)', () => {
    const newer = video({ id: 'a', viewCount: 10, publishedAt: daysBefore(1) });
    const older = video({ id: 'b', viewCount: 10, publishedAt: daysBefore(60) });
    expect(scoreTrending(newer, NOW).total).toBeGreaterThan(scoreTrending(older, NOW).total);
    expect(scoreTrending(newer, NOW).parts.recentActivity).toBe(0);
  });

  it('stays inside [0, 1]', () => {
    const maxed = video({ viewCount: 5e8, likeCount: 5e7, windowViews: 1e7, windowLikes: 1e6, publishedAt: NOW });
    expect(scoreTrending(maxed, NOW).total).toBeLessThanOrEqual(1.000001);
    expect(scoreTrending(video(), NOW).total).toBeGreaterThanOrEqual(0);
  });
});

describe('viewer profile and scorePersonal', () => {
  const history = [
    { videoId: 'h1', categoryId: 'cooking', channelId: 'chefs', tags: ['پخت', 'غذا'], lastWatchedAt: daysBefore(1), fraction: 1, completed: true },
    { videoId: 'h2', categoryId: 'cooking', channelId: 'chefs', tags: ['غذا'], lastWatchedAt: daysBefore(2), fraction: 0.8, completed: false },
    { videoId: 'h3', categoryId: 'tech', channelId: 'geeks', tags: ['گجت'], lastWatchedAt: daysBefore(90), fraction: 1, completed: true },
    { videoId: 'h4', categoryId: 'sports', channelId: 'fit', tags: [], lastWatchedAt: daysBefore(1), fraction: 0.04, completed: false },
  ];

  it('normalizes affinities to 0..1 with the strongest = 1 and weights recent/complete watches more', () => {
    const p = buildViewerProfile(history, [], [], NOW);
    expect(p.categoryAffinity.get('cooking')).toBe(1);
    expect(p.categoryAffinity.get('tech')).toBeLessThan(0.2); // watched 90 days ago
    expect(p.tagAffinity.get('غذا')).toBe(1);
    expect(p.channelAffinity.get('chefs')).toBe(1);
  });

  it('ignores barely-started videos for taste but still records them as watched', () => {
    const p = buildViewerProfile(history, [], [], NOW);
    expect(p.categoryAffinity.has('sports')).toBe(false);
    expect(p.watched.get('h4')).toEqual({ completed: false, fraction: 0.04 });
    expect(p.watched.get('h1')).toEqual({ completed: true, fraction: 1 });
  });

  it('likes strengthen the profile', () => {
    const p = buildViewerProfile([], [{ categoryId: 'music', channelId: 'band', tags: ['راک'], likedAt: daysBefore(1) }], [], NOW);
    expect(p.categoryAffinity.get('music')).toBe(1);
    expect(p.tagAffinity.get('راک')).toBe(1);
  });

  it('isColdStart is true only without any history, likes or follows', () => {
    expect(isColdStart(buildViewerProfile([], [], [], NOW))).toBe(true);
    expect(isColdStart(buildViewerProfile([], [], ['c1'], NOW))).toBe(false);
    expect(isColdStart(buildViewerProfile(history, [], [], NOW))).toBe(false);
  });

  it('ranks videos in a watched category/channel above unrelated ones and below nothing finished', () => {
    const p = buildViewerProfile(history, [], ['chefs'], NOW);
    const aligned = video({ id: 'a', categoryId: 'cooking', channelId: 'chefs', tags: ['غذا'], viewCount: 50 });
    const unrelated = video({ id: 'u', categoryId: 'news', channelId: 'other', tags: ['خبر'], viewCount: 50 });
    const finished = video({ id: 'h1', categoryId: 'cooking', channelId: 'chefs', tags: ['غذا'], viewCount: 50 });
    const sa = scorePersonal(aligned, p, NOW).total;
    expect(sa).toBeGreaterThan(scorePersonal(unrelated, p, NOW).total);
    expect(scorePersonal(finished, p, NOW).total).toBeCloseTo(sa - PERSONAL_WEIGHTS.watched, 6);
  });

  it('tagAffinityOf averages over the candidate tags', () => {
    const aff = new Map([['a', 1], ['b', 0.5]]);
    expect(tagAffinityOf(['a', 'b'], aff)).toBeCloseTo(0.75);
    expect(tagAffinityOf(['a', 'x'], aff)).toBeCloseTo(0.5);
    expect(tagAffinityOf([], aff)).toBe(0);
  });
});

describe('ranking helpers', () => {
  it('rankScored sorts by score desc and breaks ties by id regardless of input order', () => {
    const items = [
      { item: { id: 'b' }, score: 0.5 },
      { item: { id: 'a' }, score: 0.5 },
      { item: { id: 'c' }, score: 0.9 },
    ];
    expect(rankScored(items).map((s) => s.item.id)).toEqual(['c', 'a', 'b']);
    expect(rankScored([...items].reverse()).map((s) => s.item.id)).toEqual(['c', 'a', 'b']);
  });

  it('diversifyByChannel caps per channel but back-fills when the catalogue is small', () => {
    const list = [
      { id: '1', channelId: 'A' },
      { id: '2', channelId: 'A' },
      { id: '3', channelId: 'A' },
      { id: '4', channelId: 'A' },
      { id: '5', channelId: 'B' },
      { id: '6', channelId: 'C' },
    ];
    expect(diversifyByChannel(list, 5, 2).map((x) => x.id)).toEqual(['1', '2', '5', '6', '3']);
    expect(diversifyByChannel(list, 4, 2).map((x) => x.id)).toEqual(['1', '2', '5', '6']);
    // only one channel exists → still returns what is available
    expect(diversifyByChannel(list.slice(0, 4), 3, 1).map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(diversifyByChannel([], 5)).toEqual([]);
  });
});
