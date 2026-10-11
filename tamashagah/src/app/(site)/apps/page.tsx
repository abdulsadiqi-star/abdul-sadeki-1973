import type { Metadata } from 'next';
import { Clock, Download, MonitorSmartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { InstallApp } from '@/features/info/components/install-app';
import { ServiceWorkerRegister } from '@/features/info/components/service-worker-register';

export const metadata: Metadata = {
  title: 'برنامه‌ها و نصب',
  description: 'تماشاگاه را روی گوشی یا رایانه نصب کنید: یک برنامه‌ی وب نصب‌پذیر (PWA) با آیکون، پنجره‌ی جداگانه و میان‌برها.',
  alternates: { canonical: '/apps' },
};

const features = [
  'اجرا در پنجره‌ی جداگانه، بدون نوار نشانی مرورگر',
  'آیکون روی صفحه‌ی اصلی گوشی یا در منوی برنامه‌های رایانه',
  'میان‌برهای شورتس، کتابخانه و جستجو (با نگه‌داشتن آیکون برنامه)',
  'صفحه‌ی «اتصال برقرار نیست» به‌جای خطای مرورگر وقتی اینترنت قطع است',
  'به‌روزرسانی خودکار؛ همیشه آخرین نسخه‌ی سایت را دارید',
];

const planned = [
  { title: 'برنامه‌ی اندروید', hint: 'نسخه‌ی بومی برای گوشی‌ها و تبلت‌های اندروید' },
  { title: 'برنامه‌ی iOS', hint: 'نسخه‌ی بومی برای آیفون و آیپد' },
  { title: 'برنامه‌ی تلویزیون', hint: 'پخش روی تلویزیون‌های هوشمند' },
];

export default function AppsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <ServiceWorkerRegister />
      <PageHeader
        title="برنامه‌ها و نصب"
        description="تماشاگاه یک برنامه‌ی وب نصب‌پذیر است؛ بدون فروشگاه و بدون دانلود جداگانه، مثل یک برنامه روی دستگاه شما می‌نشیند."
        className="mb-0"
      />

      <section aria-labelledby="apps-install" className="space-y-4">
        <h2 id="apps-install" className="flex items-center gap-2 text-lg font-bold">
          <Download aria-hidden="true" className="size-5 text-primary" />
          نصب روی دستگاه شما
        </h2>
        <InstallApp />
      </section>

      <section aria-labelledby="apps-features" className="space-y-3">
        <h2 id="apps-features" className="flex items-center gap-2 text-lg font-bold">
          <MonitorSmartphone aria-hidden="true" className="size-5 text-primary" />
          با نصب چه به دست می‌آورید؟
        </h2>
        <ul className="list-disc space-y-1.5 ps-6 leading-8 marker:text-muted-foreground">
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">پخش آفلاین و بارگیری ویدیو هنوز پشتیبانی نمی‌شود؛ برای تماشا به اینترنت نیاز دارید.</p>
      </section>

      <section aria-labelledby="apps-planned" className="space-y-3">
        <h2 id="apps-planned" className="flex items-center gap-2 text-lg font-bold">
          <Clock aria-hidden="true" className="size-5 text-primary" />
          برنامه‌های بومی
        </h2>
        <p className="text-sm text-muted-foreground">این نسخه‌ها هنوز ساخته نشده‌اند و تاریخ انتشاری برایشان اعلام نشده است؛ فعلاً دانلودی وجود ندارد.</p>
        <ul className="grid gap-3 sm:grid-cols-3">
          {planned.map((item) => (
            <li key={item.title} className="rounded-xl border border-dashed bg-card p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold">{item.title}</span>
                <Badge variant="muted">به‌زودی</Badge>
              </div>
              <p className="text-[13px] leading-6 text-muted-foreground">{item.hint}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
