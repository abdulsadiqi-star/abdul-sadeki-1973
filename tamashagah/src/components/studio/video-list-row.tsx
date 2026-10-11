'use client';

import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { KindBadge, VideoStateBadge, VisibilityBadge } from './video-status';
import { PosterThumb, VideoStats, useDateLine, type VideoItemProps } from './video-grid-card';
import { VideoItemActions } from './video-item-actions';

/** One video as a wide row: poster, title and state on the start side, numbers and actions on the end side. */
export function VideoListRow({ video, selected, onSelectedChange, onDelete, onRetry }: VideoItemProps) {
  const dateLine = useDateLine(video);
  const editHref = `/studio/videos/${video.id}/edit` as const;

  return (
    <li>
      <article
        data-testid="video-row"
        data-video-id={video.id}
        data-status={video.processingStatus}
        className={cn('flex flex-wrap items-start gap-3 rounded-xl border bg-card p-3 shadow-xs sm:flex-nowrap sm:gap-4', selected && 'ring-2 ring-primary')}
      >
        <div className="pt-1">
          <Checkbox checked={selected} onCheckedChange={(value) => onSelectedChange(value === true)} aria-label={`انتخاب «${video.title}»`} />
        </div>
        <Link href={editHref} aria-label={`ویرایش «${video.title}»`} tabIndex={-1} className="block w-36 shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring sm:w-44">
          <PosterThumb video={video} className="rounded-lg" />
        </Link>

        <div className="min-w-0 flex-1 basis-48 space-y-2">
          <h3 className="line-clamp-2 text-[15px] leading-6 font-semibold">
            <Link href={editHref} dir="auto" className="transition-colors hover:text-primary focus-visible:text-primary">
              {video.title}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <VideoStateBadge video={video} />
            {video.processingStatus === 'READY' && <VisibilityBadge visibility={video.visibility} />}
            <KindBadge kind={video.kind} />
          </div>
          {video.processingStatus === 'FAILED' && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-destructive">{video.failureReason ?? 'پردازش ویدیو ناموفق بود.'}</p>
              <Button size="xs" variant="outline" onClick={onRetry}>
                <RotateCcw /> تلاش دوباره
              </Button>
            </div>
          )}
          <VideoStats video={video} />
          <p className="text-xs text-muted-foreground">{dateLine}</p>
        </div>

        <VideoItemActions video={video} onDelete={onDelete} onRetry={onRetry} className="ms-auto shrink-0 self-center" />
      </article>
    </li>
  );
}
