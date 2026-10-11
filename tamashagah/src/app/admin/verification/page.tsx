import Link from 'next/link';
import type { Route } from 'next';
import { BadgeCheck, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { RequestStatusBadge } from '@/components/admin/badges';
import { FilterBar } from '@/components/admin/filter-bar';
import { ChannelLink, ResultList, ResultRow } from '@/components/admin/layout-bits';
import { ResultCount } from '@/components/admin/result-count';
import { requireStaffPage } from '@/features/admin/guard';
import { listVerification } from '@/features/admin/queries/requests';
import { flattenSearchParams, verificationListSchema } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'درخواست‌های تیک تأیید' };
export const dynamic = 'force-dynamic';

export default async function AdminVerificationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('MODERATOR');
  const raw = await searchParams;
  const filters = verificationListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const { items, pageInfo } = await listVerification(filters);

  const values = { status: filters.status, q: filters.q ?? '' };
  const filtered = filters.status !== 'PENDING' || !!filters.q;

  return (
    <div>
      <PageHeader title="درخواست‌های تیک تأیید" description="درخواست سازندگان برای نشان کانال تأییدشده. مدارک و پیوندهای هر درخواست را ببینید و با ذکر دلیل تأیید یا رد کنید." />

      <FilterBar
        key={JSON.stringify(values)}
        label="فیلتر درخواست‌های تیک تأیید"
        values={values}
        fields={[
          { kind: 'search', name: 'q', label: 'جستجوی کانال', placeholder: 'نام یا شناسه‌ی کانال' },
          {
            kind: 'select',
            name: 'status',
            label: 'وضعیت',
            defaultValue: 'PENDING',
            options: [
              { value: 'PENDING', label: 'در انتظار تصمیم' },
              { value: 'SUBMITTED', label: labels.verification.SUBMITTED },
              { value: 'UNDER_REVIEW', label: labels.verification.UNDER_REVIEW },
              { value: 'APPROVED', label: labels.verification.APPROVED },
              { value: 'REJECTED', label: labels.verification.REJECTED },
              { value: 'ALL', label: 'همه' },
            ],
          },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon={BadgeCheck} title={filtered ? 'درخواستی با این فیلترها پیدا نشد' : 'درخواست در انتظاری نیست'} description={filtered ? 'فیلترها را تغییر دهید یا پاک کنید.' : 'درخواست‌های تازه‌ی تیک تأیید اینجا نمایش داده می‌شوند.'} />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="درخواست" />
          <ResultList label="درخواست‌های تیک تأیید">
            {items.map((r) => (
              <ResultRow key={r.id} className="items-start">
                <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                  <ChannelLink id={r.channel.id} name={r.channel.name} handle={r.channel.handle} avatarUrl={r.channel.avatarUrl} isVerified={r.channel.isVerified} size="md" />
                  <p className="line-clamp-2 text-sm leading-7 text-muted-foreground" dir="auto">
                    «{r.excerpt}»
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{f.followers(r.channel.followerCount)}</span>
                    <span className="inline-flex items-center gap-1">
                      <Link2 aria-hidden="true" className="size-3" />
                      {f.count(r.evidenceCount, 'پیوند مدرک')}
                    </span>
                    <span>ثبت‌شده {f.relative(r.createdAt)}</span>
                  </p>
                </div>
                <RequestStatusBadge kind="verification" status={r.status} />
                <Button asChild variant={r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto">
                  <Link href={`/admin/verification/${r.id}`}>{r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW' ? 'بررسی' : 'مشاهده'}</Link>
                </Button>
              </ResultRow>
            ))}
          </ResultList>
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/verification', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
