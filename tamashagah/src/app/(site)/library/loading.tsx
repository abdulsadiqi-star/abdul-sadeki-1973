import { Skeleton } from '@/components/ui/skeleton';
import { VideoGridSkeleton } from '@/components/video/video-grid';

/** Shared by /library and /library/[tab]: heading, tab pills and a grid. */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="در حال بارگذاری کتابخانه">
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <VideoGridSkeleton count={8} />
    </div>
  );
}
