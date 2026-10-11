import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" role="status" aria-label="در حال بارگذاری لیست پخش">
      <div className="flex flex-col gap-5 sm:flex-row" aria-hidden="true">
        <Skeleton className="aspect-video w-full rounded-2xl sm:w-80" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
      </div>
      <div className="space-y-3" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="aspect-video w-32 rounded-lg sm:w-44" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
