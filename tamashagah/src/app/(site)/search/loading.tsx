import { Skeleton } from '@/components/ui/skeleton';

/** Matches the layout of the results list: title, type chips, filter row and a few result rows. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-5" role="status" aria-label="در حال جستجو">
      <Skeleton className="h-8 w-64" />
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-20 rounded-full" />
        ))}
      </div>
      <div className="flex gap-3" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-32" />
        ))}
      </div>
      <div className="space-y-5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3 sm:gap-4">
            <Skeleton className="aspect-video w-40 shrink-0 rounded-xl sm:w-72" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="hidden h-4 w-3/4 sm:block" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
