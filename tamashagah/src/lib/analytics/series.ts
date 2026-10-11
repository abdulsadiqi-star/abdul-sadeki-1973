/**
 * Pure helpers that turn sparse SQL aggregates into gap-filled chart series (runtime-agnostic).
 *
 * SQL only returns the days that HAVE rows. `bucketize` walks the range's buckets and emits one point per
 * bucket — zero-filled — so charts and tables never skip a quiet day. Daily rows are additive, so monthly
 * points are plain sums of their days; the one non-additive metric (distinct viewers) must be supplied
 * per bucket by the caller.
 */
import type { Bucket } from './ranges';
import { enumerateDayKeys, type DayKey } from './time';

/** What the database aggregates for ONE Tehran day. */
export type DailyAggregate = {
  views: number;
  /** Distinct `viewerKey`s that day (not additive across days). */
  uniqueViewers: number;
  watchSeconds: number;
  likes: number;
  /** Approved comments created that day. */
  comments: number;
  newFollowers: number;
  unfollows: number;
  /** How many of `views` are `source = SEED`. */
  seedViews: number;
  /** How many follow/unfollow events are `source = SEED`. */
  seedFollowEvents: number;
};

export const emptyDaily = (): DailyAggregate => ({
  views: 0,
  uniqueViewers: 0,
  watchSeconds: 0,
  likes: 0,
  comments: 0,
  newFollowers: 0,
  unfollows: 0,
  seedViews: 0,
  seedFollowEvents: 0,
});

/** One point of a (daily or monthly) series. */
export type SeriesPoint = DailyAggregate & {
  key: string;
  fromKey: DayKey;
  toKey: DayKey;
  /** `newFollowers - unfollows` */
  netFollowers: number;
};

/**
 * Zero-filled points for `buckets`.
 *  - daily buckets read their day straight from `daily`;
 *  - monthly buckets sum the days they cover, and take `uniqueViewers` from `uniqueByBucket`
 *    (distinct counts cannot be summed).
 */
export function bucketize(
  buckets: readonly Bucket[],
  daily: ReadonlyMap<DayKey, DailyAggregate>,
  uniqueByBucket?: ReadonlyMap<string, number>,
): SeriesPoint[] {
  return buckets.map((bucket) => {
    const total = emptyDaily();
    const days = bucket.fromKey === bucket.toKey ? [bucket.fromKey] : enumerateDayKeys(bucket.fromKey, bucket.toKey);
    for (const day of days) {
      const row = daily.get(day);
      if (!row) continue;
      total.views += row.views;
      total.watchSeconds += row.watchSeconds;
      total.likes += row.likes;
      total.comments += row.comments;
      total.newFollowers += row.newFollowers;
      total.unfollows += row.unfollows;
      total.seedViews += row.seedViews;
      total.seedFollowEvents += row.seedFollowEvents;
      if (days.length === 1) total.uniqueViewers = row.uniqueViewers;
    }
    if (days.length > 1) total.uniqueViewers = uniqueByBucket?.get(bucket.key) ?? 0;
    return { ...total, key: bucket.key, fromKey: bucket.fromKey, toKey: bucket.toKey, netFollowers: total.newFollowers - total.unfollows };
  });
}

/** Sum of a daily map over `fromKey…toKey` (inclusive). Used for range totals and previous-period totals. */
export function sumDaily(daily: ReadonlyMap<DayKey, DailyAggregate>, fromKey: DayKey, toKey: DayKey): DailyAggregate {
  const total = emptyDaily();
  for (const [day, row] of daily) {
    if (day < fromKey || day > toKey) continue; // ISO day keys sort chronologically as strings
    total.views += row.views;
    total.watchSeconds += row.watchSeconds;
    total.likes += row.likes;
    total.comments += row.comments;
    total.newFollowers += row.newFollowers;
    total.unfollows += row.unfollows;
    total.seedViews += row.seedViews;
    total.seedFollowEvents += row.seedFollowEvents;
  }
  return total;
}

/**
 * Percentage change from `previous` to `current`, rounded to one decimal.
 * `null` when it is not defined: nothing to compare against (previous = 0, current ≠ 0).
 * 0 → 0 is a (boring but true) 0 % change. The denominator is |previous|, so an improvement from a negative
 * baseline (net follower growth −5 → −2) reads as a positive change.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** `sum / count`, or 0 when there is nothing to average. */
export const average = (sum: number, count: number): number => (count > 0 ? sum / count : 0);

/** Seconds → minutes (floating point; round at the presentation layer). */
export const secondsToMinutes = (seconds: number): number => seconds / 60;

/** Seconds → hours. */
export const secondsToHours = (seconds: number): number => seconds / 3600;
