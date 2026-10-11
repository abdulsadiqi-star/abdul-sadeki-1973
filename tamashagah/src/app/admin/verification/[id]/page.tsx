import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ExternalLink, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { RequestStatusBadge } from '@/components/admin/badges';
import { ChannelLink, DefList, Section, UserLink, UserText } from '@/components/admin/layout-bits';
import { MarkReviewing } from '@/components/admin/mark-reviewing';
import { RequestDecision } from '@/components/admin/request-decision';
import { requireStaffPage } from '@/features/admin/guard';
import { checkTargetUser } from '@/features/admin/policy';
import { getVerificationDetail } from '@/features/admin/queries/requests';
import { getFormatter } from '@/lib/format-server';

export const metadata = { title: 'درخواست تیک تأیید' };
export const dynamic = 'force-dynamic';

export default async function VerificationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const { id } = await params;
  const f = await getFormatter();
  const request = await getVerificationDetail(id);
  if (!request) notFound();

  const verdict = checkTargetUser(viewer, { id: request.owner.id, role: request.owner.role }, 'verification.review');
  const pending = request.status === 'SUBMITTED' || request.status === 'UNDER_REVIEW';

  return (
    <div>
      <MarkReviewing kind="verification" id={request.id} pending={request.status === 'SUBMITTED'} />
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2">
        <Link href="/admin/verification">
          <ArrowRight className="ltr:rotate-180" />
          بازگشت به درخواست‌های تیک تأیید
        </Link>
      </Button>
      <PageHeader
        title={`درخواست تیک تأیید «${request.channel.name}»`}
        description={`ثبت‌شده ${f.dateTime(request.createdAt)}`}
        actions={<RequestStatusBadge kind="verification" status={request.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Section id="message" title="پیام سازنده">
            <UserText>{request.message}</UserText>
          </Section>

          <Section id="evidence" title="مدارک و پیوندها" description="پیوندها در برگه‌ی جدید و بدون ارسال اطلاعات سایت باز می‌شوند. فقط نشانی‌های http و https قابل‌کلیک هستند.">
            {request.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">سازنده پیوندی به‌عنوان مدرک ثبت نکرده است.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {request.evidence.map((e, i) => (
                  <li key={`${e.url}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                    <span className="min-w-0 flex-1 basis-40 font-medium" dir="auto">
                      {e.title}
                    </span>
                    {e.safe ? (
                      <a href={e.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="ltr-isolate inline-flex min-w-0 max-w-full items-center gap-1.5 break-all text-primary hover:underline">
                        <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                        {e.url}
                        <span className="sr-only"> (در برگه‌ی جدید)</span>
                      </a>
                    ) : (
                      <span className="ltr-isolate break-all text-muted-foreground">{e.url} (نشانی نامعتبر؛ باز نمی‌شود)</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="channel" title="کانال و سازنده">
            <DefList
              items={[
                { label: 'کانال', value: <ChannelLink id={request.channel.id} name={request.channel.name} handle={request.channel.handle} avatarUrl={request.channel.avatarUrl} isVerified={request.channel.isVerified} /> },
                { label: 'صاحب کانال', value: <UserLink id={request.owner.id} name={request.owner.name} role={request.owner.role} email={request.owner.email} /> },
                { label: 'دنبال‌کننده', value: f.number(request.channel.followerCount) },
                { label: 'ویدیو', value: f.number(request.channel.videoCount) },
                { label: 'ساخته‌شده', value: f.date(request.channel.createdAt) },
                { label: 'وضعیت کانال', value: request.channel.suspended ? 'تعلیق‌شده' : request.channel.isVerified ? 'دارای تیک تأیید' : 'فعال' },
              ]}
            />
            {request.channel.description && (
              <p className="mt-4 line-clamp-4 border-t pt-3 text-sm leading-7 text-muted-foreground" dir="auto">
                {request.channel.description}
              </p>
            )}
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href={`/channel/${request.channel.handle}`} target="_blank" rel="noopener">
                <ExternalLink />
                صفحه‌ی کانال در سایت
                <span className="sr-only"> (در برگه‌ی جدید)</span>
              </Link>
            </Button>
          </Section>

          {request.previous.length > 0 && (
            <Section id="previous" title="درخواست‌های پیشین این کانال">
              <ul className="divide-y rounded-lg border">
                {request.previous.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                    <RequestStatusBadge kind="verification" status={p.status} />
                    <span className="text-xs text-muted-foreground">{f.date(p.createdAt)}</span>
                    <span className="min-w-0 flex-1 basis-40 text-muted-foreground" dir="auto">
                      {p.decisionNote ?? ''}
                    </span>
                    <Link href={`/admin/verification/${p.id}`} className="text-xs font-medium text-primary hover:underline">
                      مشاهده
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:self-start">
          <Section id="decision" title="تصمیم" description="تصمیم شما در گزارش فعالیت‌ها ثبت می‌شود و سازنده اعلان می‌گیرد.">
            {!pending && (
              <div className="mb-4 space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
                <p className="font-semibold">این درخواست بررسی شده است.</p>
                {request.reviewedAt && (
                  <p className="text-xs text-muted-foreground">
                    {f.dateTime(request.reviewedAt)}
                    {request.reviewer ? ` — ${request.reviewer.name}` : ''}
                  </p>
                )}
                {request.decisionNote && (
                  <p dir="auto">توضیح: {request.decisionNote}</p>
                )}
              </div>
            )}
            {pending && request.channel.suspended && (
              <Alert variant="warning" className="mb-4">
                <ShieldAlert />
                <AlertDescription className="text-foreground">این کانال تعلیق است؛ تأیید آن ممکن نیست و فقط می‌توانید درخواست را رد کنید.</AlertDescription>
              </Alert>
            )}
            <RequestDecision
              kind="verification"
              id={request.id}
              channelName={request.channel.name}
              decisions={pending ? (request.channel.suspended ? ['REJECT'] : ['APPROVE', 'REJECT']) : []}
              denial={verdict.ok ? null : verdict.message}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
