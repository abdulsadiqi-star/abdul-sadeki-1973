/**
 * Date-range presets for the analytics engine (runtime-agnostic, pure).
 *
 *   resolveRange({ preset: 'thisMonth' }, now)   // ماه جاری شمسی: first day of the Jalali month … today
 *
 * Every range is a set of whole Tehran days, inclusive on both ends (`fromKey`…`toKey`), plus the equivalent UTC
 * instants `[from, to)` for SQL. A *previous period* of the same length directly before the range is always
 * computed for % comparisons. `buckets` are the (gap-free) chart points: one per day, or one per Jalali month that
 * intersects the range when `granularity` is `month`.
 */
import { Errors } from '@/lib/errors';
import { toPersianDigits } from '@/lib/persian';
import {
  addDaysToKey,
  dayKeyToInstant,
  diffInDays,
  enumerateDayKeys,
  isDayKey,
  jalaliMonthDayKeys,
  jalaliMonthKey,
  jalaliMonthOfKey,
  shiftJalaliMonth,
  todayKey,
  type DayKey,
} from './time';

export const RANGE_PRESETS = ['last7', 'last30', 'last90', 'thisMonth', 'lastMonth', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type Granularity = 'day' | 'month';

/** Upper bound of a custom range (two years). Keeps every aggregation and chart cheap. */
export const MAX_RANGE_DAYS = 731;

export type RangeInput = {
  preset?: RangePreset;
  /** Custom range only: first Tehran day, `YYYY-MM-DD`. */
  from?: string | null;
  /** Custom range only: last Tehran day (inclusive), `YYYY-MM-DD`. */
  to?: string | null;
  granularity?: Granularity;
};

export type PeriodBounds = {
  /** First Tehran day (inclusive). */
  fromKey: DayKey;
  /** Last Tehran day (inclusive). */
  toKey: DayKey;
  /** Start of `fromKey` as a UTC instant (inclusive bound for SQL). */
  from: Date;
  /** Start of the day AFTER `toKey` as a UTC instant (exclusive bound for SQL). */
  to: Date;
  days: number;
};

/** One chart point: a Tehran day or the part of a Jalali month that lies inside the range. */
export type Bucket = {
  /** `YYYY-MM-DD` for daily buckets, `1405-07` for monthly ones. */
  key: string;
  fromKey: DayKey;
  toKey: DayKey;
  from: Date;
  to: Date;
};

export type ResolvedRange = PeriodBounds & {
  preset: RangePreset;
  granularity: Granularity;
  /** Same number of days, directly before `fromKey`. */
  previous: PeriodBounds;
  buckets: Bucket[];
};

export function periodOf(fromKey: DayKey, toKey: DayKey): PeriodBounds {
  return {
    fromKey,
    toKey,
    from: dayKeyToInstant(fromKey),
    to: dayKeyToInstant(addDaysToKey(toKey, 1)),
    days: diffInDays(fromKey, toKey) + 1,
  };
}

const bucketOf = (key: string, fromKey: DayKey, toKey: DayKey): Bucket => ({
  key,
  fromKey,
  toKey,
  from: dayKeyToInstant(fromKey),
  to: dayKeyToInstant(addDaysToKey(toKey, 1)),
});

/** Chart buckets for `fromKey…toKey`. Monthly buckets are Jalali months clipped to the range. */
export function buildBuckets(fromKey: DayKey, toKey: DayKey, granularity: Granularity): Bucket[] {
  if (granularity === 'day') return enumerateDayKeys(fromKey, toKey).map((key) => bucketOf(key, key, key));

  const buckets: Bucket[] = [];
  const last = jalaliMonthOfKey(toKey);
  for (let month = jalaliMonthOfKey(fromKey); ; month = shiftJalaliMonth(month, 1)) {
    const bounds = jalaliMonthDayKeys(month);
    // Day keys are ISO dates, so plain string comparison orders them chronologically.
    buckets.push(bucketOf(jalaliMonthKey(month), bounds.fromKey < fromKey ? fromKey : bounds.fromKey, bounds.toKey > toKey ? toKey : bounds.toKey));
    if (month.jy === last.jy && month.jm === last.jm) break;
  }
  return buckets;
}

/** The last `count` Jalali months ending with the current (partial) one, oldest first. */
export function trailingJalaliMonthBuckets(count: number, now: Date = new Date()): Bucket[] {
  const today = todayKey(now);
  const first = shiftJalaliMonth(jalaliMonthOfKey(today), -(count - 1));
  return buildBuckets(jalaliMonthDayKeys(first).fromKey, today, 'month');
}

const invalid = (field: 'from' | 'to' | 'range', message: string) => Errors.validation({ [field]: [message] }, message);

export function resolveRange(input: RangeInput = {}, now: Date = new Date()): ResolvedRange {
  const preset = input.preset ?? 'last30';
  const granularity = input.granularity ?? 'day';
  const today = todayKey(now);

  let fromKey: DayKey;
  let toKey: DayKey = today;

  switch (preset) {
    case 'last7':
      fromKey = addDaysToKey(today, -6);
      break;
    case 'last30':
      fromKey = addDaysToKey(today, -29);
      break;
    case 'last90':
      fromKey = addDaysToKey(today, -89);
      break;
    case 'thisMonth':
      fromKey = jalaliMonthDayKeys(jalaliMonthOfKey(today)).fromKey;
      break;
    case 'lastMonth': {
      const bounds = jalaliMonthDayKeys(shiftJalaliMonth(jalaliMonthOfKey(today), -1));
      fromKey = bounds.fromKey;
      toKey = bounds.toKey;
      break;
    }
    case 'custom': {
      if (!input.from || !input.to) throw invalid('range', 'برای بازه‌ی سفارشی، تاریخ شروع و پایان را انتخاب کنید.');
      if (!isDayKey(input.from)) throw invalid('from', 'تاریخ شروع معتبر نیست.');
      if (!isDayKey(input.to)) throw invalid('to', 'تاریخ پایان معتبر نیست.');
      if (input.from > today) throw invalid('from', 'تاریخ شروع نمی‌تواند در آینده باشد.');
      fromKey = input.from;
      toKey = input.to > today ? today : input.to; // there is no data from the future
      if (fromKey > toKey) throw invalid('range', 'تاریخ شروع باید پیش از تاریخ پایان باشد.');
      if (diffInDays(fromKey, toKey) + 1 > MAX_RANGE_DAYS) {
        throw invalid('range', `بازه‌ی انتخابی نباید بیشتر از ${toPersianDigits(MAX_RANGE_DAYS)} روز باشد.`);
      }
      break;
    }
    default:
      throw invalid('range', 'بازه‌ی زمانی نامعتبر است.');
  }

  const current = periodOf(fromKey, toKey);
  const previousTo = addDaysToKey(fromKey, -1);
  const previous = periodOf(addDaysToKey(previousTo, -(current.days - 1)), previousTo);
  return { ...current, preset, granularity, previous, buckets: buildBuckets(fromKey, toKey, granularity) };
}
