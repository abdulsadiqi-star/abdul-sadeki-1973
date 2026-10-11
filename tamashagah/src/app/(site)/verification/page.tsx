import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { BadgeCheck, CircleAlert, Hourglass, ShieldCheck, XCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { VerifiedBadge } from '@/components/verified-badge';
import { getCurrentUser } from '@/lib/auth/session';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { VerificationForm } from '@/features/support/components/verification-form';
import { VerificationRequirements } from '@/features/support/components/verification-requirements';
import { getVerificationOverview } from '@/features/support/queries';

export const metadata: Metadata = {
  title: 'تیک تأیید کانال',
  description: 'تیک تأیید یعنی چه، چه شرایطی دارد و چطور برای کانال خود درخواست دهید.',
  alternates: { canonical: '/verification' },
};

const meaning = [
  'هویت و اصالت کانال بررسی شده و کانال، نمونه‌ی جعلی یا تقلبی نیست.',
  'تیک تأیید تأییدکننده‌ی محتوا یا نظرات صاحب کانال نیست و امتیاز ویژه‌ای در جستجو یا پیشنهادها نمی‌دهد.',
  'ارتباطی با درآمدزایی ندارد؛ درآمدزایی درخواست جداگانه‌ای در استودیو دارد.',
  'در صورت نقض قوانین یا از دست رفتن شرایط، ممکن است تیک برداشته شود.',
];

export default async function VerificationPage() {
  const user = await getCurrentUser();
  const [f, overview] = await Promise.all([
    getFormatter(),
    user?.channel ? getVerificationOverview({ channelId: user.channel.id, emailVerified: user.emailVerified }) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="تیک تأیید کانال"
        description="نشانی از اینکه هویت کانال بررسی شده است."
        className="mb-0"
        actions={<VerifiedBadge className="size-8" />}
      />

      <section aria-labelledby="v-meaning" className="space-y-3">
        <h2 id="v-meaning" className="text-lg font-bold">
          تیک تأیید یعنی چه؟
        </h2>
        <ul className="list-disc space-y-1.5 ps-6 leading-8 marker:text-muted-foreground">
          {meaning.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="v-requirements" className="space-y-3">
        <h2 id="v-requirements" className="text-lg font-bold">
          شرایط درخواست
        </h2>
        <p className="text-sm text-muted-foreground">
          این شرایط از اطلاعات واقعی کانال شما محاسبه می‌شود. برآورده‌کردن آن‌ها شرط لازم است، نه کافی؛ تیم ما هویت و اصالت کانال را هم دستی بررسی می‌کند.
        </p>
        <div className="rounded-2xl border bg-card p-4">
          <VerificationRequirements states={overview?.requirements.items} />
        </div>
      </section>

      <section aria-labelledby="v-request" className="space-y-4">
        <h2 id="v-request" className="text-lg font-bold">
          درخواست شما
        </h2>

        {!user ? (
          <Alert variant="info" role="note">
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>ابتدا وارد شوید</AlertTitle>
            <AlertDescription>
              <p>برای ثبت درخواست باید وارد حساب خود شوید و کانال داشته باشید.</p>
              <Button asChild size="sm" className="mt-2">
                <Link href={'/login?next=/verification' as Route}>ورود به حساب</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : !user.channel || !overview ? (
          <Alert variant="info" role="note">
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>هنوز کانالی ندارید</AlertTitle>
            <AlertDescription>
              <p>تیک تأیید برای کانال‌هاست. ابتدا کانال خود را بسازید و ویدیوهایتان را منتشر کنید.</p>
              <Button asChild size="sm" className="mt-2">
                <Link href="/studio">ساخت کانال</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : overview.channel.isVerified ? (
          <Alert variant="success" role="note">
            <BadgeCheck aria-hidden="true" />
            <AlertTitle>کانال شما تیک تأیید دارد</AlertTitle>
            <AlertDescription>
              <p>
                کانال «<span dir="auto">{overview.channel.name}</span>» تأیید شده است. نیازی به درخواست دوباره نیست.
              </p>
            </AlertDescription>
          </Alert>
        ) : overview.channel.suspended ? (
          <Alert variant="destructive" role="note">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>کانال شما تعلیق است</AlertTitle>
            <AlertDescription>تا زمانی که کانال تعلیق است نمی‌توانید درخواست تیک تأیید بدهید. برای پیگیری، تیکت پشتیبانی ثبت کنید.</AlertDescription>
          </Alert>
        ) : overview.open ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Hourglass aria-hidden="true" className="size-5 text-primary" />
                درخواست شما در حال بررسی است
                <Badge variant="info">{labels.verification[overview.open.status as 'SUBMITTED' | 'UNDER_REVIEW']}</Badge>
              </CardTitle>
              <CardDescription suppressHydrationWarning>ثبت‌شده در {f.dateTime(overview.open.createdAt, 'long')}. نتیجه پس از بررسی در همین صفحه نمایش داده می‌شود.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-1 text-[13px] font-semibold text-muted-foreground">توضیحی که نوشته‌اید</p>
              <p dir="auto" className="user-text leading-8 whitespace-pre-wrap">
                {overview.open.message}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {overview.lastDecided?.status === 'REJECTED' && (
              <Alert variant="destructive" role="note">
                <XCircle aria-hidden="true" />
                <AlertTitle>درخواست قبلی شما پذیرفته نشد</AlertTitle>
                <AlertDescription>
                  {overview.lastDecided.decisionNote ? (
                    <p dir="auto" className="user-text whitespace-pre-wrap text-foreground">
                      {overview.lastDecided.decisionNote}
                    </p>
                  ) : (
                    <p>دلیل خاصی ثبت نشده است.</p>
                  )}
                  <p>پس از رفع مشکل می‌توانید دوباره درخواست دهید.</p>
                </AlertDescription>
              </Alert>
            )}
            {!user.emailVerified ? (
              <Alert variant="warning" role="note">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>ایمیل شما هنوز تأیید نشده است</AlertTitle>
                <AlertDescription>از نوار بالای صفحه ایمیل تأیید را دوباره بفرستید و پیوند داخل آن را باز کنید.</AlertDescription>
              </Alert>
            ) : !overview.requirements.allMet ? (
              <Alert variant="info" role="note">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>هنوز همه‌ی شرایط را ندارید</AlertTitle>
                <AlertDescription>پس از برآورده‌شدن همه‌ی شرایط بالا می‌توانید همین‌جا درخواست خود را ثبت کنید.</AlertDescription>
              </Alert>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>ثبت درخواست تیک تأیید</CardTitle>
                  <CardDescription>برای هر کانال در هر زمان فقط یک درخواست باز می‌تواند وجود داشته باشد.</CardDescription>
                </CardHeader>
                <CardContent>
                  <VerificationForm />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </section>
    </div>
  );
}
