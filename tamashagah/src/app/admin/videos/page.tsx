import Link from 'next/link';
import type { Route } from 'next';
import { Eye, Flag, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PosterPlaceholder } from '@/components/video/video-card';
import { VideoStateBadges } from '@/components/admin/badges';
import { FilterBar } from '@/components/admin/filter-bar';
import { ResultList, ResultRow } from '@/components/admin/layout-bits';
import { ResultCount } from '@/components/admin/result-count';
import { VideoActions } from '@/components/admin/video-actions';
import { requireStaffPage } from '@/features/admin/guard';
import { checkTargetUser, roleCan } from '@/features/admin/policy';
import { listAdminVideos } from '@/features/admin/queries/videos';
import { flattenSearchParams, videoListSchema } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'ویدیوها' };
export const dynamic = 'force-dynamic';

export default async function AdminVideosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const raw = await searchParams;
  const filters = videoListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const { items, pageInfo } = await listAdminVideos(filters);

  const values = {
    q: filters.q ?? '',
    processing: filters.processing,
    publish: filters.publish,
    visibility: filters.visibility,
    takedown: filters.takedown,
    channel: filters.channel ?? '',
  };
  const filtered = Object.entries(values).some(([k, v]) => v && v !== 'ALL' && k !== 'sort');
  const all = { value: 'ALL', label: 'همه' };

  return (
    <div>
      <PageHeader title="ویدیوها" description="همه‌ی ویدیوهای سامانه با هر وضعیتی. ویدیوی ناقض قوانین را از دسترس خارج کنید یا (فقط مدیران) برای همیشه حذف کنید." />

      <FilterBar
        key={JSON.stringify(values)}
        label="فیلتر ویدیوها"
        values={values}
        fields={[
          { kind: 'search', name: 'q', label: 'جستجوی عنوان یا شناسه', placeholder: 'عنوان ویدیو یا شناسه‌ی ۱۱ نویسه‌ای' },
          { kind: 'search', name: 'channel', label: 'کانال', placeholder: 'نام یا شناسه‌ی کانال', className: 'basis-44 flex-none' },
          {
            kind: 'select',
            name: 'processing',
            label: 'وضعیت پردازش',
            defaultValue: 'ALL',
            options: [
              all,
              { value: 'READY', label: labels.processing.READY },
              { value: 'PENDING', label: 'در صف یا در حال پردازش' },
              { value: 'FAILED', label: labels.processing.FAILED },
              { value: 'AWAITING_UPLOAD', label: labels.processing.AWAITING_UPLOAD },
            ],
          },
          {
            kind: 'select',
            name: 'publish',
            label: 'وضعیت انتشار',
            defaultValue: 'ALL',
            options: [all, ...(Object.keys(labels.publish) as (keyof typeof labels.publish)[]).map((k) => ({ value: k, label: labels.publish[k] }))],
          },
          {
            kind: 'select',
            name: 'visibility',
            label: 'نمایش',
            defaultValue: 'ALL',
            options: [all, ...(Object.keys(labels.visibility) as (keyof typeof labels.visibility)[]).map((k) => ({ value: k, label: labels.visibility[k] }))],
          },
          {
            kind: 'select',
            name: 'takedown',
            label: 'خارج از دسترس',
            defaultValue: 'ALL',
            options: [all, { value: 'YES', label: 'فقط خارج‌شده‌ها' }, { value: 'NO', label: 'فقط در دسترس‌ها' }],
          },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon={Video} title={filtered ? 'ویدیویی با این فیلترها پیدا نشد' : 'هنوز ویدیویی بارگذاری نشده است'} description={filtered ? 'فیلترها را تغییر دهید یا پاک کنید.' : undefined} />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="ویدیو" />
          <ResultList label="فهرست ویدیوها">
            {items.map((v) => {
              const verdict = checkTargetUser(viewer, v.owner, 'video.takedown');
              return (
                <ResultRow key={v.id} className="items-start">
                  <Link href={`/watch/${v.id}`} target="_blank" rel="noopener" tabIndex={-1} aria-hidden="true" className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-32">
                    {v.posterUrl ? <img src={v.posterUrl} alt="" loading="lazy" className="size-full object-cover" /> : <PosterPlaceholder className="[&_svg]:size-6" />}
                    {v.durationSeconds != null && (
                      <span className="absolute end-1.5 bottom-1.5 rounded bg-black/75 px-1 py-0.5 text-[11px] font-medium text-white tabular-nums">{f.duration(v.durationSeconds)}</span>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1 basis-44 space-y-2 sm:basis-64">
                    <h2 className="line-clamp-2 text-[15px] leading-7 font-semibold" dir="auto">
                      {v.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      <Link href={`/admin/channels/${v.channel.id}`} className="hover:text-primary hover:underline" dir="auto">
                        {v.channel.name}
                      </Link>
                      <span aria-hidden="true"> · </span>
                      <span className="inline-flex items-center gap-1">
                        <Eye aria-hidden="true" className="size-3" />
                        {f.views(v.viewCount)}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <time dateTime={v.createdAt.toISOString()} title={f.dateTime(v.createdAt)} suppressHydrationWarning>
                        {f.relative(v.createdAt)}
                      </time>
                    </p>
                    <VideoStateBadges processingStatus={v.processingStatus} publishStatus={v.publishStatus} visibility={v.visibility} takenDown={!!v.takedownAt} channelSuspended={v.channel.suspended} />
                    {v.takedownAt && v.takedownReason && (
                      <p className="text-xs text-muted-foreground" dir="auto">
                        دلیل خارج‌کردن: {v.takedownReason}
                      </p>
                    )}
                    {v.failureReason && v.processingStatus === 'FAILED' && (
                      <p className="text-xs text-destructive" dir="auto">
                        خطای پردازش: {v.failureReason}
                      </p>
                    )}
                    {v.openReports > 0 && (
                      <Badge variant="warning">
                        <Flag />
                        {f.number(v.openReports)} گزارش باز
                      </Badge>
                    )}
                  </div>
                  <div className="w-full sm:w-auto">
                  <VideoActions
                    videoId={v.id}
                    title={v.title}
                    takenDown={!!v.takedownAt}
                    openReports={v.openReports}
                    canModerate={roleCan(viewer.role, 'video.takedown')}
                    canDelete={roleCan(viewer.role, 'video.delete') && checkTargetUser(viewer, v.owner, 'video.delete').ok}
                    denial={verdict.ok ? null : verdict.message}
                  />
                  </div>
                </ResultRow>
              );
            })}
          </ResultList>
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/videos', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
