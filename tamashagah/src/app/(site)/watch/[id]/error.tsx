'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/error-state';

/** Error boundary of the watch page (the site frame around it stays usable). */
export default function WatchError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-xl flex-col items-center justify-center gap-4 py-8">
      <ErrorState
        title="نمایش این ویدیو با مشکل روبه‌رو شد"
        description={error.digest ? `لطفاً دوباره تلاش کنید. (کد پیگیری: ${error.digest})` : 'لطفاً دوباره تلاش کنید.'}
        onRetry={reset}
        className="w-full"
      />
      <Button asChild variant="link">
        <Link href="/">بازگشت به صفحه‌ی اصلی</Link>
      </Button>
    </div>
  );
}
