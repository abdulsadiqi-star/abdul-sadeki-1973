'use client';

import { VideoCard } from '@/components/video/video-card';
import type { VideoCardData } from '@/features/videos/card';
import { ScrollRail } from './scroll-rail';

export type RailVideo = VideoCardData & {
  /** 0..1 — shows a resume bar over the poster ("continue watching"). */
  progress?: number;
};

/** One thumbnail slot of a rail. */
export function RailItem({ video, priority }: { video: RailVideo; priority?: boolean }) {
  return (
    <div className="relative w-[16.5rem] shrink-0 snap-start sm:w-72">
      <VideoCard video={video} priority={priority} />
      {video.progress !== undefined && (
        // sits on the bottom edge of the 16:9 poster (the poster is the first thing in the card)
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 aspect-video overflow-hidden rounded-xl">
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/45">
            <div className="h-full bg-primary" style={{ width: `${Math.round(Math.min(1, Math.max(0, video.progress)) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/** A horizontally scrolling row of video cards. */
export function VideoRail({ videos, label, priorityCount = 0 }: { videos: RailVideo[]; label: string; priorityCount?: number }) {
  return (
    <ScrollRail label={label}>
      {videos.map((video, i) => (
        <RailItem key={video.id} video={video} priority={i < priorityCount} />
      ))}
    </ScrollRail>
  );
}
