import { describe, expect, it } from 'vitest';
import { buildBuckets, resolveRange } from '@/lib/analytics/ranges';
import { average, bucketize, emptyDaily, percentChange, sumDaily, type DailyAggregate } from '@/lib/analytics/series';
import { CSV_BOM, csvCell, toCsv } from '@/lib/analytics/csv';

const day = (patch: Partial<DailyAggregate>): DailyAggregate => ({ ...emptyDaily(), ...patch });

describe('gap filling', () => {
  it('emits a zero point for every quiet day', () => {
    const buckets = buildBuckets('2026-10-09', '2026-10-13', 'day');
    const daily = new Map([
      ['2026-10-09', day({ views: 3, uniqueViewers: 2, watchSeconds: 90 })],
      ['2026-10-12', day({ views: 1, uniqueViewers: 1, watchSeconds: 10, likes: 1 })],
    ]);
    const series = bucketize(buckets, daily);
    expect(series.map((p) => p.key)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
    expect(series.map((p) => p.views)).toEqual([3, 0, 0, 1, 0]);
    expect(series.map((p) => p.uniqueViewers)).toEqual([2, 0, 0, 1, 0]);
    expect(series[1]).toMatchObject({ watchSeconds: 0, likes: 0, comments: 0, newFollowers: 0, unfollows: 0, netFollowers: 0 });
    expect(series[3]).toMatchObject({ likes: 1 });
  });

  it('ignores days outside the buckets and computes net follower growth', () => {
    const buckets = buildBuckets('2026-10-10', '2026-10-11', 'day');
    const daily = new Map([
      ['2026-10-01', day({ views: 99 })],
      ['2026-10-10', day({ newFollowers: 5, unfollows: 2 })],
      ['2026-10-11', day({ newFollowers: 0, unfollows: 3 })],
    ]);
    const series = bucketize(buckets, daily);
    expect(series.map((p) => p.netFollowers)).toEqual([3, -3]);
    expect(series.reduce((sum, p) => sum + p.views, 0)).toBe(0);
  });

  it('sums additive metrics into Jalali months and takes distinct viewers from the supplied map', () => {
    const range = resolveRange({ preset: 'custom', from: '2026-09-20', to: '2026-09-25', granularity: 'month' }, new Date('2026-10-11T09:00:00Z'));
    // Shahrivar 1405 ends 2026-09-22, Mehr starts 2026-09-23
    expect(range.buckets.map((b) => b.key)).toEqual(['1405-06', '1405-07']);
    const daily = new Map([
      ['2026-09-20', day({ views: 4, uniqueViewers: 3, watchSeconds: 40, seedViews: 1 })],
      ['2026-09-22', day({ views: 2, uniqueViewers: 2, watchSeconds: 20 })],
      ['2026-09-23', day({ views: 5, uniqueViewers: 5, watchSeconds: 50, likes: 2 })],
    ]);
    const series = bucketize(range.buckets, daily, new Map([['1405-06', 4], ['1405-07', 5]]));
    expect(series[0]).toMatchObject({ key: '1405-06', views: 6, watchSeconds: 60, seedViews: 1, uniqueViewers: 4 }); // 3 + 2 would be wrong: viewers repeat
    expect(series[1]).toMatchObject({ key: '1405-07', views: 5, likes: 2, uniqueViewers: 5 });
  });

  it('sums a daily map over an inclusive window', () => {
    const daily = new Map([
      ['2026-10-08', day({ views: 1 })],
      ['2026-10-09', day({ views: 2, seedViews: 1 })],
      ['2026-10-10', day({ views: 4 })],
      ['2026-10-11', day({ views: 8 })],
    ]);
    expect(sumDaily(daily, '2026-10-09', '2026-10-10')).toMatchObject({ views: 6, seedViews: 1 });
    expect(sumDaily(daily, '2026-10-12', '2026-10-13').views).toBe(0);
  });
});

describe('percentChange', () => {
  it('rounds to one decimal', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 3)).toBe(3233.3);
    expect(percentChange(101, 100)).toBe(1);
    expect(percentChange(1, 3)).toBe(-66.7);
    expect(percentChange(100, 100)).toBe(0);
  });

  it('uses the absolute previous value so a better negative number reads as an increase', () => {
    expect(percentChange(-2, -5)).toBe(60);
    expect(percentChange(5, -5)).toBe(200);
    expect(percentChange(-5, 5)).toBe(-200);
    expect(percentChange(-1, 0)).toBeNull();
  });

  it('is undefined (null) when there is nothing to compare with, and 0 for 0 → 0', () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(0, 10)).toBe(-100);
    expect(percentChange(Number.NaN, 1)).toBeNull();
    expect(percentChange(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('averages safely', () => {
    expect(average(90, 3)).toBe(30);
    expect(average(90, 0)).toBe(0);
  });
});

describe('CSV', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('سلام')).toBe('سلام');
  });

  it('neutralizes spreadsheet formulas in text but never touches numbers', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('  =1+1')).toBe("'  =1+1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(true)).toBe('true');
  });

  it('writes empty cells for null, undefined and non-finite numbers', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 1], ['b', -2]])).toBe('a,1\r\nb,-2');
    expect(CSV_BOM).toBe('﻿');
  });
});
