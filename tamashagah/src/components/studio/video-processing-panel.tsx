'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Film, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormatter } from '@/components/providers/format-provider';
import { retryProcessingAction } from '@/features/videos-studio/actions';
import { isInFlight, useVideoStatuses } from '@/features/videos-studio/client/use-video-statuses';
import { studioMessages } from '@/features/videos-studio/labels';
import type { StudioJobInfo } from '@/features/videos-studio/queries';
import type { ProcessingStatus, PublishStatus } from '@/generated/prisma/enums';
import { ProcessingProgress, VideoStateBadge } from './video-status';

type Initial = {
  id: string;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  scheduledFor: string | null;
  job: StudioJobInfo | null;
  failureReason: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  posterUrl: string | null;
};

/**
 * Preview and processing state of the video on the edit page. Follows the processing live; when it finishes the page
 * data is refreshed (poster, duration, thumbnails), and a FAILED video can be sent through the pipeline again.
 */
export function VideoProcessingPanel({ initial }: { initial: Initial }) {
  const f = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const { statuses } = useVideoStatuses(isInFlight(initial) ? [initial.id] : []);
  const live = statuses.get(initial.id);
  const state = live ?? initial;

  const settled = useRef(false);
  useEffect(() => {
    if (live && !isInFlight(live) && isInFlight(initial) && !settled.current) {
      settled.current = true;
      router.refresh();
    }
  }, [live, initial, router]);

  async function retry() {
    setRetrying(true);
    try {
      const result = await retryProcessingAction({ id: initial.id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(studioMessages.retryQueued);
      settled.current = false;
      await queryClient.invalidateQueries({ queryKey: ['studio', 'video-statuses'] });
      router.refresh();
    } finally {
      setRetrying(false);
    }
  }

  const posterUrl = live?.posterUrl ?? initial.posterUrl;
  const duration = live?.durationSeconds ?? initial.durationSeconds;

  return (
    <Card className="gap-4 overflow-hidden py-0" data-testid="processing-panel" data-status={state.processingStatus}>
      <div className="relative aspect-video bg-muted">
        {posterUrl ? (
          <img src={posterUrl} alt="تصویر بندانگشتی ویدیو" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center bg-brand-gradient text-white/80">
            <Film aria-hidden="true" className="size-12" />
          </span>
        )}
        {duration != null && state.processingStatus === 'READY' && (
          <span className="absolute end-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">{f.duration(duration)}</span>
        )}
      </div>
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          وضعیت ویدیو
          <VideoStateBadge video={state} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        <ProcessingProgress video={{ processingStatus: state.processingStatus, job: state.job, failureReason: state.failureReason }} variant="full" />
        {state.processingStatus === 'FAILED' && (
          <Button size="sm" variant="outline" disabled={retrying} onClick={retry}>
            {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />} تلاش دوباره برای پردازش
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
