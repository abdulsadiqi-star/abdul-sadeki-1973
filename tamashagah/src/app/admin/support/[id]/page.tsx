import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Headset, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { RoleBadge, TicketStatusBadge } from '@/components/admin/badges';
import { DefList, Section, UserLink } from '@/components/admin/layout-bits';
import { TicketPanel } from '@/components/admin/ticket-panel';
import { requireStaffPage } from '@/features/admin/guard';
import { checkTargetUser } from '@/features/admin/policy';
import { getTicketDetail } from '@/features/admin/queries/support';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';

export const metadata = { title: 'تیکت پشتیبانی' };
export const dynamic = 'force-dynamic';

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const { id } = await params;
  const f = await getFormatter();
  const ticket = await getTicketDetail(id);
  if (!ticket) notFound();
  const verdict = checkTargetUser(viewer, ticket.user ? { id: ticket.user.id, role: ticket.user.role } : null, 'ticket.handle');

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2">
        <Link href="/admin/support">
          <ArrowRight className="ltr:rotate-180" />
          بازگشت به فهرست تیکت‌ها
        </Link>
      </Button>
      <PageHeader title={`تیکت شماره‌ی ${f.number(ticket.number)}`} description={ticket.subject} actions={<TicketStatusBadge status={ticket.status} />} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Section id="thread" title="گفت‌وگو" description={`${f.count(ticket.messages.length, 'پیام')}`}>
            <ol className="space-y-3" aria-label="پیام‌های تیکت">
              {ticket.messages.map((m) => (
                <li key={m.id} className={cn('flex gap-3', m.isStaff && 'flex-row-reverse')}>
                  <span
                    className={cn('mt-1 flex size-8 shrink-0 items-center justify-center rounded-full', m.isStaff ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground')}
                    aria-hidden="true"
                  >
                    {m.isStaff ? <Headset className="size-4" /> : <UserRound className="size-4" />}
                  </span>
                  <div className={cn('max-w-[85%] min-w-0 rounded-2xl px-4 py-3', m.isStaff ? 'rounded-se-sm bg-accent/60' : 'rounded-ss-sm bg-muted/70')}>
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground" dir="auto">
                        {m.isStaff ? (m.authorName ?? 'پشتیبانی') : (m.authorName ?? ticket.user?.name ?? 'کاربر')}
                      </span>
                      <Badge variant={m.isStaff ? 'default' : 'outline'}>{m.isStaff ? 'پشتیبانی' : 'کاربر'}</Badge>
                      <time dateTime={m.createdAt.toISOString()} title={f.dateTime(m.createdAt)} suppressHydrationWarning>
                        {f.relative(m.createdAt)}
                      </time>
                    </p>
                    <p className="user-text text-sm leading-7 break-words whitespace-pre-line" dir="auto">
                      {m.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="reply" title="پاسخ پشتیبانی">
            <TicketPanel ticketId={ticket.id} number={ticket.number} status={ticket.status} denial={verdict.ok ? null : verdict.message} />
          </Section>
        </div>

        <div className="lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:self-start">
          <Section id="info" title="مشخصات تیکت">
            <DefList
              className="sm:grid-cols-1"
              items={[
                { label: 'دسته‌بندی', value: labels.ticketCategory[ticket.category] },
                { label: 'وضعیت', value: <TicketStatusBadge status={ticket.status} /> },
                {
                  label: 'کاربر',
                  value: ticket.user ? (
                    <span className="flex flex-col gap-1">
                      <UserLink id={ticket.user.id} name={ticket.user.name} role={ticket.user.role} />
                      {ticket.user.role === 'USER' || ticket.user.role === 'CREATOR' ? <RoleBadge role={ticket.user.role} /> : null}
                    </span>
                  ) : (
                    'حساب حذف‌شده'
                  ),
                },
                { label: 'ایمیل', value: <span className="ltr-isolate break-all">{ticket.email}</span> },
                { label: 'ایجاد', value: f.dateTime(ticket.createdAt) },
                { label: 'آخرین به‌روزرسانی', value: f.dateTime(ticket.updatedAt) },
              ]}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
