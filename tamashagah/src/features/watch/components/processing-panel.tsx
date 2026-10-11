'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Hourglass, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useFormatter } from '@/components/providers/format-provider';
import { labels } from '@/lib/i18n/fa';
import type { JobStage, ProcessingStatus } from '@/generated/prisma/enums';

export type ProcessingInfo = {
  processingStatus: ProcessingStatus;
  progress: number;
  stage: JobStage | null;
  failureReason: string | null;
};

async function fetchStatus(videoId: string): Promise<ProcessingInfo> {
  const res = await fetch(`/api/videos/${videoId}/status`, { cache: 'no-store' });
  if (!res.ok) throw new Error('status');
  return res.json();
}

/**
 * Shown to the owner / moderators INSTEAD of the player while a video is not playable yet: live processing
 * progress (polled every 3 s) or the failure reason. As soon as the video is READY the page refreshes into the player.
 */
export function ProcessingPanel({ videoId, initial, editHref }: { videoId: string; initial: ProcessingInfo; editHref: string }) {
  const f = useFormatter();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['video-status', videoId],
    queryFn: () => fetchStatus(videoId),
    initialData: initial,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data && ['READY', 'FAILED'].includes(query.state.data.processingStatus) ? false : 3_000),
  });

  const ready = data.processingStatus === 'READY';
  useEffect(() => {
    if (ready) router.refresh(); // the video finished while this page was open: swap in the player
  }, [ready, router]);

  const status = data.processingStatus;
  const percent = Math.round(Math.min(100, Math.max(0, data.progress)));

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-muted p-4 text-center sm:rounded-xl"
      data-testid="processing-panel"
      data-status={status}
    >
      {status === 'FAILED' ? (
        <>
          <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <CircleAlert className="size-6" aria-hidden="true" />
          </span>
          <p className="text-base font-bold">پردازش این ویدیو ناموفق بود</p>
          {data.failureReason && (
            <p className="max-w-md text-sm text-muted-foreground" dir="auto">
              {data.failureReason}
            </p>
          )}
          <Button asChild size="sm" shape="pill">
            <Link href={editHref as Route}>بررسی در استودیو</Link>
          </Button>
        </>
      ) : status === 'AWAITING_UPLOAD' ? (
        <>
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Upload className="size-6" aria-hidden="true" />
          </span>
          <p className="text-base font-bold">آپلود این ویدیو هنوز کامل نشده است</p>
          <p className="max-w-md text-sm text-muted-foreground">بعد از پایان آپلود، پردازش خودکار شروع می‌شود.</p>
          <Button asChild size="sm" shape="pill" variant="outline">
            <Link href={editHref as Route}>رفتن به استودیو</Link>
          </Button>
        </>
      ) : (
        <>
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            {status === 'QUEUED' ? <Hourglass className="size-6" aria-hidden="true" /> : <Loader2 className="size-6 animate-spin" aria-hidden="true" />}
          </span>
          <p className="text-base font-bold">{labels.processing[status]}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {status === 'QUEUED'
              ? 'ویدیوی شما به‌زودی پردازش می‌شود. می‌توانید این صفحه را باز نگه دارید.'
              : `${data.stage ? labels.jobStage[data.stage] : 'در حال آماده‌سازی'}؛ بعد از پایان، پخش‌کننده خودکار نمایش داده می‌شود.`}
          </p>
          {status === 'PROCESSING' && (
            <div className="flex w-full max-w-sm items-center gap-3">
              <Progress value={percent} aria-label="پیشرفت پردازش" className="flex-1" />
              <span className="text-sm font-semibold tabular-nums">{f.percent(percent / 100, 0)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
