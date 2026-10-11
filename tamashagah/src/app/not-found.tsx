import Link from 'next/link';
import { Compass, Home, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export const metadata = { title: 'صفحه پیدا نشد' };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-(--header-height) items-center justify-between border-b px-4">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main-content" className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <div className="relative">
          <span aria-hidden="true" className="bg-brand-gradient bg-clip-text text-[8rem] leading-none font-black text-transparent sm:text-[11rem]">
            ۴۰۴
          </span>
          <Compass aria-hidden="true" className="absolute -end-2 -top-2 size-10 text-primary/60 sm:size-14" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold">صفحه‌ای که دنبالش بودید پیدا نشد</h1>
          <p className="mx-auto max-w-md text-muted-foreground">
            ممکن است نشانی را اشتباه وارد کرده باشید یا ویدیو حذف یا خصوصی شده باشد.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" shape="pill">
            <Link href="/">
              <Home /> بازگشت به خانه
            </Link>
          </Button>
          <Button asChild size="lg" shape="pill" variant="outline">
            <Link href="/search">
              <Search /> جستجوی ویدیو
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
