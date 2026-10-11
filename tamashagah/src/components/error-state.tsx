'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Error state with an optional retry (works with TanStack Query `refetch` and Next error boundaries). */
export function ErrorState({
  title = 'مشکلی پیش آمد',
  description = 'بارگذاری اطلاعات با خطا روبه‌رو شد. لطفاً دوباره تلاش کنید.',
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center', className)}>
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden="true" className="size-7" />
      </span>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-2">
          تلاش دوباره
        </Button>
      )}
    </div>
  );
}
