import Link from 'next/link';
import type { Route } from 'next';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { RequestStatusBadge } from '@/components/admin/badges';
import { FilterBar } from '@/components/admin/filter-bar';
import { ChannelLink, ResultList, ResultRow } from '@/components/admin/layout-bits';
import { ResultCount } from '@/components/admin/result-count';
import { requireStaffPage } from '@/features/admin/guard';
import { listMonetization } from '@/features/admin/queries/requests';
import { flattenSearchParams, monetizationListSchema } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'درخواست‌های درآمدزایی' };
export const dynamic = 'force-dynamic';

export default async function AdminMonetizationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('ADMIN');
  const raw = await searchParams;
  const filters = monetizationListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const { items, pageInfo } = await listMonetization(filters);

  const values = { status: filters.status, q: filters.q ?? '' };
  const filtered = filters.status !== 'PENDING' || !!filters.q;

  return (
    <div>
      <PageHeader
        title="درخواست‌های درآمدزایی"
        description="درخواست سازندگان برای ورود به برنامه‌ی درآمدزایی. آمار لحظه‌ی ثبت با آمار زنده‌ی کانال مقایسه می‌شود؛ تصمیم و توضیح آن برای سازنده ارسال می‌شود."
      />

      <FilterBar
        key={JSON.stringify(values)}
        label="فیلتر درخواست‌های درآمدزایی"
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
              { value: 'SUBMITTED', label: labels.monetization.SUBMITTED },
              { value: 'UNDER_REVIEW', label: labels.monetization.UNDER_REVIEW },
              { value: 'APPROVED', label: labels.monetization.APPROVED },
              { value: 'REJECTED', label: labels.monetization.REJECTED },
              { value: 'SUSPENDED', label: labels.monetization.SUSPENDED },
              { value: 'ALL', label: 'همه' },
            ],
          },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon={Wallet} title={filtered ? 'درخواستی با این فیلترها پیدا نشد' : 'درخواست در انتظاری نیست'} description={filtered ? 'فیلترها را تغییر دهید یا پاک کنید.' : 'درخواست‌های تازه‌ی سازندگان اینجا نمایش داده می‌شوند.'} />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="درخواست" />
          <ResultList label="درخواست‌های درآمدزایی">
            {items.map((a) => (
              <ResultRow key={a.id}>
                <div className="min-w-0 flex-1 basis-56">
                  <ChannelLink id={a.channel.id} name={a.channel.name} handle={a.channel.handle} avatarUrl={a.channel.avatarUrl} isVerified={a.channel.isVerified} size="md" />
                </div>
                <div className="flex min-w-48 flex-col gap-1 text-xs text-muted-foreground">
                  {a.snapshot ? (
                    <>
                      <span>در زمان ثبت: {f.compact(a.snapshot.followers ?? 0)} دنبال‌کننده · {f.compact(a.snapshot.totalViews ?? 0)} بازدید</span>
                      <span>{f.number(Math.round(a.snapshot.watchHours ?? 0))} ساعت تماشا · {f.number(a.snapshot.videoCount ?? 0)} ویدیو</span>
                    </>
                  ) : (
                    <span>آمار لحظه‌ی ثبت موجود نیست</span>
                  )}
                  <span>{a.submittedAt ? `ثبت‌شده ${f.relative(a.submittedAt)}` : ''}</span>
                </div>
                <RequestStatusBadge kind="monetization" status={a.status} />
                <Button asChild variant={a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto">
                  <Link href={`/admin/monetization/${a.id}`}>{a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW' ? 'بررسی' : 'مشاهده'}</Link>
                </Button>
              </ResultRow>
            ))}
          </ResultList>
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/monetization', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
