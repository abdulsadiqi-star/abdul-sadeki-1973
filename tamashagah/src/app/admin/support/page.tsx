import Link from 'next/link';
import type { Route } from 'next';
import { LifeBuoy, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { TicketStatusBadge } from '@/components/admin/badges';
import { FilterBar } from '@/components/admin/filter-bar';
import { ResultList, ResultRow } from '@/components/admin/layout-bits';
import { ResultCount } from '@/components/admin/result-count';
import { requireStaffPage } from '@/features/admin/guard';
import { listSupportTickets } from '@/features/admin/queries/support';
import { flattenSearchParams, supportListSchema } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'پشتیبانی' };
export const dynamic = 'force-dynamic';

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaffPage('MODERATOR');
  const raw = await searchParams;
  const filters = supportListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const { items, pageInfo } = await listSupportTickets(filters);

  const values = { status: filters.status, category: filters.category, q: filters.q ?? '' };
  const filtered = filters.status !== 'ACTIVE' || filters.category !== 'ALL' || !!filters.q;

  return (
    <div>
      <PageHeader title="پشتیبانی" description="تیکت‌های کاربران. تیکت‌های بی‌پاسخ، به ترتیب قدیمی‌ترین انتظار، بالای فهرست هستند." />

      <FilterBar
        key={JSON.stringify(values)}
        label="فیلتر تیکت‌ها"
        values={values}
        fields={[
          { kind: 'search', name: 'q', label: 'جستجو', placeholder: 'شماره‌ی تیکت، موضوع یا ایمیل' },
          {
            kind: 'select',
            name: 'status',
            label: 'وضعیت',
            defaultValue: 'ACTIVE',
            options: [
              { value: 'ACTIVE', label: 'باز و پاسخ‌داده‌شده' },
              { value: 'OPEN', label: labels.ticketStatus.OPEN },
              { value: 'ANSWERED', label: labels.ticketStatus.ANSWERED },
              { value: 'CLOSED', label: labels.ticketStatus.CLOSED },
              { value: 'ALL', label: 'همه' },
            ],
          },
          {
            kind: 'select',
            name: 'category',
            label: 'دسته‌بندی',
            defaultValue: 'ALL',
            options: [{ value: 'ALL', label: 'همه' }, ...(Object.keys(labels.ticketCategory) as (keyof typeof labels.ticketCategory)[]).map((c) => ({ value: c, label: labels.ticketCategory[c] }))],
          },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon={LifeBuoy} title={filtered ? 'تیکتی با این فیلترها پیدا نشد' : 'تیکت بازی وجود ندارد'} description={filtered ? 'فیلترها را تغییر دهید یا پاک کنید.' : 'تیکت‌های تازه‌ی کاربران اینجا نمایش داده می‌شوند.'} />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="تیکت" />
          <ResultList label="فهرست تیکت‌ها">
            {items.map((t) => (
              <ResultRow key={t.id} className="items-start">
                <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <span className="text-[10px] leading-none">شماره</span>
                  <span className="text-sm font-bold tabular-nums">{f.number(t.number)}</span>
                </span>
                <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                  <h2 className="line-clamp-1 text-[15px] leading-7 font-semibold" dir="auto">
                    <Link href={`/admin/support/${t.id}`} className="hover:text-primary hover:underline">
                      {t.subject}
                    </Link>
                  </h2>
                  {t.lastMessage && (
                    <p className="line-clamp-1 text-sm text-muted-foreground" dir="auto">
                      <span className="font-medium">{t.lastMessage.isStaff ? 'پشتیبانی: ' : 'کاربر: '}</span>
                      {t.lastMessage.excerpt}
                    </p>
                  )}
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span dir="auto">{t.user ? t.user.name : <span className="ltr-isolate">{t.email}</span>}</span>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare aria-hidden="true" className="size-3" />
                      {f.count(t.messageCount, 'پیام')}
                    </span>
                    <time dateTime={t.updatedAt.toISOString()} title={f.dateTime(t.updatedAt)} suppressHydrationWarning>
                      آخرین به‌روزرسانی {f.relative(t.updatedAt)}
                    </time>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{labels.ticketCategory[t.category]}</Badge>
                  <TicketStatusBadge status={t.status} />
                </div>
                <Button asChild variant={t.status === 'OPEN' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto">
                  <Link href={`/admin/support/${t.id}`}>{t.status === 'OPEN' ? 'پاسخ' : 'مشاهده'}</Link>
                </Button>
              </ResultRow>
            ))}
          </ResultList>
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/support', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
