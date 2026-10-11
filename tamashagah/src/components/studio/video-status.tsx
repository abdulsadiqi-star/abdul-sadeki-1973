'use client';

import { AlertTriangle, CalendarClock, Check, CircleDashed, Clock, Globe, Link2, Loader2, Lock, Radio, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useFormatter } from '@/components/providers/format-provider';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';
import type { JobStage, ProcessingStatus, PublishStatus, VideoKind, Visibility } from '@/generated/prisma/enums';
import type { StudioJobInfo } from '@/features/videos-studio/queries';

type StateInput = {
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  scheduledFor?: string | null;
};

/**
 * The one badge that answers "where is this video?": processing wins until the video is READY, afterwards the
 * publication state (published / scheduled / draft).
 */
export function VideoStateBadge({ video, className }: { video: StateInput; className?: string }) {
  const f = useFormatter();
  if (video.processingStatus === 'FAILED') {
    return (
      <Badge variant="destructive" className={className}>
        <AlertTriangle /> {labels.processing.FAILED}
      </Badge>
    );
  }
  if (video.processingStatus === 'AWAITING_UPLOAD') {
    return (
      <Badge variant="warning" className={className}>
        <CircleDashed /> {labels.processing.AWAITING_UPLOAD}
      </Badge>
    );
  }
  if (video.processingStatus !== 'READY') {
    return (
      <Badge variant="info" className={className}>
        <Loader2 className="animate-spin" /> {labels.processing[video.processingStatus]}
      </Badge>
    );
  }
  if (video.publishStatus === 'PUBLISHED') {
    return (
      <Badge variant="success" className={className}>
        <Radio /> {labels.publish.PUBLISHED}
      </Badge>
    );
  }
  if (video.publishStatus === 'SCHEDULED') {
    return (
      <Badge variant="warning" className={className} title={video.scheduledFor ? f.dateTime(video.scheduledFor) : undefined}>
        <CalendarClock /> {labels.publish.SCHEDULED}
      </Badge>
    );
  }
  return (
    <Badge variant="muted" className={className}>
      {labels.publish.DRAFT}
    </Badge>
  );
}

const visibilityIcon = { PUBLIC: Globe, UNLISTED: Link2, PRIVATE: Lock } as const;

export function VisibilityBadge({ visibility, className }: { visibility: Visibility; className?: string }) {
  const Icon = visibilityIcon[visibility];
  return (
    <Badge variant="outline" className={cn('font-normal', className)}>
      <Icon /> {labels.visibility[visibility]}
    </Badge>
  );
}

export function KindBadge({ kind, className }: { kind: VideoKind; className?: string }) {
  if (kind !== 'SHORT') return null;
  return (
    <Badge variant="secondary" className={className}>
      <Smartphone /> {labels.videoKind.SHORT}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Processing progress
// ---------------------------------------------------------------------------

const STAGES: JobStage[] = ['PROBE', 'TRANSCODE', 'THUMBNAILS', 'PACKAGE', 'FINALIZE'];

type ProgressInput = {
  processingStatus: ProcessingStatus;
  failureReason?: string | null;
  job: StudioJobInfo | null;
};

/** What to tell the creator while the video is not ready: stage, percentage, queue position text, failure reason. */
export function ProcessingProgress({
  video,
  variant = 'full',
  className,
}: {
  video: ProgressInput;
  /** `compact` is one line with a thin bar; `full` adds the stage list. */
  variant?: 'compact' | 'full';
  className?: string;
}) {
  const f = useFormatter();
  const { processingStatus: status, job } = video;

  if (status === 'FAILED') {
    return (
      <p className={cn('text-sm text-destructive', className)} role="status">
        {video.failureReason ?? 'پردازش ویدیو ناموفق بود.'}
      </p>
    );
  }
  if (status === 'READY') {
    return (
      <p className={cn('flex items-center gap-1.5 text-sm text-success', className)} role="status">
        <Check className="size-4" /> پردازش کامل شد.
      </p>
    );
  }
  if (status === 'AWAITING_UPLOAD') {
    return (
      <p className={cn('text-sm text-muted-foreground', className)} role="status">
        در انتظار تکمیل بارگذاری
      </p>
    );
  }

  const queued = status === 'QUEUED' || !job?.stage;
  const percent = Math.max(0, Math.min(100, Math.round(job?.progress ?? 0)));
  const stageIndex = job?.stage ? STAGES.indexOf(job.stage) : -1;
  const retrying = job && job.attempt > 1;
  const headline = queued ? labels.processing.QUEUED : labels.jobStage[job!.stage!];

  return (
    <div className={cn('space-y-2', className)} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          {queued ? <Clock className="size-4 shrink-0 text-muted-foreground" /> : <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
          <span className="truncate">{headline}</span>
        </span>
        {!queued && <span className="shrink-0 text-muted-foreground tabular-nums">{f.percent(percent / 100, 0)}</span>}
      </div>
      <Progress
        value={queued ? 0 : percent}
        className={cn(variant === 'compact' ? 'h-1.5' : 'h-2', queued && 'animate-pulse')}
        aria-label="پیشرفت پردازش"
      />
      {retrying && (
        <p className="text-xs text-muted-foreground">
          تلاش {f.number(job.attempt)} از {f.number(job.maxAttempts)}
        </p>
      )}
      {variant === 'full' && (
        <ol className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
          {STAGES.map((stage, index) => {
            const done = stageIndex > index;
            const current = stageIndex === index;
            return (
              <li key={stage} aria-current={current ? 'step' : undefined} className={cn('flex items-center gap-1', current && 'font-semibold text-foreground', done && 'text-success')}>
                {done ? <Check className="size-3.5" /> : <span aria-hidden="true" className={cn('size-1.5 rounded-full bg-current', !current && 'opacity-40')} />}
                {labels.jobStage[stage]}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
