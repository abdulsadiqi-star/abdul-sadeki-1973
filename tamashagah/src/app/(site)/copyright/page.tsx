import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { Copyright, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { getCurrentUser } from '@/lib/auth/session';
import { getFormatter } from '@/lib/format-server';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { CopyrightForm } from '@/features/support/components/copyright-form';

export const metadata: Metadata = {
  title: 'حق تکثیر و شکایت',
  description: 'اثرتان بدون اجازه در تماشاگاه منتشر شده؟ شکایت حق تکثیر ثبت کنید و بدانید پس از آن چه می‌شود.',
  alternates: { canonical: '/copyright' },
};

const steps = [
  { title: 'ثبت شکایت', text: 'فرم پایین را کامل می‌کنید. شکایت شما هم به‌صورت یک تیکت قابل پیگیری ثبت می‌شود و هم در صف گزارش‌های ناظران قرار می‌گیرد.' },
  { title: 'بررسی', text: 'ناظران ویدیو و اطلاعات شکایت را می‌خوانند. اگر نقض روشن باشد، ویدیو پنهان یا حذف می‌شود؛ در غیر این صورت ممکن است توضیح بیشتری از شما بخواهیم.' },
  { title: 'نتیجه', text: 'نتیجه‌ی بررسی را در همان تیکت می‌نویسیم. می‌توانید هر زمان در تیکت پیام بدهید.' },
  { title: 'اعتراض', text: 'اگر ویدیوی شما به‌خاطر شکایت حذف شد و معتقدید مجوز دارید، با یک تیکت «حق تکثیر» اعتراض خود را همراه با مدرک بفرستید.' },
];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CopyrightPage({ searchParams }: Props) {
  const [user, f] = await Promise.all([getCurrentUser(), getFormatter()]);
  const sp = await searchParams;
  const video = Array.isArray(sp.video) ? sp.video[0] : sp.video;
  const defaultVideo = video && VIDEO_ID_REGEX.test(video) ? video : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="حق تکثیر و شکایت"
        description="تماشاگاه به حقوق صاحبان آثار احترام می‌گذارد. اگر اثر شما بدون اجازه منتشر شده، از اینجا شکایت کنید."
      />

      <Alert variant="warning" role="note">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>توضیح فرایند، نه مشاوره‌ی حقوقی</AlertTitle>
        <AlertDescription className="text-foreground">
          این صفحه فرایند رسیدگی در تماشاگاه را توضیح می‌دهد و جایگزین مشاوره‌ی حقوقی نیست. اپراتور سرویس باید آن را مانند شرایط استفاده و سیاست حریم خصوصی با مشاور حقوقی بازبینی کند.
        </AlertDescription>
      </Alert>

      <section aria-labelledby="c-how" className="space-y-3">
        <h2 id="c-how" className="text-lg font-bold">
          پس از شکایت چه می‌شود؟
        </h2>
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                {f.number(index + 1)}
              </span>
              <div className="min-w-0 leading-8">
                <span className="font-semibold">{step.title}: </span>
                {step.text}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          برای اعتراض می‌توانید{' '}
          <Link
            href={`/help/tickets?${new URLSearchParams({ category: 'COPYRIGHT', subject: 'اعتراض به حذف ویدیو' })}` as Route}
            className="text-primary underline-offset-4 hover:underline"
          >
            تیکت اعتراض
          </Link>{' '}
          ثبت کنید. ثبت شکایت یا اعتراض خلاف واقع تخلف است.
        </p>
      </section>

      <section aria-labelledby="c-form">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="c-form" className="flex items-center gap-2 text-lg">
                <Copyright aria-hidden="true" className="size-5 text-primary" />
                ثبت شکایت حق تکثیر
              </h2>
            </CardTitle>
            <CardDescription>همه‌ی فیلدها، جز نشانی اثر اصلی، لازم است. برای شکایت از ویدیوی کانال خودتان نمی‌توانید استفاده کنید.</CardDescription>
          </CardHeader>
          <CardContent>
            {user ? (
              <CopyrightForm defaultEmail={user.email} defaultVideo={defaultVideo} />
            ) : (
              <div className="space-y-3">
                <p className="leading-8">برای ثبت شکایت باید وارد حساب خود شوید تا بتوانید آن را پیگیری کنید.</p>
                <Button asChild>
                  <Link href={`/login?next=${encodeURIComponent(defaultVideo ? `/copyright?video=${defaultVideo}` : '/copyright')}` as Route}>ورود به حساب</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
