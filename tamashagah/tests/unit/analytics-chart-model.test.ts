import { describe, expect, it } from 'vitest';
import { createFormatter } from '@/lib/format';
import { buildBuckets } from '@/lib/analytics/ranges';
import { bucketize, emptyDaily } from '@/lib/analytics/series';
import { RLM, buildChartRows, describePeriod, formatAxisNumber, rtlLabel } from '@/components/analytics/chart-model';

const fa = createFormatter('fa');
const en = createFormatter('en');

describe('RTL marks for SVG axis text', () => {
  it('wraps a label in a right-to-left mark at BOTH ends and keeps the text untouched', () => {
    const label = rtlLabel('۲۱ شهریور');
    expect(RLM).toBe('‏');
    expect(label.startsWith(RLM)).toBe(true);
    expect(label.endsWith(RLM)).toBe(true);
    expect(label.slice(1, -1)).toBe('۲۱ شهریور');
  });

  it('formats y-axis ticks: plain below 10 000, compact above, numerals follow the user setting, always marked', () => {
    expect(formatAxisNumber(0, fa)).toBe(`${RLM}۰${RLM}`);
    expect(formatAxisNumber(1_800, fa)).toBe(`${RLM}۱٬۸۰۰${RLM}`);
    expect(formatAxisNumber(9_999, fa)).toBe(`${RLM}۹٬۹۹۹${RLM}`);
    const compact = formatAxisNumber(12_000, fa);
    expect(compact).toContain('هزار');
    expect(compact.startsWith(RLM) && compact.endsWith(RLM)).toBe(true);
    expect(formatAxisNumber(5, en)).toBe(`${RLM}5${RLM}`);
    expect(formatAxisNumber(1_800, en)).toBe(`${RLM}1,800${RLM}`);
  });
});

describe('chart rows (labels and titles in Jalali)', () => {
  const point = (key: string) => bucketize(buildBuckets(key, key, 'day'), new Map([[key, { ...emptyDaily(), views: 3, watchSeconds: 90 }]]))[0]!;

  it('labels a day with its Jalali date and a weekday title', () => {
    const [row] = buildChartRows([point('2026-10-11')], 'day', fa);
    expect(row).toMatchObject({ label: '۱۹ مهر', title: 'یکشنبه ۱۹ مهر ۱۴۰۵', watchMinutes: 1.5, views: 3 });
    expect(buildChartRows([point('2026-10-11')], 'day', en)[0]).toMatchObject({ label: '19 مهر', title: 'یکشنبه 19 مهر 1405' });
  });

  it('labels months by name, adds the year only across Jalali years, and describes partial months', () => {
    const buckets = buildBuckets('2026-03-10', '2026-05-01', 'month'); // Esfand 1404 (partial) … Ordibehesht 1405 (partial)
    const series = bucketize(buckets, new Map(), new Map());
    const rows = buildChartRows(series, 'month', fa);
    expect(rows.map((r) => r.label)).toEqual(['اسفند ۱۴۰۴', 'فروردین ۱۴۰۵', 'اردیبهشت ۱۴۰۵']);
    expect(rows[0]!.subtitle).toBe('از ۱۹ اسفند تا ۲۹ اسفند');
    expect(rows[1]!.subtitle).toBeUndefined(); // the whole of Farvardin
    expect(rows[2]!.subtitle).toBe('از ۱ اردیبهشت تا ۱۱ اردیبهشت');

    const sameYear = buildChartRows(bucketize(buildBuckets('2026-04-25', '2026-06-01', 'month'), new Map(), new Map()), 'month', fa);
    expect(sameYear.map((r) => r.label)).toEqual(['اردیبهشت', 'خرداد']);
  });

  it('describes a range for headings and aria-labels', () => {
    expect(describePeriod('2026-10-05', '2026-10-11', fa)).toBe('۱۳ مهر تا ۱۹ مهر ۱۴۰۵');
    expect(describePeriod('2026-10-11', '2026-10-11', fa)).toBe('۱۹ مهر ۱۴۰۵');
    expect(describePeriod('2026-03-10', '2026-04-10', fa)).toBe('۱۹ اسفند ۱۴۰۴ تا ۲۱ فروردین ۱۴۰۵'); // crosses a Jalali year
  });
});
