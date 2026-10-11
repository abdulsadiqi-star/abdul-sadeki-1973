'use client';

import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatter } from '@/components/providers/format-provider';
import type { Granularity } from '@/lib/analytics/ranges';
import type { SeriesPoint } from '@/lib/analytics/series';
import { metricLabels } from '@/features/analytics/labels';
import { cn } from '@/lib/utils';
import { buildChartRows, describePeriod, type ChartRow } from './chart-model';

type MetricKey = 'views' | 'watchMinutes' | 'newFollowers' | 'likes';
type Axis = 'views' | 'minutes' | 'engagement';

/**
 * One entry per plotted series. Each series differs in colour AND line style (never colour-only). Their magnitudes
 * differ by orders of magnitude (e.g. 240 views, 1 000 watch minutes and 7 new followers a day), so there are three
 * value scales: views and watch minutes each get a right-hand axis, the small engagement counts (likes, new
 * followers) share the left-hand one. Tick labels carry the colour of their series.
 * The saffron token is mixed with the foreground colour so the line keeps 3:1 contrast on cards in both themes.
 */
const METRICS: readonly { key: MetricKey; label: string; color: string; dash?: string; axis: Axis; needsChannel?: boolean }[] = [
  { key: 'views', label: metricLabels.views, color: 'var(--chart-1)', axis: 'views' },
  { key: 'watchMinutes', label: metricLabels.watchMinutes, color: 'var(--chart-2)', dash: '8 4', axis: 'minutes' },
  { key: 'newFollowers', label: metricLabels.newFollowers, color: 'color-mix(in oklab, var(--chart-3) 68%, var(--foreground))', dash: '2 4', axis: 'engagement', needsChannel: true },
  { key: 'likes', label: metricLabels.likes, color: 'var(--chart-4)', dash: '10 3 2 3', axis: 'engagement' },
];

const AXES: readonly { id: Axis; orientation: 'left' | 'right'; title: string }[] = [
  { id: 'views', orientation: 'right', title: metricLabels.views },
  { id: 'minutes', orientation: 'right', title: 'دقیقه' },
  { id: 'engagement', orientation: 'left', title: 'پسند / دنبال‌کننده' },
];

/** `false` during server rendering and hydration, `true` afterwards — without an effect + state round trip. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

/** Wide screens draw every axis; phones draw only the first one (exact values are in the tooltip and the table). */
function useIsWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia('(min-width: 640px)');
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia('(min-width: 640px)').matches,
    () => true,
  );
}

function ChartTooltip({ active, payload, visible, f }: TooltipContentProps & { visible: Record<MetricKey, boolean>; f: ReturnType<typeof useFormatter> }) {
  const row = payload?.[0]?.payload as ChartRow | undefined;
  if (!active || !row) return null;
  return (
    <div className="min-w-40 rounded-xl border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg sm:min-w-44 sm:px-3.5 sm:py-3" dir="rtl">
      <p className="text-sm font-bold">{row.title}</p>
      {row.subtitle && <p className="text-xs text-muted-foreground">{row.subtitle}</p>}
      <ul className="mt-2 space-y-1">
        {METRICS.filter((m) => visible[m.key]).map((m) => (
          <li key={m.key} className="flex items-center justify-between gap-6 text-[13px]">
            <span className="flex items-center gap-2">
              <svg width="18" height="8" aria-hidden="true">
                <line x1="1" x2="17" y1="4" y2="4" stroke={m.color} strokeWidth="2.5" strokeDasharray={m.dash} />
              </svg>
              {m.label}
            </span>
            <span className="font-semibold tabular-nums">{f.number(row[m.key], { maximumFractionDigits: 1 })}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center justify-between gap-6 border-t pt-2 text-xs text-muted-foreground">
        <span>{metricLabels.uniqueViewers}</span>
        <span className="tabular-nums">{f.number(row.uniqueViewers)}</span>
      </p>
      {row.seedViews > 0 && <p className="mt-1 text-xs text-muted-foreground">شامل {f.number(row.seedViews)} بازدید نمونه</p>}
    </div>
  );
}

/**
 * Multi-series line chart of a range: views, watch minutes, new followers, likes.
 *  - the time axis is LTR (oldest → newest, left → right) with Persian tick labels, as for every chart here;
 *  - legend items are real toggle buttons (`aria-pressed`) — keyboard operable;
 *  - the exact same numbers are always available as a table (visually hidden until "show table" is pressed),
 *    which is the text alternative for screen readers.
 */
export function AnalyticsChart({
  series,
  granularity,
  showFollowers,
}: {
  series: SeriesPoint[];
  granularity: Granularity;
  /** Follower growth is a channel-level fact: it is not available when the page is scoped to one video. */
  showFollowers: boolean;
}) {
  const f = useFormatter();
  const tableId = useId();
  const metrics = METRICS.filter((m) => showFollowers || !m.needsChannel);
  const [visible, setVisible] = useState<Record<MetricKey, boolean>>({ views: true, watchMinutes: true, newFollowers: true, likes: true });
  const [showTable, setShowTable] = useState(false);

  const rows = useMemo(() => buildChartRows(series, granularity, f), [series, granularity, f]);
  const labelByKey = useMemo(() => new Map(rows.map((r) => [r.key, r.label])), [rows]);
  const totals = useMemo(
    () => ({
      views: rows.reduce((s, r) => s + r.views, 0),
      watchMinutes: Math.round(rows.reduce((s, r) => s + r.watchSeconds, 0) / 60),
      newFollowers: rows.reduce((s, r) => s + r.newFollowers, 0),
      likes: rows.reduce((s, r) => s + r.likes, 0),
    }),
    [rows],
  );

  const isWide = useIsWide();
  const hydrated = useIsClient();
  const shown = metrics.filter((m) => visible[m.key]);
  const usedAxes = AXES.filter((axis) => shown.some((m) => m.axis === axis.id));
  const drawnAxes = new Set(usedAxes.slice(0, isWide ? usedAxes.length : 1).map((axis) => axis.id));
  const axisColor = (axis: Axis): string => {
    const series = shown.filter((m) => m.axis === axis);
    return series.length === 1 ? series[0]!.color : 'var(--muted-foreground)';
  };
  const isEmpty = rows.every((r) => r.views === 0 && r.watchSeconds === 0 && r.likes === 0 && r.newFollowers === 0);
  const period = rows.length > 0 ? describePeriod(rows[0]!.fromKey, rows[rows.length - 1]!.toKey, f) : '';
  const showDots = rows.length <= 40;
  const axisNumber = (value: number) => (Math.abs(value) >= 10_000 ? f.compact(value) : f.number(value));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">روند عملکرد</CardTitle>
        <CardDescription>
          {period} — {granularity === 'day' ? 'به تفکیک روز (به وقت تهران)' : 'به تفکیک ماه شمسی'}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="xs" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
            <Table2 /> {showTable ? 'پنهان‌کردن جدول داده‌ها' : 'نمایش جدول داده‌ها'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-wrap gap-2" aria-label="سری‌های نمودار (برای نمایش یا پنهان‌کردن بزنید)">
          {metrics.map((m) => {
            const on = visible[m.key];
            return (
              <li key={m.key}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setVisible((v) => ({ ...v, [m.key]: !v[m.key] }))}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    on ? 'bg-card font-medium hover:bg-accent' : 'border-dashed text-muted-foreground hover:bg-muted',
                  )}
                >
                  <svg width="26" height="10" aria-hidden="true" className={cn(!on && 'opacity-40')}>
                    <line x1="2" x2="24" y1="5" y2="5" stroke={m.color} strokeWidth="2.5" strokeDasharray={m.dash} strokeLinecap="round" />
                  </svg>
                  {m.label}
                  <span className="tabular-nums text-muted-foreground">{f.compact(totals[m.key])}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div
          dir="ltr"
          role="group"
          aria-label={`نمودار ${shown.map((m) => m.label).join('، ') || 'خالی'} — ${period}. همین اعداد در جدول داده‌ها آمده است.`}
          className="relative h-72 w-full sm:h-80"
          data-testid="analytics-chart"
        >
          {shown.length === 0 ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground" dir="rtl">
              حداقل یک سری را از بالای نمودار فعال کنید.
            </p>
          ) : !hydrated ? (
            <Skeleton className="size-full rounded-lg" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 4, bottom: 4, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
                  <XAxis
                    dataKey="key"
                    tickFormatter={(key: string) => labelByKey.get(key) ?? key}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickMargin={8}
                    minTickGap={18}
                    interval="preserveStartEnd"
                  />
                  {AXES.map((axis) => (
                    <YAxis
                      key={axis.id}
                      yAxisId={axis.id}
                      orientation={axis.orientation}
                      // An axis that is not drawn keeps its scale but takes no room (width 0, no ticks).
                      width={drawnAxes.has(axis.id) ? (isWide ? 50 : 42) : 0}
                      allowDecimals={false}
                      tickFormatter={axisNumber}
                      tick={drawnAxes.has(axis.id) ? { fill: axisColor(axis.id), fontSize: 12 } : false}
                      tickLine={false}
                      axisLine={false}
                    />
                  ))}
                  <Tooltip
                    cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.4, strokeWidth: 1 }}
                    content={(props) => <ChartTooltip {...props} visible={visible} f={f} />}
                  />
                  {shown.map((m) => (
                    <Line
                      key={m.key}
                      yAxisId={m.axis}
                      type="monotone"
                      dataKey={m.key}
                      name={m.label}
                      stroke={m.color}
                      strokeWidth={2.25}
                      strokeDasharray={m.dash}
                      dot={showDots ? { r: 2.5, strokeWidth: 0, fill: m.color } : false}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--card)' }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              {isEmpty && (
                <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground" dir="rtl">
                  در این بازه رویدادی ثبت نشده است.
                </p>
              )}
            </>
          )}
        </div>

        {/* Text alternative: always in the DOM, visually hidden until requested. */}
        <div id={tableId} className={cn(showTable ? 'max-h-96 overflow-auto rounded-lg border' : 'sr-only')}>
          <Table>
            <caption className="sr-only">
              جدول داده‌های نمودار — {period}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{granularity === 'day' ? 'روز' : 'ماه'}</TableHead>
                <TableHead scope="col">{metricLabels.views}</TableHead>
                <TableHead scope="col">{metricLabels.uniqueViewers}</TableHead>
                <TableHead scope="col">{metricLabels.watchMinutes}</TableHead>
                <TableHead scope="col">{metricLabels.likes}</TableHead>
                <TableHead scope="col">{metricLabels.comments}</TableHead>
                {showFollowers && <TableHead scope="col">{metricLabels.newFollowers}</TableHead>}
                {showFollowers && <TableHead scope="col">{metricLabels.unfollows}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableHead scope="row" className="font-medium text-foreground">
                    {row.title}
                    {row.subtitle ? ` (${row.subtitle})` : ''}
                  </TableHead>
                  <TableCell className="tabular-nums">{f.number(row.views)}</TableCell>
                  <TableCell className="tabular-nums">{f.number(row.uniqueViewers)}</TableCell>
                  <TableCell className="tabular-nums">{f.number(row.watchMinutes, { maximumFractionDigits: 1 })}</TableCell>
                  <TableCell className="tabular-nums">{f.number(row.likes)}</TableCell>
                  <TableCell className="tabular-nums">{f.number(row.comments)}</TableCell>
                  {showFollowers && <TableCell className="tabular-nums">{f.number(row.newFollowers)}</TableCell>}
                  {showFollowers && <TableCell className="tabular-nums">{f.number(row.unfollows)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
