import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight, Headset } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { requirePageUser } from '@/lib/auth/guards';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';
import { TicketReplyForm } from '@/features/support/components/ticket-reply-form';
import { TicketStatusBadge } from '@/features/support/components/ticket-status-badge';
import { getMyTicket } from '@/features/support/queries';
import { MAX_MESSAGES_PER_TICKET } from '@/features/support/schemas';

export const metadata: Metadata = { title: 'گفتگوی تیکت', robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/** One ticket thread. Somebody else's ticket (or an unknown id) is a plain 404. */
export default async function TicketPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/help/tickets/${id}`);
  const ticket = await getMyTicket(user.id, id);
  if (!ticket) notFound();
  const f = await getFormatter();
  const full = ticket.messages.length >= MAX_MESSAGES_PER_TICKET;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/help/tickets" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-0 ltr:rotate-180" />
        همه‌ی تیکت‌ها
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">تیکت شماره‌ی {f.number(ticket.number)}</span>
          <TicketStatusBadge status={ticket.status} />
        </div>
        <h1 dir="auto" className="user-text text-2xl font-extrabold">
          {ticket.subject}
        </h1>
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          {labels.ticketCategory[ticket.category]} · ثبت‌شده در {f.dateTime(ticket.createdAt, 'long')}
        </p>
      </header>

      <ol aria-label="پیام‌های تیکت" className="space-y-3">
        {ticket.messages.map((message) => (
          <li
            key={message.id}
            className={cn('rounded-2xl border p-4', message.isStaff ? 'border-primary/30 bg-accent/40' : 'bg-card')}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                {message.isStaff && <Headset aria-hidden="true" className="size-4 text-primary" />}
                {message.isStaff ? 'تیم پشتیبانی' : 'شما'}
              </span>
              <time dateTime={message.createdAt} suppressHydrationWarning>
                {f.dateTime(message.createdAt, 'long')}
              </time>
            </div>
            <p dir="auto" className="user-text leading-8 whitespace-pre-wrap">
              {message.body}
            </p>
          </li>
        ))}
      </ol>

      {full ? (
        <Alert variant="info" role="note">
          <AlertDescription className="text-foreground">
            این گفتگو به سقف تعداد پیام‌ها رسیده است. برای ادامه، یک تیکت تازه ثبت کنید.
          </AlertDescription>
        </Alert>
      ) : (
        <section aria-labelledby="reply" className="rounded-2xl border bg-card p-4">
          <h2 id="reply" className="sr-only">
            ارسال پاسخ
          </h2>
          <TicketReplyForm ticketId={ticket.id} closed={ticket.status === 'CLOSED'} />
        </section>
      )}
    </div>
  );
}
