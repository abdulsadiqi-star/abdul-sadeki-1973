'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/error-state';

/** Error boundary of the home page only: the site shell (header, sidebar) stays usable. */
export default function HomeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-10">
      <ErrorState
        title="بارگذاری صفحه‌ی اصلی با مشکل روبه‌رو شد"
        description={error.digest ? `لطفاً دوباره تلاش کنید. (کد پیگیری: ${error.digest})` : 'لطفاً دوباره تلاش کنید.'}
        onRetry={reset}
        className="w-full"
      />
      <Button asChild variant="link">
        <Link href="/search">جستجوی ویدیو</Link>
      </Button>
    </div>
  );
}
