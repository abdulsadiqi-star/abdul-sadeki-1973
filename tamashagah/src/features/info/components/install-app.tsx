'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { CircleCheck, Download, Monitor, Smartphone, Tablet } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type Platform = 'ios' | 'android' | 'desktop' | 'unknown';

const noSubscription = () => () => undefined;

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia('(display-mode: standalone)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const guides: { platform: Exclude<Platform, 'unknown'>; title: string; icon: typeof Smartphone; steps: string[] }[] = [
  {
    platform: 'android',
    title: 'اندروید (کروم)',
    icon: Smartphone,
    steps: ['منوی سه‌نقطه‌ی مرورگر را باز کنید.', 'گزینه‌ی «نصب برنامه» یا «افزودن به صفحه‌ی اصلی» را بزنید.', 'نصب را تأیید کنید؛ آیکون تماشاگاه در فهرست برنامه‌ها اضافه می‌شود.'],
  },
  {
    platform: 'ios',
    title: 'آیفون و آیپد (سافاری)',
    icon: Tablet,
    steps: ['در سافاری دکمه‌ی اشتراک‌گذاری (مربع با پیکان رو به بالا) را بزنید.', 'گزینه‌ی «Add to Home Screen» (افزودن به صفحه‌ی خانه) را انتخاب کنید.', 'روی «Add» بزنید؛ تماشاگاه مثل یک برنامه روی صفحه‌ی خانه می‌نشیند.'],
  },
  {
    platform: 'desktop',
    title: 'رایانه (کروم و اج)',
    icon: Monitor,
    steps: ['در نوار نشانی، آیکون «نصب» را بزنید (یا از منوی مرورگر «نصب تماشاگاه» را انتخاب کنید).', 'در پنجره‌ی باز‌شده «Install» را بزنید.', 'تماشاگاه در یک پنجره‌ی جداگانه و با میان‌بر در منوی برنامه‌ها باز می‌شود.'],
  },
];

/**
 * "Install the app" panel: a real install button when the browser offers the PWA install prompt (`beforeinstallprompt`),
 * the manual steps for Android / iOS / desktop otherwise, and a note when the app is already running installed.
 */
export function InstallApp() {
  const platform = useSyncExternalStore(noSubscription, detectPlatform, (): Platform => 'unknown');
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') toast.success('تماشاگاه نصب شد.');
    } finally {
      setPrompt(null);
      setInstalling(false);
    }
  }

  return (
    <div className="space-y-6">
      {standalone ? (
        <Alert variant="success" role="status">
          <CircleCheck aria-hidden="true" />
          <AlertTitle>شما هم‌اکنون در برنامه‌ی نصب‌شده هستید</AlertTitle>
          <AlertDescription>نیازی به نصب دوباره نیست. برنامه خودکار به‌روز می‌شود.</AlertDescription>
        </Alert>
      ) : prompt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
          <p className="min-w-0 flex-1 leading-7">مرورگر شما نصب تماشاگاه را پشتیبانی می‌کند؛ با یک کلیک به صفحه‌ی اصلی یا منوی برنامه‌هایتان اضافه می‌شود.</p>
          <Button onClick={install} disabled={installing} size="lg" shape="pill">
            <Download aria-hidden="true" />
            نصب برنامه
          </Button>
        </div>
      ) : (
        <p className="rounded-2xl border bg-card p-4 leading-7 text-muted-foreground">
          مرورگر شما فعلاً دکمه‌ی نصب خودکار نشان نمی‌دهد (ممکن است نصب شده باشد یا مرورگر از آن پشتیبانی نکند). مراحل دستی زیر را دنبال کنید.
        </p>
      )}

      <ul className="grid gap-4 lg:grid-cols-3">
        {guides.map(({ platform: id, title, icon: Icon, steps }) => (
          <li key={id} className={cn('rounded-2xl border bg-card p-4', platform === id && 'border-primary ring-1 ring-primary/40')}>
            <h3 className="mb-3 flex items-center gap-2 font-bold">
              <Icon aria-hidden="true" className="size-5 text-primary" />
              {title}
              {platform === id && <Badge variant="info">دستگاه شما</Badge>}
            </h3>
            <ol className="list-decimal space-y-2 ps-5 text-sm leading-7 marker:text-muted-foreground">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}
