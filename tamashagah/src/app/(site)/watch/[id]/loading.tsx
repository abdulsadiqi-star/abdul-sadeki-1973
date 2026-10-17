import { Skeleton } from '@/components/ui/skeleton';
import { RelatedVideosSkeleton } from '@/features/watch/components/related-videos';

/** Skeleton shown while the watch page streams in (same grid as the page, so nothing jumps). */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[100rem]" role="status" aria-label="در حال بارگذاری ویدیو">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
          <div className="-mx-3 aspect-video bg-black sm:-mx-6 lg:mx-0 lg:rounded-xl" aria-hidden="true">
            <Skeleton className="size-full rounded-none bg-neutral-800 lg:rounded-xl" />
          </div>
          <Skeleton className="h-7 w-4/5" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="ms-auto h-10 w-28 rounded-full" />
          </div>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-28 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <div className="min-w-0">
          <RelatedVideosSkeleton />
        </div>
      </div>
    </div>
  );
}
