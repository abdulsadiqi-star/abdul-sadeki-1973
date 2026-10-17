import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Check, Info, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { RequestStatusBadge } from '@/components/admin/badges';
import { ChannelLink, DefList, Section, UserLink } from '@/components/admin/layout-bits';
import { MarkReviewing } from '@/components/admin/mark-reviewing';
import { RequestDecision } from '@/components/admin/request-decision';
import { requireStaffPage } from '@/features/admin/guard';
import { checkTargetUser, monetizationDecisionsFrom } from '@/features/admin/policy';
import { getMonetizationDetail } from '@/features/admin/queries/requests';
import { getFormatter } from '@/lib/format-server';
import { cn } from '@/lib/utils';

export const metadata = { title: 'درخواست درآمدزایی' };
export const dynamic = 'force-dynamic';

function MetOrNot({ ok }: { ok: boolean }) {
  return (
    <Badge variant={ok ? 'success' : 'warning'}>
      {ok ? <Check /> : <X />}
      {ok ? 'رسیده' : 'نرسیده'}
    </Badge>
  );
}

export default async function MonetizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaffPage('ADMIN');
  const { id } = await params;
  const f = await getFormatter();
  const app = await getMonetizationDetail(id);
  if (!app) notFound();

  const verdict = checkTargetUser(viewer, { id: app.owner.id, role: app.owner.role }, 'monetization.review');
  const decisions = monetizationDecisionsFrom(app.status);
  const { live, snapshot, requirements } = app;
  const liveHours = live.watchHours.real + live.watchHours.seed;

  const rows: { label: string; snapshot: number | null; live: number; required: number; format: (n: number) => string; note?: string }[] = [
    { label: 'دنبال‌کننده', snapshot: snapshot?.followers ?? null, live: live.followers, required: requirements.minFollowers, format: f.number },
    {
      label: `ساعت تماشا (${f.number(live.windowDays)} روز اخیر)`,
      snapshot: snapshot?.watchHours ?? null,
      live: liveHours,
      required: requirements.minWatchHours,
      format: (n) => f.number(Math.round(n)),
      note: live.watchHours.seed > 0 ? `شامل ${f.number(Math.round(live.watchHours.seed))} ساعت داده‌ی آزمایشی` : undefined,
    },
    { label: 'ویدیوی عمومی', snapshot: snapshot?.videoCount ?? null, live: live.publicVideos, required: requirements.minPublicVideos, format: f.number },
  ];

  return (
    <div>
      <MarkReviewing kind="monetization" id={app.id} pending={app.status === 'SUBMITTED'} />
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2">
        <Link href="/admin/monetization">
          <ArrowRight className="ltr:rotate-180" />
          بازگشت به درخواست‌های درآمدزایی
        </Link>
      </Button>
      <PageHeader title={`درخواست درآمدزایی «${app.channel.name}»`} description={app.submittedAt ? `ثبت‌شده ${f.dateTime(app.submittedAt)}` : undefined} actions={<RequestStatusBadge kind="monetization" status={app.status} />} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Section id="stats" title="آمار کانال" description="آمار زنده از جدول‌های سامانه خوانده می‌شود؛ ستون «هنگام ثبت» همان است که سازنده با درخواستش ثبت کرده است.">
            {/* Wide screens: a table. Phones: one compact block per metric (five columns do not fit and would hide the verdict). */}
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <caption className="sr-only">مقایسه‌ی آمار هنگام ثبت و آمار زنده با حداقل‌های برنامه</caption>
                <thead>
                  <tr className="border-b text-start text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pe-3 text-start font-semibold">شاخص</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">هنگام ثبت</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">اکنون</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">حداقل برنامه</th>
                    <th scope="col" className="ps-3 py-2 text-start font-semibold">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b last:border-0">
                      <th scope="row" className="py-3 pe-3 text-start font-medium">
                        {r.label}
                        {r.note && <span className="block text-xs font-normal text-muted-foreground">{r.note}</span>}
                      </th>
                      <td className="px-3 py-3 tabular-nums">{r.snapshot === null ? '—' : r.format(r.snapshot)}</td>
                      <td className="px-3 py-3 font-semibold tabular-nums">{r.format(r.live)}</td>
                      <td className="px-3 py-3 tabular-nums text-muted-foreground">{r.format(r.required)}</td>
                      <td className="ps-3 py-3">
                        <MetOrNot ok={r.live >= r.required} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-label="مقایسه‌ی آمار هنگام ثبت و آمار زنده با حداقل‌های برنامه" className="divide-y rounded-lg border sm:hidden">
              {rows.map((r) => (
                <li key={r.label} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm font-medium">
                      {r.label}
                      {r.note && <span className="block text-xs font-normal text-muted-foreground">{r.note}</span>}
                    </p>
                    <MetOrNot ok={r.live >= r.required} />
                  </div>
                  <dl className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">هنگام ثبت</dt>
                      <dd className="mt-0.5 text-sm tabular-nums">{r.snapshot === null ? '—' : r.format(r.snapshot)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">اکنون</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{r.format(r.live)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">حداقل برنامه</dt>
                      <dd className="mt-0.5 text-sm tabular-nums text-muted-foreground">{r.format(r.required)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <p className={cn('mt-3 flex items-start gap-2 text-xs text-muted-foreground')}>
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                بازدید کل کانال: {f.number(live.totalViews)} · کل ویدیوها: {f.number(live.totalVideos)}
                {snapshot?.capturedAt ? ` · آمار ثبت‌شده در ${f.dateTime(snapshot.capturedAt)} گرفته شده است` : ''}
              </span>
            </p>
          </Section>

          <Section id="info" title="مشخصات درخواست">
            <DefList
              items={[
                { label: 'کانال', value: <ChannelLink id={app.channel.id} name={app.channel.name} handle={app.channel.handle} avatarUrl={app.channel.avatarUrl} isVerified={app.channel.isVerified} /> },
                { label: 'صاحب کانال', value: <UserLink id={app.owner.id} name={app.owner.name} role={app.owner.role} email={app.owner.email} /> },
                { label: 'ایمیل تماس', value: app.contactEmail ? <span className="ltr-isolate">{app.contactEmail}</span> : '—' },
                { label: 'پذیرش شرایط', value: app.acceptedTermsAt ? f.dateTime(app.acceptedTermsAt) : '—' },
                { label: 'زمان ثبت', value: app.submittedAt ? f.dateTime(app.submittedAt) : '—' },
                { label: 'بررسی‌کننده', value: app.reviewer ? <UserLink id={app.reviewer.id} name={app.reviewer.name} /> : '—' },
              ]}
            />
          </Section>

          {app.previous.length > 0 && (
            <Section id="previous" title="درخواست‌های پیشین این کانال">
              <ul className="divide-y rounded-lg border">
                {app.previous.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                    <RequestStatusBadge kind="monetization" status={p.status} />
                    <span className="text-xs text-muted-foreground">{p.submittedAt ? f.date(p.submittedAt) : ''}</span>
                    <span className="min-w-0 flex-1 basis-40 text-muted-foreground" dir="auto">
                      {p.decisionNote ?? ''}
                    </span>
                    <Link href={`/admin/monetization/${p.id}`} className="text-xs font-medium text-primary hover:underline">
                      مشاهده
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:self-start">
          <Section id="decision" title="تصمیم" description="هر تصمیم در گزارش فعالیت‌ها ثبت می‌شود و سازنده را مطلع می‌کند.">
            {(app.status === 'APPROVED' || app.status === 'REJECTED' || app.status === 'SUSPENDED') && (
              <div className="mb-4 space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
                <p className="font-semibold">وضعیت فعلی: {<RequestStatusBadge kind="monetization" status={app.status} />}</p>
                {app.reviewedAt && <p className="text-xs text-muted-foreground">{f.dateTime(app.reviewedAt)}{app.reviewer ? ` — ${app.reviewer.name}` : ''}</p>}
                {app.decisionNote && (
                  <p className="text-sm" dir="auto">
                    توضیح: {app.decisionNote}
                  </p>
                )}
              </div>
            )}
            <RequestDecision kind="monetization" id={app.id} channelName={app.channel.name} decisions={decisions} denial={verdict.ok ? null : verdict.message} />
          </Section>
        </div>
      </div>
    </div>
  );
}
