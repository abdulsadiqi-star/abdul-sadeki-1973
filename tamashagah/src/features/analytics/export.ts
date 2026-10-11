import { CSV_BOM, toCsv, type CsvValue } from '@/lib/analytics/csv';
import { dayKeyToJalali } from '@/lib/analytics/time';
import { formatJalaliNumeric } from '@/lib/jalali';
import type { SeriesPoint } from '@/lib/analytics/series';
import { metricLabels } from './labels';
import type { VideoPerformanceRow } from './types';

/**
 * CSV builders for the analytics export (pure). Numbers are written with ASCII digits and a dot as decimal
 * separator so spreadsheets and scripts can read them; headers are Persian for the creator.
 */

const jalaliOf = (key: string): string => formatJalaliNumeric(dayKeyToJalali(key));
const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

export function seriesToCsv(series: readonly SeriesPoint[], opts: { channelLevel: boolean }): string {
  const header: CsvValue[] = [
    'تاریخ شروع (میلادی)',
    'تاریخ پایان (میلادی)',
    'تاریخ شروع (شمسی)',
    'تاریخ پایان (شمسی)',
    metricLabels.views,
    metricLabels.uniqueViewers,
    metricLabels.watchMinutes,
    'میانگین مدت تماشا (ثانیه)',
    metricLabels.likes,
    metricLabels.comments,
    ...(opts.channelLevel ? [metricLabels.newFollowers, metricLabels.unfollows, metricLabels.netFollowers] : []),
    'بازدید نمونه‌ی آزمایشی',
    ...(opts.channelLevel ? ['رویداد دنبال‌کردن نمونه‌ی آزمایشی'] : []),
  ];
  const rows = series.map((p): CsvValue[] => [
    p.fromKey,
    p.toKey,
    jalaliOf(p.fromKey),
    jalaliOf(p.toKey),
    p.views,
    p.uniqueViewers,
    round(p.watchSeconds / 60, 2),
    p.views > 0 ? round(p.watchSeconds / p.views, 1) : 0,
    p.likes,
    p.comments,
    ...(opts.channelLevel ? [p.newFollowers, p.unfollows, p.netFollowers] : []),
    p.seedViews,
    ...(opts.channelLevel ? [p.seedFollowEvents] : []),
  ]);
  return CSV_BOM + toCsv([header, ...rows]);
}

export function videosToCsv(videos: readonly VideoPerformanceRow[]): string {
  const header: CsvValue[] = [
    'شناسه‌ی ویدیو',
    'عنوان',
    'نوع',
    'تاریخ انتشار (میلادی)',
    metricLabels.views,
    metricLabels.uniqueViewers,
    metricLabels.watchMinutes,
    'میانگین مدت تماشا (ثانیه)',
    metricLabels.likes,
    metricLabels.comments,
  ];
  const rows = videos.map((v): CsvValue[] => [
    v.id,
    v.title,
    v.kind === 'SHORT' ? 'شورتس' : 'ویدیو',
    v.publishedAt ? v.publishedAt.slice(0, 10) : '',
    v.views,
    v.uniqueViewers,
    round(v.watchSeconds / 60, 2),
    v.views > 0 ? round(v.watchSeconds / v.views, 1) : 0,
    v.likes,
    v.comments,
  ]);
  return CSV_BOM + toCsv([header, ...rows]);
}

/** ASCII-only, header-safe file name. */
export function exportFileName(handle: string, fromKey: string, toKey: string, type: 'series' | 'videos'): string {
  const safeHandle = handle.replace(/[^a-z0-9._-]/gi, '') || 'channel';
  return `tamashagah-analytics-${safeHandle}-${fromKey}_${toKey}${type === 'videos' ? '-videos' : ''}.csv`;
}
