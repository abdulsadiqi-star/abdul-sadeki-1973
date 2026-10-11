'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';

/** Error boundary of the admin area: the shell stays, only the page content is replaced. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('admin page error', error.digest ?? error.message);
  }, [error]);
  return (
    <ErrorState
      title="بارگذاری این بخش با خطا روبه‌رو شد"
      description={`مشکلی در خواندن اطلاعات پیش آمد${error.digest ? ` (کد پیگیری: ${error.digest})` : ''}. دوباره تلاش کنید؛ اگر ادامه داشت، به تیم فنی اطلاع دهید.`}
      onRetry={reset}
    />
  );
}
