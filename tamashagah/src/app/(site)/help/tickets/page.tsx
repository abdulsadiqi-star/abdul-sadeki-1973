import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { requirePageUser } from '@/lib/auth/guards';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { parsePage } from '@/features/discovery/category';
import { TicketForm } from '@/features/support/components/ticket-form';
import { TicketStatusBadge } from '@/features/support/components/ticket-status-badge';
import { listMyTickets } from '@/features/support/queries';
import { MAX_OPEN_TICKETS, TICKET_CATEGORIES } from '@/features/support/schemas';

export const metadata: Metadata = {
  title: 'تیکت‌های پشتیبانی',
  description: 'مشکل یا پیشنهاد خود را برای پشتیبانی تماشاگاه بنویسید و پاسخ را در همین‌جا پیگیری کنید.',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function TicketsPage({ searchParams }: Props) {
  const user = await requirePageUser('/help/tickets');
  const sp = await searchParams;
  const page = parsePage(sp.page, 200);
  const category = first(sp.category);
  const defaultCategory = (TICKET_CATEGORIES as readonly string[]).includes(category ?? '') ? (category as (typeof TICKET_CATEGORIES)[number]) : undefined;
  const defaultSubject = (first(sp.subject) ?? '').slice(0, 120);

  const [f, { tickets, total, pageCount }] = await Promise.all([getFormatter(), listMyTickets(user.id, page)]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="تیکت‌های پشتیبانی"
        description="پیش از ثبت تیکت، نگاهی به مرکز راهنما بیندازید؛ شاید پاسخ همان‌جا باشد."
        actions={
          <Link href="/help" className="text-sm text-primary underline-offset-4 hover:underline">
            مرکز راهنما
          </Link>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="my-tickets" className="min-w-0 space-y-3 lg:order-1">
          <h2 id="my-tickets" className="text-lg font-bold">
            تیکت‌های من{total > 0 ? <span className="ms-2 text-sm font-normal text-muted-foreground">({f.number(total)})</span> : null}
          </h2>
          {tickets.length === 0 ? (
            <EmptyState icon={Inbox} title="هنوز تیکتی ثبت نکرده‌اید" description="وقتی مشکلی داشتید یا سؤالی بی‌پاسخ ماند، از فرم کنار صفحه تیکت بفرستید. پاسخ پشتیبانی همین‌جا نمایش داده می‌شود." />
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/help/tickets/${ticket.id}` as Route}
                    className="flex flex-col gap-1.5 p-4 transition-colors outline-none first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground tabular-nums">#{f.number(ticket.number)}</span>
                      <TicketStatusBadge status={ticket.status} />
                      {ticket.awaitingUser && <Badge variant="warning">پاسخ تازه</Badge>}
                    </span>
                    <span dir="auto" className="user-text font-semibold">
                      {ticket.subject}
                    </span>
                    <span className="text-[13px] text-muted-foreground" suppressHydrationWarning>
                      {labels.ticketCategory[ticket.category]} · {f.count(ticket.messageCount, 'پیام')} · آخرین فعالیت {f.relative(ticket.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} pageCount={pageCount} href={(p) => `/help/tickets${p > 1 ? `?page=${p}` : ''}`} className="pt-2" />
        </section>

        <Card className="lg:order-2 lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>
              <h2>تیکت تازه</h2>
            </CardTitle>
            <CardDescription>
              پاسخ همین‌جا و در همین تیکت نمایش داده می‌شود. هر نفر تا {f.number(MAX_OPEN_TICKETS)} تیکت باز می‌تواند داشته باشد.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TicketForm defaultCategory={defaultCategory} defaultSubject={defaultSubject} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
