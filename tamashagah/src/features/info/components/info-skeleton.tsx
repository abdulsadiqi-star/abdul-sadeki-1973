import { Skeleton } from '@/components/ui/skeleton';

/** Loading placeholder shared by the information and support pages: a title block, a few text lines and two cards. */
export function InfoSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="در حال بارگذاری" className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-9/12" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    </div>
  );
}
