import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { VideoCard } from '@/components/video/video-card';
import type { VideoCardData } from '@/features/videos/card';
import { cn } from '@/lib/utils';

const GRID = 'grid gap-x-4 gap-y-8 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]';

/** Responsive auto-fill grid of VideoCards. */
export function VideoGrid({
  videos,
  hideChannel,
  className,
  priorityCount = 4,
}: {
  videos: VideoCardData[];
  hideChannel?: boolean;
  className?: string;
  priorityCount?: number;
}) {
  return (
    <div className={cn(GRID, className)}>
      {videos.map((video, i) => (
        <VideoCard key={video.id} video={video} hideChannel={hideChannel} priority={i < priorityCount} />
      ))}
    </div>
  );
}

export function VideoCardSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="aspect-video w-full rounded-xl" />
      <div className="flex gap-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function VideoGridSkeleton({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(GRID, className)} role="status" aria-label="در حال بارگذاری ویدیوها">
      {Array.from({ length: count }, (_, i) => (
        <VideoCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Section heading with an optional "see all" link, used above grids on the home page. */
export function SectionHeading({ title, action, icon }: { title: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}
