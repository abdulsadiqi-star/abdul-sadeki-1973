'use client';

import { X } from 'lucide-react';
import { VideoCard } from '@/components/video/video-card';
import type { VideoCardData } from '@/features/videos/card';
import { cn } from '@/lib/utils';

/**
 * A video tile of the library: the standard card plus an optional resume bar and a remove button on the poster.
 * The remove button is always visible on touch screens and appears on hover / keyboard focus on desktop.
 */
export function LibraryVideoItem({
  video,
  progress,
  removeLabel,
  onRemove,
  priority,
}: {
  video: VideoCardData;
  /** 0..1 */
  progress?: number;
  /** Accessible name of the remove button, e.g. "حذف از تاریخچه". */
  removeLabel?: string;
  onRemove?: () => void;
  priority?: boolean;
}) {
  return (
    <div className="group/library relative">
      <VideoCard video={video} priority={priority} />
      {/* overlays are positioned over the 16:9 poster, which is the first thing inside the card */}
      <div className="pointer-events-none absolute inset-x-0 top-0 aspect-video overflow-hidden rounded-xl">
        {progress !== undefined && progress > 0 && (
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-black/45">
            <div className="h-full bg-primary" style={{ width: `${Math.round(Math.min(1, progress) * 100)}%` }} />
          </div>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${removeLabel ?? 'حذف'}: ${video.title}`}
            className={cn(
              'pointer-events-auto absolute start-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-opacity outline-none hover:bg-black/80 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring',
              'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/library:opacity-100',
            )}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
