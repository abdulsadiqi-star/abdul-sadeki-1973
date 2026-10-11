/**
 * Tehran-day arithmetic for analytics (runtime-agnostic, pure).
 *
 * A **day key** is the Gregorian date `YYYY-MM-DD` of a *Tehran calendar day*. Statistics are bucketed by Tehran
 * day (SQL: see `features/analytics/sql.ts`), so every range in the engine is expressed in day keys and only
 * converted to UTC instants at the edges (`dayKeyToInstant`).
 *
 * Calendar arithmetic on keys uses UTC `Date`s purely as a Gregorian calendar (no time zone involved), which makes
 * it immune to DST. Iran abolished DST in 2022, so the Tehran offset is a fixed +03:30 for every date the product
 * deals with (the same assumption `lib/jalali.ts` makes); an integration test cross-checks this helper against the
 * database's own `Asia/Tehran` conversion.
 */
import {
  JALALI_MONTHS,
  TEHRAN_OFFSET_MINUTES,
  fromJalali,
  jalaliMonthLength,
  tehranDayKey,
  toJalali,
  type JalaliDate,
} from '@/lib/jalali';

export type DayKey = string;

export const DAY_MS = 86_400_000;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD`; `null` for malformed strings and impossible dates such as `2026-02-30`. */
export function parseDayKey(key: string): { y: number; m: number; d: number } | null {
  const match = DAY_KEY.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

export const isDayKey = (value: string): boolean => parseDayKey(value) !== null;

function calendarMs(key: DayKey): number {
  const p = parseDayKey(key);
  if (!p) throw new Error(`Invalid day key: ${JSON.stringify(key)}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}

const keyOf = (ms: number): DayKey => new Date(ms).toISOString().slice(0, 10);

export function addDaysToKey(key: DayKey, days: number): DayKey {
  return keyOf(calendarMs(key) + days * DAY_MS);
}

/** Number of days from `from` to `to` (negative when `to` is earlier). */
export function diffInDays(from: DayKey, to: DayKey): number {
  return Math.round((calendarMs(to) - calendarMs(from)) / DAY_MS);
}

/** Every day key from `from` to `to`, both inclusive. Empty when `to < from`. */
export function enumerateDayKeys(from: DayKey, to: DayKey): DayKey[] {
  const count = diffInDays(from, to) + 1;
  const out: DayKey[] = [];
  const start = calendarMs(from);
  for (let i = 0; i < count; i++) out.push(keyOf(start + i * DAY_MS));
  return out;
}

/** The UTC instant at which this Tehran day starts (00:00 +03:30). */
export function dayKeyToInstant(key: DayKey): Date {
  return new Date(calendarMs(key) - TEHRAN_OFFSET_MINUTES * 60_000);
}

/** An instant safely inside the Tehran day (12:00), for formatting a day key with `Intl`. */
export function dayKeyToNoon(key: DayKey): Date {
  return new Date(dayKeyToInstant(key).getTime() + 12 * 3_600_000);
}

/** The Tehran day key containing an instant. Matches the SQL bucketing exactly. */
export const instantToDayKey = (instant: Date): DayKey => tehranDayKey(instant);

export const todayKey = (now: Date = new Date()): DayKey => tehranDayKey(now);

// ---------------------------------------------------------------------------
// Jalali helpers (presentation calendar of the product)
// ---------------------------------------------------------------------------

export function dayKeyToJalali(key: DayKey): JalaliDate {
  return toJalali(dayKeyToNoon(key));
}

export function jalaliToDayKey(jy: number, jm: number, jd: number): DayKey {
  return tehranDayKey(fromJalali(jy, jm, jd, 12));
}

export type JalaliMonthRef = { jy: number; jm: number };

/** First and last Tehran day (as day keys) of a Jalali month. */
export function jalaliMonthDayKeys({ jy, jm }: JalaliMonthRef): { fromKey: DayKey; toKey: DayKey } {
  return { fromKey: jalaliToDayKey(jy, jm, 1), toKey: jalaliToDayKey(jy, jm, jalaliMonthLength(jy, jm)) };
}

/** Shift a Jalali month by `delta` months (negative = earlier), rolling the year. */
export function shiftJalaliMonth({ jy, jm }: JalaliMonthRef, delta: number): JalaliMonthRef {
  const index = jy * 12 + (jm - 1) + delta;
  return { jy: Math.floor(index / 12), jm: (index % 12) + 1 };
}

export const jalaliMonthOfKey = (key: DayKey): JalaliMonthRef => {
  const { jy, jm } = dayKeyToJalali(key);
  return { jy, jm };
};

export const jalaliMonthName = (jm: number): string => JALALI_MONTHS[jm - 1] ?? '';

/** Stable bucket key of a Jalali month: `1405-07`. */
export const jalaliMonthKey = ({ jy, jm }: JalaliMonthRef): string => `${jy}-${String(jm).padStart(2, '0')}`;
