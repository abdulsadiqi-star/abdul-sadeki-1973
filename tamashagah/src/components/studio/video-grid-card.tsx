'use client';

import Link from 'next/link';
import { Eye, Film, MessageSquare, ThumbsUp } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useFormatter } from '@/components/providers/format-provider';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';
import type { StudioVideoItem } from '@/features/videos-studio/queries';
import { KindBadge, VideoStateBadge, VisibilityBadge } from './video-status';
import { VideoItemActions } from './video-item-actions';

export type VideoItemProps = {
  video: StudioVideoItem;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onDelete: () => void;
  onRetry: () => void;
};

const isProcessing = (video: Pick<StudioVideoItem, 'processingStatus'>) =>
  video.processingStatus === 'QUEUED' || video.processingStatus === 'PROCESSING' || video.processingStatus === 'AWAITING_UPLOAD';

/** "Published 3 Mehr", "Scheduled for ...", "Created ..." — whichever fits the state. */
export function useDateLine(video: StudioVideoItem): string {
  const f = useFormatter();
  if (video.publishStatus === 'PUBLISHED' && video.publishedAt) return `منتشر شده: ${f.date(video.publishedAt)}`;
  if (video.publishStatus === 'SCHEDULED' && video.scheduledFor) return `زمان‌بندی: ${f.dateTime(video.scheduledFor)}`;
  return `ایجاد شده: ${f.date(video.createdAt)}`;
}

export function PosterOverlay({ video }: { video: StudioVideoItem }) {
  const f = useFormatter();
  const job = video.job;
  const queued = video.processingStatus !== 'PROCESSING' || !job?.stage;
  const percent = Math.max(0, Math.min(100, Math.round(job?.progress ?? 0)));
  const headline = video.processingStatus === 'AWAITING_UPLOAD' ? labels.processing.AWAITING_UPLOAD : queued ? labels.processing.QUEUED : labels.jobStage[job!.stage!];
  return (
    <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-3 pt-10 text-white" role="status">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate">{headline}</span>
        {!queued && <span className="shrink-0 tabular-nums">{f.percent(percent / 100, 0)}</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/25">
        <div className={cn('h-full rounded-full bg-white transition-[width] duration-300', queued && 'animate-pulse')} style={{ width: `${queued ? 8 : percent}%` }} />
      </div>
    </div>
  );
}

export function PosterThumb({ video, className }: { video: StudioVideoItem; className?: string }) {
  const f = useFormatter();
  return (
    <div className={cn('relative aspect-video overflow-hidden bg-muted', className)}>
      {video.posterUrl ? (
        <img src={video.posterUrl} alt="" width={640} height={360} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center bg-brand-gradient text-white/80">
          <Film aria-hidden="true" className="size-9" />
        </span>
      )}
      {video.durationSeconds != null && !isProcessing(video) && (
        <span className="absolute end-1.5 bottom-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">{f.duration(video.durationSeconds)}</span>
      )}
      {isProcessing(video) && <PosterOverlay video={video} />}
    </div>
  );
}

export function VideoStats({ video, className }: { video: Pick<StudioVideoItem, 'viewCount' | 'likeCount' | 'commentCount'>; className?: string }) {
  const f = useFormatter();
  const stat = (Icon: typeof Eye, value: number, label: string) => (
    <span className="inline-flex items-center gap-1 tabular-nums" title={label}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}: </span>
      {f.compact(value)}
    </span>
  );
  return (
    <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', className)}>
      {stat(Eye, video.viewCount, 'بازدید')}
      {stat(ThumbsUp, video.likeCount, 'پسند')}
      {stat(MessageSquare, video.commentCount, 'دیدگاه')}
    </p>
  );
}

export function VideoGridCard({ video, selected, onSelectedChange, onDelete, onRetry }: VideoItemProps) {
  const dateLine = useDateLine(video);
  const editHref = `/studio/videos/${video.id}/edit` as const;

  return (
    <li className="min-w-0">
      <article
        data-testid="video-card"
        data-video-id={video.id}
        data-status={video.processingStatus}
        className={cn('flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md', selected && 'ring-2 ring-primary')}
      >
        <div className="relative">
          <Link href={editHref} aria-label={`ویرایش «${video.title}»`} tabIndex={-1} className="block outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            <PosterThumb video={video} />
          </Link>
          <span className="absolute start-1.5 top-1.5 rounded-md bg-background/90 p-0.5 shadow-xs">
            <Checkbox checked={selected} onCheckedChange={(value) => onSelectedChange(value === true)} aria-label={`انتخاب «${video.title}»`} />
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          <h3 className="line-clamp-2 min-h-10 text-[13px] leading-5 font-semibold">
            <Link href={editHref} dir="auto" className="transition-colors hover:text-primary focus-visible:text-primary">
              {video.title}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-1">
            <VideoStateBadge video={video} />
            {video.processingStatus === 'READY' && <VisibilityBadge visibility={video.visibility} />}
            <KindBadge kind={video.kind} />
          </div>
          {video.processingStatus === 'FAILED' && <p className="line-clamp-2 text-xs text-destructive">{video.failureReason ?? 'پردازش ویدیو ناموفق بود.'}</p>}
          <div className="mt-auto space-y-1 pt-1">
            <VideoStats video={video} />
            <p className="text-[11px] text-muted-foreground">{dateLine}</p>
          </div>
        </div>

        <div className="border-t px-1.5 py-1">
          <VideoItemActions variant="icons" video={video} onDelete={onDelete} onRetry={onRetry} />
        </div>
      </article>
    </li>
  );
}
