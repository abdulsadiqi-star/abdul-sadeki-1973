import { Skeleton } from '@/components/ui/skeleton';
import { VideoGridSkeleton } from '@/components/video/video-grid';

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6" role="status" aria-label="در حال بارگذاری کانال">
      <div aria-hidden="true">
        <Skeleton className="h-28 w-full rounded-2xl sm:h-44 lg:h-52" />
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Skeleton className="size-20 shrink-0 rounded-full sm:size-28" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
      </div>
      <div className="flex gap-4 border-b pb-3" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-20" />
        ))}
      </div>
      <VideoGridSkeleton count={8} />
    </div>
  );
}
