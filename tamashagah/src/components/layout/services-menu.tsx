'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Clapperboard, Grid3x3, Info, LifeBuoy, Smartphone, ShieldCheck, Video, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const services: { href: Route; label: string; description: string; icon: LucideIcon; tone: string }[] = [
  { href: '/', label: 'ویدیوها', description: 'تماشای ویدیوهای تازه', icon: Video, tone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  { href: '/shorts', label: 'شورتس', description: 'ویدیوهای کوتاه عمودی', icon: Zap, tone: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300' },
  { href: '/studio', label: 'استودیوی سازندگان', description: 'مدیریت کانال و آمار', icon: Clapperboard, tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { href: '/studio/monetization', label: 'درآمدزایی', description: 'شرایط و وضعیت درخواست', icon: Wallet, tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  { href: '/verification', label: 'تیک تأیید کانال', description: 'درخواست کانال تأییدشده', icon: ShieldCheck, tone: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
  { href: '/apps', label: 'اپلیکیشن‌ها', description: 'نسخه‌های موبایل و تلویزیون', icon: Smartphone, tone: 'bg-amber-500/20 text-amber-800 dark:text-amber-300' },
  { href: '/help', label: 'راهنما', description: 'پرسش‌های متداول و تیکت', icon: LifeBuoy, tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  { href: '/about', label: 'درباره‌ی ما', description: 'ماجرای تماشاگاه', icon: Info, tone: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
];

/** The "grid" menu from the header: quick access to every area of the platform. */
export function ServicesMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" shape="pill" aria-label="سرویس‌ها و بخش‌های سایت" className="hidden sm:inline-flex">
          <Grid3x3 className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,26rem)] p-3">
        <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">بخش‌های تماشاگاه</p>
        <ul className="grid grid-cols-2 gap-1.5">
          {services.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="flex items-center gap-3 rounded-xl p-2.5 transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${s.tone}`}>
                  <s.icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{s.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
