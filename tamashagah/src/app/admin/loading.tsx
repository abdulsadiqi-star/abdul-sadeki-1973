import { Skeleton } from '@/components/ui/skeleton';

/** Generic skeleton for every admin page: title, filter bar and a few result rows. */
export default function AdminLoading() {
  return (
    <div role="status" aria-label="در حال بارگذاری" aria-busy="true">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="mb-4 h-20 w-full rounded-xl" />
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="aspect-video w-24 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
            <Skeleton className="hidden h-9 w-20 rounded-lg sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
