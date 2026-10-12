import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { Copyright, LifeBuoy, ShieldCheck, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { env } from '@/lib/env';
import { getFormatter } from '@/lib/format-server';
import { SHORTS_MAX_SECONDS, monetizationRequirements } from '@/config/site';
import { JsonLd } from '@/features/discovery/components/json-ld';
import { FaqBrowser } from '@/features/info/components/faq-browser';
import { buildFaq } from '@/features/info/faq';

export const metadata: Metadata = {
  title: 'مرکز راهنما',
  description: 'پاسخ پرسش‌های پرتکرار درباره‌ی حساب کاربری، بارگذاری ویدیو، حریم خصوصی، دیدگاه‌ها، درآمدزایی و حق تکثیر در تماشاگاه.',
  alternates: { canonical: '/help' },
};

const shortcuts = [
  { href: '/help/tickets', title: 'تیکت پشتیبانی', hint: 'مشکل خود را برای ما بنویسید', icon: LifeBuoy },
  { href: '/copyright', title: 'شکایت حق تکثیر', hint: 'اثرتان بدون اجازه منتشر شده؟', icon: Copyright },
  { href: '/verification', title: 'تیک تأیید', hint: 'شرایط و درخواست تیک تأیید', icon: ShieldCheck },
  { href: '/apps', title: 'نصب برنامه', hint: 'تماشاگاه روی گوشی و رایانه', icon: Smartphone },
] as const;

export default async function HelpPage() {
  const f = await getFormatter();
  const topics = buildFaq({
    f,
    maxUploadBytes: env.UPLOAD_MAX_BYTES,
    dailyQuotaBytes: env.UPLOAD_DAILY_QUOTA_BYTES,
    maxUploadsPerDay: env.UPLOAD_MAX_PER_DAY,
    shortsMaxSeconds: SHORTS_MAX_SECONDS,
    monetization: monetizationRequirements,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: topics.flatMap((topic) =>
            topic.items.map((item) => ({
              '@type': 'Question',
              name: item.q,
              acceptedAnswer: { '@type': 'Answer', text: item.a.join('\n') },
            })),
          ),
        }}
      />
      <PageHeader title="مرکز راهنما" description="پاسخ پرسش‌های پرتکرار را اینجا جستجو کنید؛ اگر پیدا نکردید، یک تیکت برای ما بفرستید." />

      <FaqBrowser topics={topics} />

      <section aria-labelledby="help-more" className="space-y-3">
        <h2 id="help-more" className="text-lg font-bold">
          هنوز کمک می‌خواهید؟
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map(({ href, title, hint, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href as Route}
                className="flex h-full items-center gap-3 rounded-xl border bg-card p-4 transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-[13px] text-muted-foreground">{hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
