import { Skeleton } from '@/components/ui/skeleton';

/** Skeleton while the monetization data loads. */
export default function MonetizationLoading() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">در حال بارگذاری…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
