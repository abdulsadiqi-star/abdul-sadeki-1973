import { Skeleton } from '@/components/ui/skeleton';
import { VideoGridSkeleton } from '@/components/video/video-grid';

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="در حال بارگذاری دسته‌بندی">
      <div className="flex gap-2 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="flex items-center gap-4" aria-hidden="true">
        <Skeleton className="size-14 rounded-2xl" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-20 rounded-full" />
        ))}
      </div>
      <VideoGridSkeleton count={12} />
    </div>
  );
}
