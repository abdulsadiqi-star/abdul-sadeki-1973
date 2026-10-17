import Link from 'next/link';
import type { Route } from 'next';
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Upload, Video as VideoIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { VideoThumb } from '@/components/studio/video-thumb';
import { getFormatter } from '@/lib/format-server';
import { analyticsHref, type AnalyticsQuery } from '@/features/analytics/schemas';
import { metricLabels } from '@/features/analytics/labels';
import type { VideoPerformancePage, VideoSortKey } from '@/features/analytics/types';
import { cn } from '@/lib/utils';

export const ANALYTICS_PATH = '/studio/analytics';

const COLUMNS: { key: VideoSortKey; label: string; className?: string }[] = [
  { key: 'views', label: metricLabels.views },
  { key: 'watch', label: metricLabels.watchMinutes },
  { key: 'avg', label: metricLabels.avgViewDuration, className: 'hidden md:table-cell' },
  { key: 'likes', label: metricLabels.likes },
  { key: 'comments', label: metricLabels.comments, className: 'hidden sm:table-cell' },
];

/**
 * Sortable, paginated per-video performance table. Sorting and paging are plain links (no client state, works
 * without JS, deep-linkable); `aria-sort` tells assistive technology which column drives the order.
 */
export async function VideoPerformanceTable({ data, query, hasVideos }: { data: VideoPerformancePage; query: AnalyticsQuery; hasVideos: boolean }) {
  const f = await getFormatter();
  const sortHref = (key: VideoSortKey) =>
    analyticsHref(ANALYTICS_PATH, { ...query, sort: key, dir: query.sort === key && query.dir === 'desc' ? 'asc' : 'desc', page: 1 });

  return (
    <Card id="video-table" className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">عملکرد ویدیوها</CardTitle>
        <CardDescription>اعداد فقط برای بازه‌ی انتخاب‌شده‌اند. روی عنوان یک ویدیو بزنید تا آمار همان ویدیو نمایش داده شود.</CardDescription>
      </CardHeader>
      {!hasVideos ? (
        <div className="px-5 pb-5">
          <EmptyState
            icon={VideoIcon}
            title="هنوز ویدیویی ندارید"
            description="پس از بارگذاری و انتشار ویدیو، آمار هر ویدیو اینجا نمایش داده می‌شود."
            action={
              <Button asChild>
                <Link href="/studio/upload">
                  <Upload /> بارگذاری ویدیو
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <Table>
            <caption className="sr-only">عملکرد هر ویدیو در بازه‌ی انتخاب‌شده</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="ps-5">
                  ویدیو
                </TableHead>
                {COLUMNS.map((col) => {
                  const active = query.sort === col.key;
                  return (
                    <TableHead key={col.key} scope="col" className={col.className} aria-sort={active ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <Link
                        href={sortHref(col.key) as Route}
                        className="inline-flex items-center gap-1 rounded-md py-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {col.label}
                        {active ? query.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" /> : <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />}
                        <span className="sr-only">{active ? (query.dir === 'asc' ? '، صعودی' : '، نزولی') : '، مرتب‌سازی'}</span>
                      </Link>
                    </TableHead>
                  );
                })}
                <TableHead scope="col" className="pe-5">
                  <span className="sr-only">عملیات</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => {
                const selected = query.video === row.id;
                return (
                  <TableRow key={row.id} data-state={selected ? 'selected' : undefined} data-testid="video-row">
                    <TableCell className="ps-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <VideoThumb posterKey={row.posterKey} className="w-20 sm:w-24" />
                        <div className="min-w-0">
                          <Link
                            href={analyticsHref(ANALYTICS_PATH, { ...query, video: row.id, page: 1 }) as Route}
                            dir="auto"
                            aria-current={selected ? 'true' : undefined}
                            className="line-clamp-2 text-sm font-semibold hover:text-primary focus-visible:text-primary"
                          >
                            {row.title}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {row.kind === 'SHORT' && <Badge variant="secondary">شورتس</Badge>}
                            {row.publishedAt ? <span>{f.date(row.publishedAt, 'short')}</span> : <span>منتشر نشده</span>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn('tabular-nums', query.sort === 'views' && 'font-bold')}>{f.number(row.views)}</TableCell>
                    <TableCell className={cn('tabular-nums', query.sort === 'watch' && 'font-bold')}>{f.number(Math.round(row.watchSeconds / 60))}</TableCell>
                    <TableCell className={cn('hidden tabular-nums md:table-cell', query.sort === 'avg' && 'font-bold')}>{row.views > 0 ? f.duration(row.avgViewSeconds) : '—'}</TableCell>
                    <TableCell className={cn('tabular-nums', query.sort === 'likes' && 'font-bold')}>{f.number(row.likes)}</TableCell>
                    <TableCell className={cn('hidden tabular-nums sm:table-cell', query.sort === 'comments' && 'font-bold')}>{f.number(row.comments)}</TableCell>
                    <TableCell className="pe-5">
                      <Button asChild variant="ghost" size="icon-xs" title="ویرایش ویدیو">
                        <Link href={`/studio/videos/${row.id}/edit`} aria-label={`ویرایش «${row.title}»`}>
                          <Pencil />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-[13px] text-muted-foreground">
            <span>
              {f.number(data.total)} ویدیو · صفحه‌ی {f.number(data.page)} از {f.number(data.pageCount)}
            </span>
            <Pagination page={data.page} pageCount={data.pageCount} href={(page) => `${analyticsHref(ANALYTICS_PATH, { ...query, page })}#video-table`} />
          </div>
        </>
      )}
    </Card>
  );
}
