import Link from 'next/link';
import type { Route } from 'next';
import { Clapperboard, Flag, MessageSquare, ShieldCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PosterPlaceholder } from '@/components/video/video-card';
import { FilterBar } from '@/components/admin/filter-bar';
import { ReportStatusBadge } from '@/components/admin/badges';
import { ResultList, ResultRow } from '@/components/admin/layout-bits';
import { ResultCount } from '@/components/admin/result-count';
import { adminLabels, reportAgeLabels, reportQueueStatusLabels } from '@/features/admin/labels';
import { requireStaffPage } from '@/features/admin/guard';
import { getReportStatusCounts, listReports, type ReportListItem } from '@/features/admin/queries/reports';
import { flattenSearchParams, reportListSchema } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'گزارش‌ها' };
export const dynamic = 'force-dynamic';

function TargetThumb({ target }: { target: ReportListItem['target'] }) {
  if (!target) return <span className="flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">؟</span>;
  if (target.type === 'VIDEO') {
    return (
      <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-28">
        {target.posterUrl ? <img src={target.posterUrl} alt="" loading="lazy" className="size-full object-cover" /> : <PosterPlaceholder className="[&_svg]:size-6" />}
      </span>
    );
  }
  if (target.type === 'CHANNEL') return <ChannelAvatar name={target.name} src={target.avatarUrl} size="md" />;
  return (
    <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
      <MessageSquare aria-hidden="true" className="size-5" />
    </span>
  );
}

function targetTitle(item: ReportListItem): string {
  const t = item.target;
  if (!t) return 'مورد گزارش‌شده دیگر در دسترس نیست';
  if (t.type === 'VIDEO') return t.title;
  if (t.type === 'CHANNEL') return t.name;
  return t.excerpt;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('MODERATOR');
  const raw = await searchParams;
  const filters = reportListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const [{ items, pageInfo }, counts] = await Promise.all([listReports(filters), getReportStatusCounts()]);

  const values = { status: filters.status, target: filters.target, reason: filters.reason, age: filters.age, sort: filters.sort };
  const filtered = filters.status !== 'PENDING' || filters.target !== 'ALL' || filters.reason !== 'ALL' || filters.age !== 'ALL';

  return (
    <div>
      <PageHeader
        title="گزارش‌ها"
        description="گزارش‌های کاربران درباره‌ی ویدیوها، دیدگاه‌ها و کانال‌ها. هر گزارش را بررسی کنید و با ذکر دلیل تصمیم بگیرید."
      />

      <FilterBar
        key={JSON.stringify(values)}
        label="فیلتر گزارش‌ها"
        values={values}
        fields={[
          {
            kind: 'select',
            name: 'status',
            label: 'وضعیت',
            defaultValue: 'PENDING',
            options: (Object.keys(reportQueueStatusLabels) as (keyof typeof reportQueueStatusLabels)[]).map((key) => ({
              value: key,
              label: `${reportQueueStatusLabels[key]} (${f.number(counts[key])})`,
            })),
          },
          {
            kind: 'select',
            name: 'target',
            label: 'نوع مورد',
            defaultValue: 'ALL',
            options: [{ value: 'ALL', label: 'همه' }, ...(['VIDEO', 'COMMENT', 'CHANNEL'] as const).map((t) => ({ value: t, label: adminLabels.reportTarget[t] }))],
          },
          {
            kind: 'select',
            name: 'reason',
            label: 'دلیل گزارش',
            defaultValue: 'ALL',
            options: [{ value: 'ALL', label: 'همه' }, ...(Object.keys(labels.reportReason) as (keyof typeof labels.reportReason)[]).map((r) => ({ value: r, label: labels.reportReason[r] }))],
          },
          {
            kind: 'select',
            name: 'age',
            label: 'قدمت گزارش',
            defaultValue: 'ALL',
            options: (Object.keys(reportAgeLabels) as (keyof typeof reportAgeLabels)[]).map((a) => ({ value: a, label: reportAgeLabels[a] })),
          },
          {
            kind: 'select',
            name: 'sort',
            label: 'مرتب‌سازی',
            defaultValue: 'oldest',
            options: [
              { value: 'oldest', label: 'قدیمی‌ترین ابتدا' },
              { value: 'newest', label: 'جدیدترین ابتدا' },
            ],
          },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={filtered ? Flag : ShieldCheck}
          title={filtered ? 'گزارشی با این فیلترها پیدا نشد' : 'صف گزارش‌ها خالی است'}
          description={filtered ? 'فیلترها را تغییر دهید یا پاک کنید.' : 'همه‌ی گزارش‌ها بررسی شده‌اند. آفرین!'}
        />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="گزارش" />
          <ResultList label="صف گزارش‌ها">
            {items.map((item) => (
              <ResultRow key={item.id}>
                <TargetThumb target={item.target} />
                <div className="min-w-0 flex-1 basis-44 sm:basis-60">
                  <h2 className="line-clamp-2 text-[15px] leading-7 font-semibold" dir="auto">
                    <Link href={`/admin/reports/${item.id}`} className="hover:text-primary hover:underline">
                      {targetTitle(item)}
                    </Link>
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                      {item.targetType === 'VIDEO' ? <Clapperboard /> : item.targetType === 'CHANNEL' ? <Users /> : <MessageSquare />}
                      {adminLabels.reportTarget[item.targetType]}
                    </Badge>
                    <Badge variant="secondary">{labels.reportReason[item.reason]}</Badge>
                    <ReportStatusBadge status={item.status} />
                    {item.openOnTarget > 1 && <Badge variant="warning">{f.number(item.openOnTarget)} گزارش باز روی همین مورد</Badge>}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    <span>گزارش‌دهنده: {item.reporter ? <span dir="auto">{item.reporter.name}</span> : 'حساب حذف‌شده'}</span>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={item.createdAt.toISOString()} title={f.dateTime(item.createdAt)} suppressHydrationWarning>
                      {f.relative(item.createdAt)}
                    </time>
                  </p>
                  {item.details && (
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground" dir="auto">
                      «{item.details}»
                    </p>
                  )}
                </div>
                <Button asChild variant={item.status === 'OPEN' || item.status === 'REVIEWING' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto">
                  <Link href={`/admin/reports/${item.id}`}>{item.status === 'OPEN' || item.status === 'REVIEWING' ? 'بررسی' : 'مشاهده'}</Link>
                </Button>
              </ResultRow>
            ))}
          </ResultList>
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/reports', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
