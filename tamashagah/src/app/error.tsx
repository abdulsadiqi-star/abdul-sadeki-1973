'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/error-state';

/** Route-level error boundary (inside the root layout, so the theme/fonts still apply). */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center gap-4 p-6">
      <ErrorState
        title="مشکلی در نمایش این صفحه پیش آمد"
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
