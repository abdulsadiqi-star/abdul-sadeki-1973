import Link from 'next/link';
import { History } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatusBadge } from '@/components/studio/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { applicationActions } from '../rules';
import { PAYMENT_NOT_CONNECTED, statusDescription, statusVariant } from '../labels';
import type { ApplicationView } from '../queries';
import { ApplicationForm } from './application-form';
import { ApplicationTimeline } from './application-timeline';
import { WithdrawButton } from './withdraw-button';

/**
 * The application section. Which controls appear follows the newest application (`applicationActions`); the server
 * enforces the same rules, so a stale page can never do more than the rules allow.
 */
export async function ApplicationPanel({
  applications,
  eligible,
  suspended,
  defaultEmail,
}: {
  /** Newest first. */
  applications: ApplicationView[];
  eligible: boolean;
  suspended: boolean;
  defaultEmail: string;
}) {
  const f = await getFormatter();
  const latest = applications[0] ?? null;
  const actions = applicationActions(latest);
  const older = applications.slice(1);
  const showForm = actions.canApply && !suspended;
  const draft = latest?.status === 'DRAFT' ? latest : null;

  return (
    <Card id="application" data-testid="application">
      <CardHeader>
        <CardTitle className="text-base">درخواست درآمدزایی</CardTitle>
        <CardDescription>برای هر کانال در هر زمان فقط یک درخواست فعال می‌تواند وجود داشته باشد.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {latest && latest.status !== 'DRAFT' && (
          <div className="space-y-4" data-testid="application-status" data-status={latest.status}>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge variant={statusVariant[latest.status]} className="text-[13px]" data-testid="application-status-badge">
                {labels.monetization[latest.status]}
              </StatusBadge>
              <p className="text-sm">{statusDescription[latest.status]}</p>
            </div>

            {latest.status === 'APPROVED' && (
              <Alert variant="warning">
                <AlertTitle>تأیید به‌معنای پرداخت نیست</AlertTitle>
                <AlertDescription>{PAYMENT_NOT_CONNECTED}؛ تا آن زمان هیچ مبلغی ثبت یا پرداخت نمی‌شود.</AlertDescription>
              </Alert>
            )}
            {latest.status === 'SUSPENDED' && (
              <p className="text-sm">
                برای پیگیری می‌توانید{' '}
                <Link href="/help/tickets" className="font-medium text-primary underline-offset-4 hover:underline">
                  با پشتیبانی تماس بگیرید
                </Link>
                .
              </p>
            )}

            <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
              <ApplicationTimeline application={latest} />
              {latest.snapshot && (
                <div className="rounded-xl border p-4" data-testid="snapshot">
                  <h3 className="mb-3 text-sm font-semibold">آمار کانال هنگام ارسال</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">دنبال‌کنندگان</dt>
                    <dd className="tabular-nums">{f.number(latest.snapshot.followers)}</dd>
                    <dt className="text-muted-foreground">ساعت تماشا (۳۶۵ روز)</dt>
                    <dd className="tabular-nums">{f.number(latest.snapshot.watchHours, { maximumFractionDigits: 1 })}</dd>
                    <dt className="text-muted-foreground">ویدیوهای عمومی</dt>
                    <dd className="tabular-nums">{f.number(latest.snapshot.videoCount)}</dd>
                    <dt className="text-muted-foreground">کل بازدیدهای واقعی</dt>
                    <dd className="tabular-nums">{f.number(latest.snapshot.totalViews)}</dd>
                    {latest.contactEmail && (
                      <>
                        <dt className="text-muted-foreground">ایمیل تماس</dt>
                        <dd className="ltr-isolate">{latest.contactEmail}</dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
            </div>

            {actions.canWithdraw && <WithdrawButton />}
          </div>
        )}

        {latest?.status === 'REJECTED' && (
          <p className="text-sm text-muted-foreground">می‌توانید پس از رفع ایراد، درخواست تازه‌ای ثبت کنید؛ سابقه‌ی درخواست قبلی نگه داشته می‌شود.</p>
        )}

        {suspended && actions.canApply && (
          <Alert variant="destructive">
            <AlertTitle>امکان ثبت درخواست وجود ندارد</AlertTitle>
            <AlertDescription>کانال شما مسدود شده است.</AlertDescription>
          </Alert>
        )}

        {showForm && (
          <div className="space-y-4">
            {draft && <p className="text-sm text-muted-foreground">پیش‌نویس شما ذخیره شده است؛ می‌توانید آن را ویرایش یا (در صورت برقراری شرایط) ارسال کنید.</p>}
            <ApplicationForm
              key={draft?.id ?? 'new'}
              initial={{ contactEmail: draft?.contactEmail ?? defaultEmail, acceptTerms: draft?.acceptedTermsAt != null }}
              eligible={eligible}
            />
          </div>
        )}

        {older.length > 0 && (
          <details className="rounded-xl border px-4 py-3 text-sm" data-testid="application-history">
            <summary className="flex cursor-pointer items-center gap-2 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <History aria-hidden="true" className="size-4" /> درخواست‌های قبلی ({f.number(older.length)})
            </summary>
            <ul className="mt-3 space-y-3">
              {older.map((application) => (
                <li key={application.id} className="rounded-lg bg-muted/50 p-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <StatusBadge variant={statusVariant[application.status]}>{labels.monetization[application.status]}</StatusBadge>
                    <span className="text-[13px] text-muted-foreground" suppressHydrationWarning>
                      ثبت‌شده در {f.date(application.createdAt, 'long')}
                    </span>
                  </p>
                  {application.decisionNote && (
                    <p className="user-text mt-2 text-[13px] whitespace-pre-line" dir="auto">
                      {application.decisionNote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

      </CardContent>
    </Card>
  );
}
