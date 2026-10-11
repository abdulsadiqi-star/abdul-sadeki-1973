import { describe, expect, it } from 'vitest';
import { MAX_RANGE_DAYS, buildBuckets, resolveRange, trailingJalaliMonthBuckets } from '@/lib/analytics/ranges';

// 2026-10-11 12:30 in Tehran = 19 Mehr 1405.
const NOW = new Date('2026-10-11T09:00:00.000Z');

const shape = (r: ReturnType<typeof resolveRange>) => ({ from: r.fromKey, to: r.toKey, days: r.days });
const prevShape = (r: ReturnType<typeof resolveRange>) => ({ from: r.previous.fromKey, to: r.previous.toKey, days: r.previous.days });

describe('range presets', () => {
  it('last 7 days = today and the 6 days before it', () => {
    const r = resolveRange({ preset: 'last7' }, NOW);
    expect(shape(r)).toEqual({ from: '2026-10-05', to: '2026-10-11', days: 7 });
    expect(prevShape(r)).toEqual({ from: '2026-09-28', to: '2026-10-04', days: 7 });
    expect(r.from.toISOString()).toBe('2026-10-04T20:30:00.000Z'); // 2026-10-05 00:00 Tehran
    expect(r.to.toISOString()).toBe('2026-10-11T20:30:00.000Z'); // exclusive: 2026-10-12 00:00 Tehran
    expect(r.previous.to.toISOString()).toBe(r.from.toISOString()); // periods touch, never overlap
  });

  it('last 30 and last 90 days', () => {
    expect(shape(resolveRange({ preset: 'last30' }, NOW))).toEqual({ from: '2026-09-12', to: '2026-10-11', days: 30 });
    expect(shape(resolveRange({ preset: 'last90' }, NOW))).toEqual({ from: '2026-07-14', to: '2026-10-11', days: 90 });
    expect(prevShape(resolveRange({ preset: 'last30' }, NOW))).toEqual({ from: '2026-08-13', to: '2026-09-11', days: 30 });
  });

  it('defaults to the last 30 days, daily', () => {
    const r = resolveRange({}, NOW);
    expect(r.preset).toBe('last30');
    expect(r.granularity).toBe('day');
    expect(r.buckets).toHaveLength(30);
  });

  it('current Jalali month runs from the 1st of the month to today', () => {
    const r = resolveRange({ preset: 'thisMonth' }, NOW);
    expect(shape(r)).toEqual({ from: '2026-09-23', to: '2026-10-11', days: 19 }); // 1 … 19 Mehr 1405
    expect(prevShape(r)).toEqual({ from: '2026-09-04', to: '2026-09-22', days: 19 });
  });

  it('previous Jalali month is the whole month (31 days in Shahrivar)', () => {
    const r = resolveRange({ preset: 'lastMonth' }, NOW);
    expect(shape(r)).toEqual({ from: '2026-08-23', to: '2026-09-22', days: 31 });
    expect(prevShape(r)).toEqual({ from: '2026-07-23', to: '2026-08-22', days: 31 });
  });

  it('handles the first day of a Jalali month', () => {
    const firstOfMehr = new Date('2026-09-23T10:00:00.000Z');
    expect(shape(resolveRange({ preset: 'thisMonth' }, firstOfMehr))).toEqual({ from: '2026-09-23', to: '2026-09-23', days: 1 });
    expect(shape(resolveRange({ preset: 'lastMonth' }, firstOfMehr))).toEqual({ from: '2026-08-23', to: '2026-09-22', days: 31 });
  });

  it('rolls "last month" back across the Jalali year (Esfand 1404 has 29 days)', () => {
    const early = new Date('2026-03-25T08:00:00.000Z'); // 5 Farvardin 1405
    expect(shape(resolveRange({ preset: 'lastMonth' }, early))).toEqual({ from: '2026-02-20', to: '2026-03-20', days: 29 });
    expect(shape(resolveRange({ preset: 'thisMonth' }, early))).toEqual({ from: '2026-03-21', to: '2026-03-25', days: 5 });
  });

  it('uses the Tehran clock for "today": 20:31 UTC is already tomorrow in Tehran', () => {
    const justAfterMidnight = new Date('2026-10-10T20:31:00.000Z');
    expect(resolveRange({ preset: 'last7' }, justAfterMidnight).toKey).toBe('2026-10-11');
    const justBefore = new Date('2026-10-10T20:29:00.000Z');
    expect(resolveRange({ preset: 'last7' }, justBefore).toKey).toBe('2026-10-10');
  });
});

describe('custom ranges', () => {
  it('accepts two Tehran days, inclusive', () => {
    const r = resolveRange({ preset: 'custom', from: '2026-10-01', to: '2026-10-10' }, NOW);
    expect(shape(r)).toEqual({ from: '2026-10-01', to: '2026-10-10', days: 10 });
    expect(prevShape(r)).toEqual({ from: '2026-09-21', to: '2026-09-30', days: 10 });
  });

  it('clamps an end date in the future to today', () => {
    const r = resolveRange({ preset: 'custom', from: '2026-10-01', to: '2026-12-31' }, NOW);
    expect(r.toKey).toBe('2026-10-11');
    expect(r.days).toBe(11);
  });

  it.each([
    ['missing dates', { preset: 'custom' as const }],
    ['missing end', { preset: 'custom' as const, from: '2026-10-01' }],
    ['malformed start', { preset: 'custom' as const, from: '2026/10/01', to: '2026-10-05' }],
    ['impossible date', { preset: 'custom' as const, from: '2026-02-30', to: '2026-10-05' }],
    ['start after end', { preset: 'custom' as const, from: '2026-10-10', to: '2026-10-01' }],
    ['start in the future', { preset: 'custom' as const, from: '2026-10-12', to: '2026-10-20' }],
    ['more than two years', { preset: 'custom' as const, from: '2024-01-01', to: '2026-10-11' }],
  ])('rejects %s', (_label, input) => {
    expect(() => resolveRange(input, NOW)).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('allows exactly the maximum span', () => {
    const r = resolveRange({ preset: 'custom', from: '2024-10-11', to: '2026-10-11' }, NOW);
    expect(r.days).toBe(MAX_RANGE_DAYS);
  });

  it('ignores from/to for named presets', () => {
    const r = resolveRange({ preset: 'last7', from: '2020-01-01', to: '2020-02-01' }, NOW);
    expect(r.fromKey).toBe('2026-10-05');
  });
});

describe('buckets', () => {
  it('produces one gap-free bucket per Tehran day with exact UTC bounds', () => {
    const buckets = buildBuckets('2026-10-09', '2026-10-11', 'day');
    expect(buckets.map((b) => b.key)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    expect(buckets[0]!.from.toISOString()).toBe('2026-10-08T20:30:00.000Z');
    expect(buckets[2]!.to.toISOString()).toBe('2026-10-11T20:30:00.000Z');
    for (let i = 1; i < buckets.length; i++) expect(buckets[i]!.from.getTime()).toBe(buckets[i - 1]!.to.getTime());
  });

  it('monthly buckets are Jalali months clipped to the range', () => {
    const r = resolveRange({ preset: 'last90', granularity: 'month' }, NOW); // 2026-07-14 … 2026-10-11
    expect(r.buckets.map((b) => [b.key, b.fromKey, b.toKey])).toEqual([
      ['1405-04', '2026-07-14', '2026-07-22'], // Tir (clipped at the start)
      ['1405-05', '2026-07-23', '2026-08-22'], // Mordad
      ['1405-06', '2026-08-23', '2026-09-22'], // Shahrivar
      ['1405-07', '2026-09-23', '2026-10-11'], // Mehr (clipped at today)
    ]);
    // every day of the range is in exactly one bucket
    let covered = 0;
    for (const b of r.buckets) covered += Math.round((b.to.getTime() - b.from.getTime()) / 86_400_000);
    expect(covered).toBe(r.days);
  });

  it('a range inside one Jalali month yields a single monthly bucket', () => {
    const r = resolveRange({ preset: 'last7', granularity: 'month' }, NOW);
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0]).toMatchObject({ key: '1405-07', fromKey: '2026-10-05', toKey: '2026-10-11' });
  });

  it('builds the trailing 12 Jalali months ending with the current partial one', () => {
    const buckets = trailingJalaliMonthBuckets(12, NOW);
    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toMatchObject({ key: '1404-08', fromKey: '2025-10-23' }); // Aban 1404
    expect(buckets[4]).toMatchObject({ key: '1404-12', fromKey: '2026-02-20', toKey: '2026-03-20' });
    expect(buckets[11]).toMatchObject({ key: '1405-07', fromKey: '2026-09-23', toKey: '2026-10-11' });
  });
});
