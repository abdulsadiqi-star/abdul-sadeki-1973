'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';

/** Error boundary body shared by the studio video routes (rendered inside the studio shell, so the sidebar stays). */
export function StudioRouteError({ error, reset, what }: { error: Error & { digest?: string }; reset: () => void; what: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={`${what} باز نشد`}
      description={error.digest ? `لطفاً دوباره تلاش کنید. (کد پیگیری: ${error.digest})` : 'لطفاً دوباره تلاش کنید.'}
      onRetry={reset}
      className="mx-auto mt-6 max-w-xl"
    />
  );
}
