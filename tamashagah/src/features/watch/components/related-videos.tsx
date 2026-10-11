import { getRelatedVideos } from '@/features/recommendations';
import { Skeleton } from '@/components/ui/skeleton';
import { RelatedVideoCard } from './related-video-card';

/** "ویدیوهای مرتبط": public videos only (the recommendation entry point never lists hidden ones). */
export async function RelatedVideos({ videoId, viewerId }: { videoId: string; viewerId: string | null }) {
  const videos = await getRelatedVideos(videoId, { limit: 12, viewerId });
  if (videos.length === 0) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">ویدیوی مرتبطی پیدا نشد.</p>;
  }
  return (
    <ul className="space-y-3" aria-label="فهرست ویدیوهای مرتبط">
      {videos.map((video) => (
        <li key={video.id}>
          <RelatedVideoCard video={video} />
        </li>
      ))}
    </ul>
  );
}

export function RelatedVideosSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="در حال بارگذاری ویدیوهای مرتبط">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-3" aria-hidden="true">
          <Skeleton className="aspect-video w-40 shrink-0 rounded-lg sm:w-44 lg:w-40 xl:w-44" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
