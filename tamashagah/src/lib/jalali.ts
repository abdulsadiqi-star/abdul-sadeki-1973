/**
 * Jalali (Persian / Solar Hijri) calendar helpers. All conversions use the
 * Asia/Tehran wall clock. Iran abolished DST in 2022, so the offset is a fixed
 * +03:30 for every date this product deals with.
 *
 * Instants are always JS `Date`s (UTC). Only *presentation* is Jalali.
 */
import * as jalaali from 'jalaali-js';

export const TEHRAN_TZ = 'Asia/Tehran';
export const TEHRAN_OFFSET_MINUTES = 210;

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
] as const;

/** Week starts on Saturday in Iran. Index 0 = Saturday. */
export const JALALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'] as const;

export type JalaliDate = { jy: number; jm: number; jd: number };
export type GregorianDate = { gy: number; gm: number; gd: number };

const tehranParts = new Intl.DateTimeFormat('en-US-u-nu-latn-ca-gregory', {
  timeZone: TEHRAN_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/** Gregorian wall-clock components of an instant in Tehran. */
export function tehranWallClock(date: Date): GregorianDate & { hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(tehranParts.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    gy: Number(parts.year),
    gm: Number(parts.month),
    gd: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function toJalali(date: Date): JalaliDate {
  const { gy, gm, gd } = tehranWallClock(date);
  const { jy, jm, jd } = jalaali.toJalaali(gy, gm, gd);
  return { jy, jm, jd };
}

/** Tehran wall-clock Jalali date/time → UTC instant. */
export function fromJalali(jy: number, jm: number, jd: number, hour = 0, minute = 0, second = 0): Date {
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
  const utcMs = Date.UTC(gy, gm - 1, gd, hour, minute, second) - TEHRAN_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}

export function isValidJalaliDate(jy: number, jm: number, jd: number): boolean {
  return jalaali.isValidJalaaliDate(jy, jm, jd);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  return jalaali.jalaaliMonthLength(jy, jm);
}

export function isJalaliLeapYear(jy: number): boolean {
  return jalaali.isLeapJalaaliYear(jy);
}

/** Instant range [from, to) covering a whole Jalali month in Tehran time. */
export function jalaliMonthRange(jy: number, jm: number): { from: Date; to: Date } {
  const from = fromJalali(jy, jm, 1);
  const nextY = jm === 12 ? jy + 1 : jy;
  const nextM = jm === 12 ? 1 : jm + 1;
  return { from, to: fromJalali(nextY, nextM, 1) };
}

/** 0 = Saturday … 6 = Friday, for the Tehran calendar day of the instant. */
export function jalaliWeekday(date: Date): number {
  const { gy, gm, gd } = tehranWallClock(date);
  const dow = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay(); // 0 = Sunday
  return (dow + 1) % 7;
}

/** Start of the Tehran calendar day containing `date`, as a UTC instant. */
export function startOfTehranDay(date: Date): Date {
  const { gy, gm, gd } = tehranWallClock(date);
  return new Date(Date.UTC(gy, gm - 1, gd) - TEHRAN_OFFSET_MINUTES * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** 'YYYY-MM-DD' (Gregorian) of the Tehran day containing `date`. Matches SQL date bucketing. */
export function tehranDayKey(date: Date): string {
  const { gy, gm, gd } = tehranWallClock(date);
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

/** Parse "1405/06/31" (ASCII or Persian digits, / or - separators). */
export function parseJalaliString(input: string): JalaliDate | null {
  const ascii = input.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const m = /^\s*(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\s*$/.exec(ascii);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  return isValidJalaliDate(jy, jm, jd) ? { jy, jm, jd } : null;
}

export function formatJalaliNumeric({ jy, jm, jd }: JalaliDate): string {
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}
