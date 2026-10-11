import { Skeleton } from '@/components/ui/skeleton';
import { VideoCardSkeleton } from '@/components/video/video-grid';

/** Same geometry as the real home page (chips, section headings, rails) so nothing jumps when content arrives. */
export function HomeSkeleton() {
  return (
    <div className="space-y-10" role="status" aria-label="در حال بارگذاری صفحه‌ی اصلی">
      <div className="flex gap-2 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      {[0, 1, 2].map((section) => (
        <div key={section} aria-hidden="true">
          <div className="mb-4 flex items-center gap-2">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="w-[16.5rem] shrink-0 sm:w-72">
                <VideoCardSkeleton />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
