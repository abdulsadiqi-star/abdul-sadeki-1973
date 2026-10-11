'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl py-10">
      <ErrorState
        title="تنظیمات بارگذاری نشد"
        description={error.digest ? `لطفاً دوباره تلاش کنید. (کد پیگیری: ${error.digest})` : 'لطفاً دوباره تلاش کنید.'}
        onRetry={reset}
      />
    </div>
  );
}
