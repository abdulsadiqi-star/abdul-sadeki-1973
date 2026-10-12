import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { Eye, Info, Languages, ListVideo, Lock, Radar, Users, Video, Zap } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LogoMark } from '@/components/logo';
import { StatCard } from '@/components/stat-card';
import { siteConfig } from '@/config/site';
import { getFormatter } from '@/lib/format-server';
import { getAboutStats } from '@/features/info/stats';

export const metadata: Metadata = {
  title: 'درباره‌ی تماشاگاه',
  description: 'تماشاگاه یک پلتفرم فارسی اشتراک‌گذاری ویدیو است: دیدن، ساختن و گفت‌وگو، با پیشنهادهای شفاف و حریم خصوصی محترم.',
  alternates: { canonical: '/about' },
};

const principles = [
  { icon: Languages, title: 'فارسی از ریشه', text: 'راست‌به‌چپ، تقویم شمسی، ارقام فارسی یا انگلیسی به انتخاب شما و جستجویی که ی و ک عربی، نیم‌فاصله و غلط‌های تایپی را می‌فهمد.' },
  { icon: Radar, title: 'پیشنهادهای شفاف', text: 'پیشنهاد و پرطرفدارها با چند قاعده‌ی ساده و مشخص ساخته می‌شود؛ یادگیری ماشین یا ردیابی پنهان در کار نیست و دلیل هر پیشنهاد قابل توضیح است.' },
  { icon: Lock, title: 'حریم خصوصی پیش‌فرض', text: 'تاریخچه‌ی تماشا فقط برای خود شماست، ویدیوهای «فقط با لینک» و «خصوصی» هیچ‌جا فهرست نمی‌شوند و اطلاعات شما فروخته نمی‌شود.' },
  { icon: Users, title: 'ابزار واقعی برای سازندگان', text: 'استودیو با بارگذاری ادامه‌پذیر، پردازش به چند کیفیت، آمار بازدید، مدیریت دیدگاه و زمان‌بندی انتشار.' },
];

export default async function AboutPage() {
  const [f, stats] = await Promise.all([getFormatter(), getAboutStats()]);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <LogoMark className="size-16 rounded-2xl" />
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">درباره‌ی {siteConfig.name}</h1>
          <p className="mt-1 text-muted-foreground">{siteConfig.tagline}</p>
        </div>
      </header>

      <section aria-labelledby="about-what" className="space-y-3 leading-8">
        <h2 id="about-what" className="text-lg font-bold">
          تماشاگاه چیست؟
        </h2>
        <p>
          تماشاگاه یک پلتفرم فارسی برای دیدن و ساختن ویدیوست. می‌توانید ویدیوهای بلند و شورتس ببینید، کانال‌ها را دنبال کنید، لیست پخش بسازید و ادامه‌ی تماشا را از هر دستگاه ادامه دهید؛ و اگر سازنده‌اید، کانال خودتان را بسازید، ویدیو بارگذاری کنید و واکنش مخاطبانتان را ببینید.
        </p>
        <p>هدف ما سرویسی است که برای کاربر فارسی‌زبان طبیعی باشد، قواعدش روشن باشد و آنچه می‌گوید همان باشد که انجام می‌دهد.</p>
      </section>

      <section aria-labelledby="about-numbers" className="space-y-3">
        <h2 id="about-numbers" className="text-lg font-bold">
          تماشاگاه در یک نگاه
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="ویدیو" value={f.number(stats.videos)} icon={Video} />
          <StatCard label="شورتس" value={f.number(stats.shorts)} icon={Zap} />
          <StatCard label="کانال فعال" value={f.number(stats.channels)} icon={ListVideo} />
          <StatCard label="بازدید" value={f.compact(stats.totalViews)} icon={Eye} />
        </div>
        <p className="text-[13px] text-muted-foreground">این اعداد همین حالا از پایگاه داده شمرده می‌شود و فقط ویدیوهای عمومی را در بر می‌گیرد.</p>
        {stats.hasDemoData && (
          <Alert variant="info" role="note">
            <Info aria-hidden="true" />
            <AlertDescription className="text-foreground">
              این نسخه شامل داده‌ی نمایشی است: بخشی از بازدیدها، پسندها و کانال‌ها برای آزمایش سرویس به‌صورت مصنوعی ساخته شده‌اند و بازدید واقعی کاربران نیستند.
            </AlertDescription>
          </Alert>
        )}
      </section>

      <section aria-labelledby="about-principles" className="space-y-3">
        <h2 id="about-principles" className="text-lg font-bold">
          اصول ما
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {principles.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3 rounded-2xl border bg-card p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-7 text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-more" className="space-y-3">
        <h2 id="about-more" className="text-lg font-bold">
          بیشتر بدانید
        </h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['/help', 'مرکز راهنما'],
              ['/apps', 'نصب برنامه'],
              ['/terms', 'شرایط استفاده'],
              ['/privacy', 'حریم خصوصی'],
              ['/copyright', 'حق تکثیر'],
              ['/verification', 'تیک تأیید'],
            ] as const
          ).map(([href, label]) => (
            <Button key={href} asChild variant="outline" shape="pill" size="sm">
              <Link href={href as Route}>{label}</Link>
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          ارتباط با ما: از بخش <Link href="/help/tickets" className="text-primary underline-offset-4 hover:underline">پشتیبانی</Link> تیکت ثبت کنید یا به{' '}
          <a href={`mailto:${siteConfig.supportEmail}`} dir="ltr" className="text-primary underline-offset-4 hover:underline">
            {siteConfig.supportEmail}
          </a>{' '}
          نامه بنویسید.
        </p>
      </section>
    </div>
  );
}
