import Link from 'next/link';
import { Clapperboard, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Friendly call to action for a channel that has not uploaded anything yet. */
export function FirstUploadCard({ channelName }: { channelName: string }) {
  return (
    <section
      aria-labelledby="first-upload-title"
      data-testid="first-upload"
      className="flex flex-col items-center gap-4 rounded-2xl border border-primary/25 bg-accent/40 px-6 py-10 text-center"
    >
      <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-md">
        <Clapperboard className="size-8" />
      </span>
      <div className="space-y-1.5">
        <h2 id="first-upload-title" className="text-xl font-extrabold">
          اولین ویدیوی «{channelName}» را بارگذاری کنید
        </h2>
        <p className="mx-auto max-w-lg text-sm text-muted-foreground">
          کانال شما آماده است. بعد از بارگذاری و انتشار اولین ویدیو، بازدیدها، دیدگاه‌ها و رشد دنبال‌کنندگان اینجا نمایش داده می‌شود.
        </p>
      </div>
      <Button asChild size="lg" shape="pill">
        <Link href="/studio/upload">
          <Upload /> بارگذاری اولین ویدیو
        </Link>
      </Button>
    </section>
  );
}
