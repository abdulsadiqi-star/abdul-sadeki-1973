import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatJalaliNumeric,
  fromJalali,
  isJalaliLeapYear,
  jalaliMonthLength,
  jalaliMonthRange,
  jalaliWeekday,
  parseJalaliString,
  startOfTehranDay,
  tehranDayKey,
  tehranWallClock,
  toJalali,
} from '@/lib/jalali';

describe('Jalali conversion', () => {
  it('converts well-known dates', () => {
    expect(toJalali(new Date('2026-09-22T10:00:00Z'))).toEqual({ jy: 1405, jm: 6, jd: 31 });
    expect(toJalali(new Date('2026-03-21T10:00:00Z'))).toEqual({ jy: 1405, jm: 1, jd: 1 }); // Nowruz 1405
    expect(toJalali(new Date('2025-03-21T12:00:00Z'))).toEqual({ jy: 1404, jm: 1, jd: 1 }); // equinox after noon Tehran → 21 March
    expect(toJalali(new Date('2025-03-20T12:00:00Z'))).toEqual({ jy: 1403, jm: 12, jd: 30 });
  });
  it('round-trips through the Tehran wall clock', () => {
    const instant = fromJalali(1405, 6, 31, 13, 30);
    expect(instant.toISOString()).toBe('2026-09-22T10:00:00.000Z');
    expect(toJalali(instant)).toEqual({ jy: 1405, jm: 6, jd: 31 });
    const wall = tehranWallClock(instant);
    expect([wall.hour, wall.minute]).toEqual([13, 30]);
  });
  it('knows month lengths and leap years', () => {
    expect(jalaliMonthLength(1405, 1)).toBe(31);
    expect(jalaliMonthLength(1405, 6)).toBe(31);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
    expect(jalaliMonthLength(1405, 12)).toBe(29);
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
  });
  it('computes month ranges as [from, to)', () => {
    const { from, to } = jalaliMonthRange(1405, 6);
    expect(tehranDayKey(from)).toBe('2026-08-23');
    expect(tehranDayKey(to)).toBe('2026-09-23');
    expect(to.getTime() - from.getTime()).toBe(31 * 86_400_000);
  });
  it('handles Esfand → Farvardin rollover', () => {
    const { from, to } = jalaliMonthRange(1405, 12);
    expect(toJalali(from)).toEqual({ jy: 1405, jm: 12, jd: 1 });
    expect(toJalali(to)).toEqual({ jy: 1406, jm: 1, jd: 1 });
  });
});

describe('Tehran day helpers', () => {
  it('buckets by Tehran day (not UTC)', () => {
    expect(tehranDayKey(new Date('2026-09-22T20:29:59Z'))).toBe('2026-09-22');
    expect(tehranDayKey(new Date('2026-09-22T20:30:00Z'))).toBe('2026-09-23');
  });
  it('finds the start of the Tehran day as a UTC instant', () => {
    expect(startOfTehranDay(new Date('2026-09-22T10:00:00Z')).toISOString()).toBe('2026-09-21T20:30:00.000Z');
    expect(addDays(startOfTehranDay(new Date('2026-09-22T10:00:00Z')), 1).toISOString()).toBe('2026-09-22T20:30:00.000Z');
  });
  it('starts the week on Saturday', () => {
    expect(jalaliWeekday(new Date('2026-10-10T10:00:00Z'))).toBe(0); // Saturday
    expect(jalaliWeekday(new Date('2026-10-16T10:00:00Z'))).toBe(6); // Friday
  });
});

describe('parsing', () => {
  it('parses Persian and ASCII strings', () => {
    expect(parseJalaliString('1405/06/31')).toEqual({ jy: 1405, jm: 6, jd: 31 });
    expect(parseJalaliString('۱۴۰۵-۶-۳۱')).toEqual({ jy: 1405, jm: 6, jd: 31 });
  });
  it('rejects invalid dates', () => {
    expect(parseJalaliString('1405/12/30')).toBeNull(); // 1405 is not a leap year
    expect(parseJalaliString('1403/12/30')).toEqual({ jy: 1403, jm: 12, jd: 30 });
    expect(parseJalaliString('1405/13/01')).toBeNull();
    expect(parseJalaliString('hello')).toBeNull();
  });
  it('formats numerically', () => {
    expect(formatJalaliNumeric({ jy: 1405, jm: 6, jd: 3 })).toBe('1405/06/03');
  });
});
