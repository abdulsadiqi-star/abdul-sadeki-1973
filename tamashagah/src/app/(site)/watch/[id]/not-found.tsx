import Link from 'next/link';
import { Home, Search, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'ویدیو پیدا نشد', robots: { index: false, follow: false } };

/**
 * Shown (with HTTP 404) for every video the viewer may not see — private, draft, scheduled, taken down,
 * unfinished or simply unknown. The wording is identical for all of them so nothing about hidden videos leaks.
 */
export default function VideoNotFound() {
  return (
    <div className="mx-auto flex min-h-[55dvh] max-w-lg flex-col items-center justify-center gap-5 py-10 text-center">
      <span className="flex size-20 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <VideoOff aria-hidden="true" className="size-10" />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold">این ویدیو پیدا نشد</h1>
        <p className="text-muted-foreground">ممکن است نشانی را اشتباه وارد کرده باشید یا ویدیو حذف شده، خصوصی شده یا هنوز منتشر نشده باشد.</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild shape="pill">
          <Link href="/">
            <Home /> بازگشت به خانه
          </Link>
        </Button>
        <Button asChild shape="pill" variant="outline">
          <Link href="/search">
            <Search /> جستجوی ویدیو
          </Link>
        </Button>
      </div>
    </div>
  );
}
