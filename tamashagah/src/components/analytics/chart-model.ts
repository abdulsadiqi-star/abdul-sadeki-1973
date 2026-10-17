/**
 * Presentation model of the analytics chart (pure, formatter-driven): turns server series into rows with Jalali
 * labels in the user's numeral style. Kept apart from the Recharts component so it is unit-testable.
 */
import type { Formatter } from '@/lib/format';
import { JALALI_WEEKDAYS, jalaliWeekday } from '@/lib/jalali';
import type { Granularity } from '@/lib/analytics/ranges';
import type { SeriesPoint } from '@/lib/analytics/series';
import { dayKeyToJalali, dayKeyToNoon, jalaliMonthDayKeys, jalaliMonthName } from '@/lib/analytics/time';

export type ChartRow = SeriesPoint & {
  /** Rounded to one decimal for plotting. */
  watchMinutes: number;
  /** Short axis label ("۱۹ مهر" / "مهر"). */
  label: string;
  /** Tooltip / table row title ("شنبه ۱۹ مهر ۱۴۰۵" / "مهر ۱۴۰۵"). */
  title: string;
  /** Second tooltip line for partial months ("از ۱۴ تا ۲۲ تیر"). */
  subtitle?: string;
};

export function buildChartRows(series: readonly SeriesPoint[], granularity: Granularity, f: Formatter): ChartRow[] {
  const years = new Set(series.map((p) => dayKeyToJalali(p.fromKey).jy));
  const multiYear = years.size > 1;
  const year = (jy: number) => f.number(jy, { useGrouping: false });

  return series.map((point) => {
    const watchMinutes = Math.round((point.watchSeconds / 60) * 10) / 10;
    if (granularity === 'day') {
      const noon = dayKeyToNoon(point.key);
      return {
        ...point,
        watchMinutes,
        label: f.date(noon, 'monthDay'),
        title: `${JALALI_WEEKDAYS[jalaliWeekday(noon)]} ${f.date(noon, 'long')}`,
      };
    }
    const { jy, jm } = dayKeyToJalali(point.fromKey);
    const full = jalaliMonthDayKeys({ jy, jm });
    const partial = point.fromKey !== full.fromKey || point.toKey !== full.toKey;
    return {
      ...point,
      watchMinutes,
      label: multiYear ? `${jalaliMonthName(jm)} ${year(jy)}` : jalaliMonthName(jm),
      title: `${jalaliMonthName(jm)} ${year(jy)}`,
      subtitle: partial ? `از ${f.date(dayKeyToNoon(point.fromKey), 'monthDay')} تا ${f.date(dayKeyToNoon(point.toKey), 'monthDay')}` : undefined,
    };
  });
}

/** "۵ مهر تا ۱۱ مهر ۱۴۰۵" — the human description of a range, used in headings and aria-labels. */
export function describePeriod(fromKey: string, toKey: string, f: Formatter): string {
  const from = dayKeyToNoon(fromKey);
  const to = dayKeyToNoon(toKey);
  if (fromKey === toKey) return f.date(to, 'long');
  const sameYear = dayKeyToJalali(fromKey).jy === dayKeyToJalali(toKey).jy;
  return `${f.date(from, sameYear ? 'monthDay' : 'long')} تا ${f.date(to, 'long')}`;
}

/**
 * Right-to-left mark. Chart axes are LTR on purpose (time runs left → right), but an SVG `<text>` inherits that
 * direction, and the bidi algorithm then draws a Persian label such as «۲۱ شهریور» with the digits on the LEFT of
 * the word (read right to left: «شهریور ۲۱»). Wrapping the label in RLM at both ends gives the run an RTL context
 * (digits to the right of the word, as a Persian reader expects) WITHOUT changing the text element's direction,
 * so `text-anchor` and the axis layout stay exactly as Recharts computed them.
 */
export const RLM = '\u200F';

export const rtlLabel = (text: string): string => `${RLM}${text}${RLM}`;

/** Y-axis tick: plain digits below 10 000 ("۱٬۸۰۰"), compact above ("۱۲ هزار"); always RTL-marked. */
export function formatAxisNumber(value: number, f: Formatter): string {
  return rtlLabel(Math.abs(value) >= 10_000 ? f.compact(value) : f.number(value));
}
