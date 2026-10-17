import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { Download, Film, Upload, Video as VideoIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { AnalyticsCards } from '@/components/analytics/analytics-cards';
import { AnalyticsChart } from '@/components/analytics/analytics-chart';
import { AnalyticsFrame } from '@/components/analytics/analytics-toolbar';
import { BreakdownCard } from '@/components/analytics/breakdown-card';
import { describePeriod } from '@/components/analytics/chart-model';
import { FollowerGrowthCard } from '@/components/analytics/follower-growth-card';
import { SeedDataNotice } from '@/components/analytics/seed-data-notice';
import { TopVideosCard } from '@/components/analytics/top-videos-card';
import { ANALYTICS_PATH, VideoPerformanceTable } from '@/components/analytics/video-performance-table';
import { requirePageChannelUser } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { isAppError } from '@/lib/errors';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { resolveRange, type ResolvedRange } from '@/lib/analytics/ranges';
import { getAnalyticsOverview, listVideoPerformance } from '@/features/analytics/queries';
import { sourceLabel } from '@/features/analytics/labels';
import { analyticsHref, parseAnalyticsQueryLenient, PRESET_BY_QUERY } from '@/features/analytics/schemas';

export const metadata = { title: 'آمار بازدید' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageChannelUser('/studio/analytics');
  const { query: requested, invalidVideo } = parseAnalyticsQueryLenient(await searchParams);
  if (invalidVideo) notFound();

  const now = new Date();
  let range: ResolvedRange;
  let rangeError: string | null = null;
  let query = requested;
  try {
    range = resolveRange({ preset: PRESET_BY_QUERY[requested.range], from: requested.from, to: requested.to, granularity: requested.granularity }, now);
  } catch (error) {
    if (!isAppError(error) || error.code !== 'VALIDATION') throw error;
    rangeError = error.message;
    query = { ...requested, range: '30d', from: undefined, to: undefined };
    range = resolveRange({ preset: 'last30', granularity: requested.granularity }, now);
  }

  const channelId = user.channel.id;
  const [overview, table] = await Promise.all([
    getAnalyticsOverview({ channelId, videoId: query.video }, range, now).catch((error: unknown) => {
      if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    }),
    listVideoPerformance(channelId, range, { sort: query.sort, dir: query.dir, page: query.page, pageSize: 10 }),
  ]);
  const f = await getFormatter();

  const header = (
    <PageHeader
      title="آمار بازدید"
      description="بازدید، مدت تماشا و رشد کانال شما؛ روزها به وقت تهران و با تاریخ شمسی هستند."
    />
  );

  // A channel without any video has nothing to analyse yet.
  if (table.total === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Film}
          title="هنوز ویدیویی بارگذاری نکرده‌اید"
          description="پس از انتشار اولین ویدیو، بازدید، مدت تماشا و رشد دنبال‌کنندگان اینجا نمایش داده می‌شود."
          action={
            <Button asChild>
              <Link href="/studio/upload">
                <Upload /> بارگذاری ویدیو
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const showSeedNotice = env.SHOW_SEED_DATA_NOTICE && (overview.data.views.seed > 0 || overview.data.followEvents.seed > 0);
  const exportQuery = { range: query.range, from: query.from, to: query.to, granularity: query.granularity, video: query.video };
  const exportHref = (type: 'series' | 'videos') => analyticsHref('/api/studio/analytics/export', exportQuery, { type });
  const total = overview.totals.views;

  return (
    <>
      <PageHeader
        title="آمار بازدید"
        description="بازدید، مدت تماشا و رشد کانال شما؛ روزها به وقت تهران و با تاریخ شمسی هستند."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={exportHref('series')} download>
                <Download /> خروجی CSV روزانه
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={exportHref('videos')} download>
                <Download /> خروجی CSV ویدیوها
              </a>
            </Button>
          </>
        }
      />
      <AnalyticsFrame
        query={query}
        periodText={describePeriod(range.fromKey, range.toKey, f)}
        compareText={describePeriod(range.previous.fromKey, range.previous.toKey, f)}
        rangeError={rangeError}
      >
        {overview.video && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/30 bg-accent/50 px-4 py-3 text-sm" data-testid="video-filter">
            <VideoIcon aria-hidden="true" className="size-4 text-primary" />
            <span>آمار ویدیو:</span>
            <strong dir="auto" className="min-w-0 truncate">
              {overview.video.title}
            </strong>
            <span className="ms-auto flex items-center gap-1">
              <Button asChild variant="ghost" size="xs">
                <Link href={`/studio/videos/${overview.video.id}/edit`}>ویرایش</Link>
              </Button>
              <Button asChild variant="soft" size="xs">
                <Link href={analyticsHref(ANALYTICS_PATH, { ...query, video: undefined }) as Route}>
                  <X /> نمایش کل کانال
                </Link>
              </Button>
            </span>
          </div>
        )}

        {showSeedNotice && (
          <SeedDataNotice seedViews={overview.data.views.seed} totalViews={total} seedFollowEvents={overview.data.followEvents.seed} />
        )}

        <AnalyticsCards overview={overview} now={now} showSample={env.SHOW_SEED_DATA_NOTICE} />

        <AnalyticsChart series={overview.series} granularity={range.granularity} showFollowers={overview.video === null} />

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            {overview.video === null && <TopVideosCard videos={overview.topVideos} query={query} />}
            <BreakdownCard
              title="دستگاه‌ها"
              description="بازدیدها بر اساس نوع دستگاه بیننده"
              unit="بازدید"
              empty="در این بازه بازدیدی ثبت نشده است."
              items={overview.devices.map((d) => ({ key: d.device, label: labels.device[d.device], value: d.views }))}
            />
          </div>
          <div className="space-y-6">
            {overview.video === null && (
              <FollowerGrowthCard
                totals={overview.totals}
                changes={overview.changes}
                followers={overview.cards.followers ?? 0}
                seedEvents={env.SHOW_SEED_DATA_NOTICE ? overview.data.followEvents.seed : 0}
              />
            )}
            <BreakdownCard
              title="منابع ترافیک"
              description="بینندگان از کجا به ویدیوهای شما رسیده‌اند"
              unit="بازدید"
              empty="در این بازه بازدیدی ثبت نشده است."
              items={overview.sources.map((s) => ({
                key: s.source,
                label: sourceLabel(s.source) ?? <bdi className="ltr-isolate">{s.source}</bdi>,
                value: s.views,
              }))}
            />
          </div>
        </div>

        <VideoPerformanceTable data={table} query={query} hasVideos />
      </AnalyticsFrame>
    </>
  );
}
