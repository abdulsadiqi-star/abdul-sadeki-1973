import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  dayKeyToInstant,
  dayKeyToJalali,
  diffInDays,
  enumerateDayKeys,
  instantToDayKey,
  isDayKey,
  jalaliMonthDayKeys,
  jalaliMonthKey,
  jalaliMonthOfKey,
  jalaliToDayKey,
  parseDayKey,
  shiftJalaliMonth,
  todayKey,
} from '@/lib/analytics/time';

describe('day keys', () => {
  it('parses valid keys and rejects malformed or impossible dates', () => {
    expect(parseDayKey('2026-10-11')).toEqual({ y: 2026, m: 10, d: 11 });
    expect(isDayKey('2028-02-29')).toBe(true); // leap year
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
    expect(isDayKey('2026-1-1')).toBe(false);
    expect(isDayKey('26-10-11')).toBe(false);
    expect(isDayKey('2026-10-11T00:00')).toBe(false);
    expect(isDayKey('')).toBe(false);
  });

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDaysToKey('2026-10-11', 0)).toBe('2026-10-11');
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToKey('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDaysToKey('2026-10-11', -29)).toBe('2026-09-12');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('measures and enumerates inclusive day ranges', () => {
    expect(diffInDays('2026-10-01', '2026-10-01')).toBe(0);
    expect(diffInDays('2026-10-01', '2026-10-31')).toBe(30);
    expect(diffInDays('2026-10-31', '2026-10-01')).toBe(-30);
    expect(enumerateDayKeys('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(enumerateDayKeys('2026-10-11', '2026-10-11')).toEqual(['2026-10-11']);
    expect(enumerateDayKeys('2026-10-12', '2026-10-11')).toEqual([]);
    expect(enumerateDayKeys('2026-01-01', '2026-12-31')).toHaveLength(365);
  });
});

describe('Tehran day boundaries (UTC+03:30, no DST)', () => {
  it('starts a Tehran day at 20:30 UTC of the previous calendar day', () => {
    expect(dayKeyToInstant('2026-10-11').toISOString()).toBe('2026-10-10T20:30:00.000Z');
    expect(dayKeyToInstant('2026-03-21').toISOString()).toBe('2026-03-20T20:30:00.000Z');
  });

  it('puts an event at 20:35 UTC on the NEXT Tehran day', () => {
    expect(instantToDayKey(new Date('2026-10-10T20:35:00.000Z'))).toBe('2026-10-11');
  });

  it('flips exactly at 20:30:00.000 UTC', () => {
    expect(instantToDayKey(new Date('2026-10-10T20:29:59.999Z'))).toBe('2026-10-10');
    expect(instantToDayKey(new Date('2026-10-10T20:30:00.000Z'))).toBe('2026-10-11');
    expect(instantToDayKey(new Date('2026-10-11T20:29:59.999Z'))).toBe('2026-10-11');
  });

  it('keeps early-morning UTC events on the same Tehran day', () => {
    expect(instantToDayKey(new Date('2026-10-11T00:00:00.000Z'))).toBe('2026-10-11');
    expect(instantToDayKey(new Date('2026-10-11T12:00:00.000Z'))).toBe('2026-10-11');
  });

  it('round-trips: every instant lies inside the day it maps to', () => {
    for (let ms = Date.parse('2026-01-01T00:00:00Z'); ms < Date.parse('2026-12-31T00:00:00Z'); ms += 7 * 3_600_000 + 13 * 60_000) {
      const instant = new Date(ms);
      const key = instantToDayKey(instant);
      expect(dayKeyToInstant(key).getTime()).toBeLessThanOrEqual(ms);
      expect(dayKeyToInstant(addDaysToKey(key, 1)).getTime()).toBeGreaterThan(ms);
    }
  });

  it('computes "today" from the Tehran wall clock, not the UTC date', () => {
    expect(todayKey(new Date('2026-10-10T20:31:00.000Z'))).toBe('2026-10-11'); // 00:01 in Tehran
    expect(todayKey(new Date('2026-10-10T20:29:00.000Z'))).toBe('2026-10-10');
  });
});

describe('Jalali helpers', () => {
  it('maps day keys to Jalali dates and back', () => {
    expect(dayKeyToJalali('2026-10-11')).toEqual({ jy: 1405, jm: 7, jd: 19 });
    expect(dayKeyToJalali('2026-03-21')).toEqual({ jy: 1405, jm: 1, jd: 1 }); // Nowruz 1405
    expect(dayKeyToJalali('2026-03-20')).toEqual({ jy: 1404, jm: 12, jd: 29 });
    expect(jalaliToDayKey(1405, 7, 1)).toBe('2026-09-23');
    expect(jalaliToDayKey(1405, 1, 1)).toBe('2026-03-21');
  });

  it('knows month boundaries, including 31/30/29-day months and leap Esfand', () => {
    expect(jalaliMonthDayKeys({ jy: 1405, jm: 6 })).toEqual({ fromKey: '2026-08-23', toKey: '2026-09-22' }); // Shahrivar: 31 days
    expect(jalaliMonthDayKeys({ jy: 1405, jm: 7 })).toEqual({ fromKey: '2026-09-23', toKey: '2026-10-22' }); // Mehr: 30 days
    expect(jalaliMonthDayKeys({ jy: 1404, jm: 12 })).toEqual({ fromKey: '2026-02-20', toKey: '2026-03-20' }); // Esfand 1404: 29 days
    expect(jalaliMonthDayKeys({ jy: 1403, jm: 12 })).toEqual({ fromKey: '2025-02-19', toKey: '2025-03-20' }); // Esfand 1403 (leap): 30 days
  });

  it('shifts months across year boundaries', () => {
    expect(shiftJalaliMonth({ jy: 1405, jm: 1 }, -1)).toEqual({ jy: 1404, jm: 12 });
    expect(shiftJalaliMonth({ jy: 1405, jm: 12 }, 1)).toEqual({ jy: 1406, jm: 1 });
    expect(shiftJalaliMonth({ jy: 1405, jm: 7 }, 14)).toEqual({ jy: 1406, jm: 9 });
    expect(shiftJalaliMonth({ jy: 1405, jm: 7 }, -7)).toEqual({ jy: 1404, jm: 12 });
    expect(shiftJalaliMonth({ jy: 1405, jm: 7 }, 0)).toEqual({ jy: 1405, jm: 7 });
  });

  it('derives the month of a day key and its stable bucket key', () => {
    expect(jalaliMonthOfKey('2026-10-11')).toEqual({ jy: 1405, jm: 7 });
    expect(jalaliMonthKey({ jy: 1405, jm: 7 })).toBe('1405-07');
    expect(jalaliMonthKey({ jy: 1404, jm: 12 })).toBe('1404-12');
  });
});
