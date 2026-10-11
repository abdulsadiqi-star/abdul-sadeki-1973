'use client';

import { ShortCard } from '@/components/shorts/short-card';
import { ScrollRail } from '@/features/discovery/components/scroll-rail';
import type { VideoCardData } from '@/features/videos/card';

/** Horizontally scrolling row of short tiles (home page, channel overview). */
export function ShortsRail({ videos, label = 'شورتس' }: { videos: VideoCardData[]; label?: string }) {
  return (
    <ScrollRail label={label} arrowTop="7rem">
      {videos.map((video, i) => (
        <div key={video.id} className="w-36 shrink-0 snap-start sm:w-40">
          <ShortCard video={video} priority={i < 4} />
        </div>
      ))}
    </ScrollRail>
  );
}
