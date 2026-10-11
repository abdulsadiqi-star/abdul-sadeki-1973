'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock, FileVideo, Loader2, Pause, Play, RotateCcw, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useFormatter } from '@/components/providers/format-provider';
import type { UploadItem } from '@/features/uploads/client/engine';
import { uploadMetadata } from '@/features/uploads/client/use-upload-engine';
import type { MetadataFormValues } from '@/features/videos-studio/metadata';
import type { VideoStatusDto } from '@/features/videos-studio/queries';
import { cn } from '@/lib/utils';
import { ProcessingProgress, VideoStateBadge } from './video-status';
import { VideoMetadataForm, type CategoryOption } from './video-metadata-form';

type Phase = 'waiting' | 'uploading' | 'paused' | 'finishing' | 'upload-error' | 'processing' | 'ready' | 'failed';

export function phaseOf(item: UploadItem, status: VideoStatusDto | undefined): Phase {
  if (item.status === 'done') {
    if (status?.processingStatus === 'READY') return 'ready';
    if (status?.processingStatus === 'FAILED') return 'failed';
    return 'processing';
  }
  return item.status === 'error' ? 'upload-error' : item.status;
}

function UploadProgressLine({ item, phase }: { item: UploadItem; phase: Phase }) {
  const f = useFormatter();
  const fraction = item.size > 0 ? Math.min(1, item.uploaded / item.size) : 0;
  const speed = item.bytesPerSecond > 0 ? `${f.bytes(item.bytesPerSecond)} در ثانیه` : null;
  const eta = item.etaSeconds != null && phase === 'uploading' ? `حدود ${f.durationLong(item.etaSeconds)} مانده` : null;

  return (
    <div className="space-y-2">
      <Progress
        value={fraction * 100}
        aria-label={`پیشرفت بارگذاری ${item.name}`}
        className={cn('h-2.5', phase === 'paused' && 'opacity-60')}
        indicatorClassName={phase === 'paused' ? 'bg-muted-foreground' : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums" data-testid="upload-percent">
          {f.percent(fraction, 0)} · {f.bytes(item.uploaded)} از {f.bytes(item.size)}
        </span>
        <span className="tabular-nums">
          {phase === 'paused' ? 'متوقف شده' : [speed, eta].filter(Boolean).join(' · ')}
        </span>
      </div>
    </div>
  );
}

export function UploadCard({
  item,
  status,
  initialMetadata,
  categories,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onDismiss,
  onRetryProcessing,
}: {
  item: UploadItem;
  status: VideoStatusDto | undefined;
  initialMetadata: MetadataFormValues;
  categories: CategoryOption[];
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onRetryProcessing: (videoId: string) => Promise<void>;
}) {
  const f = useFormatter();
  const phase = phaseOf(item, status);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const active = phase === 'waiting' || phase === 'uploading' || phase === 'paused' || phase === 'upload-error';
  const videoId = item.videoId;

  return (
    <li>
      <Card className="gap-0 overflow-hidden py-0" data-testid="upload-card" data-phase={phase} data-name={item.name}>
        <div className="flex gap-4 p-4 sm:p-5">
          <div
            className={cn(
              'relative hidden aspect-video w-32 shrink-0 self-start overflow-hidden rounded-lg bg-muted sm:block',
              phase === 'ready' && status?.posterUrl && 'bg-black',
            )}
          >
            {phase === 'ready' && status?.posterUrl ? (
              <img src={status.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <span className="flex size-full items-center justify-center text-muted-foreground">
                <FileVideo aria-hidden="true" className="size-8" />
              </span>
            )}
            {phase === 'ready' && status?.durationSeconds != null && (
              <span className="absolute end-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white tabular-nums">{f.duration(status.durationSeconds)}</span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold" dir="auto" title={item.name}>
                  {item.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.bytes(item.size)}
                  {item.resumed && <span> · ادامه‌ی بارگذاری قبلی</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {(phase === 'uploading' || phase === 'waiting') && (
                  <Button variant="ghost" size="icon-sm" aria-label="توقف موقت بارگذاری" onClick={onPause}>
                    <Pause />
                  </Button>
                )}
                {phase === 'paused' && (
                  <Button variant="ghost" size="icon-sm" aria-label="ادامه‌ی بارگذاری" onClick={onResume}>
                    <Play />
                  </Button>
                )}
                {active && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="لغو بارگذاری"
                    onClick={() => (item.uploaded > 0 || item.videoId ? setConfirmCancel(true) : onCancel())}
                  >
                    <X />
                  </Button>
                )}
                {!active && phase !== 'finishing' && (
                  <Button variant="ghost" size="icon-sm" aria-label="حذف از این فهرست" onClick={onDismiss}>
                    <X />
                  </Button>
                )}
              </div>
            </div>

            {phase === 'waiting' && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
                <Clock className="size-4" /> در صف بارگذاری؛ به‌زودی شروع می‌شود.
              </p>
            )}
            {(phase === 'uploading' || phase === 'paused') && <UploadProgressLine item={item} phase={phase} />}
            {phase === 'finishing' && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" /> بارگذاری کامل شد؛ در حال ثبت و ارسال به صف پردازش…
              </p>
            )}
            {phase === 'upload-error' && item.error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription className="text-foreground">
                  <p>{item.error.message}</p>
                  {item.error.retryable && (
                    <Button size="xs" variant="outline" onClick={onRetry} className="mt-1">
                      <RotateCcw /> تلاش دوباره
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {phase === 'processing' && (
              <ProcessingProgress video={status ?? { processingStatus: 'QUEUED', job: null }} variant="full" />
            )}
            {phase === 'failed' && videoId && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription className="text-foreground">
                  <p>{status?.failureReason ?? 'پردازش ویدیو ناموفق بود.'}</p>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={retrying}
                    className="mt-1"
                    onClick={async () => {
                      setRetrying(true);
                      try {
                        await onRetryProcessing(videoId);
                      } finally {
                        setRetrying(false);
                      }
                    }}
                  >
                    {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />} تلاش دوباره برای پردازش
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {phase === 'ready' && videoId && status && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                  <CheckCircle2 className="size-4" /> ویدیو آماده است
                </span>
                <VideoStateBadge video={status} />
                <div className="ms-auto flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/studio/videos/${videoId}/edit`}>ویرایش کامل</Link>
                  </Button>
                  <Button asChild size="sm" variant="soft">
                    <Link href={`/watch/${videoId}`}>مشاهده</Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t bg-muted/20 p-4 sm:p-5">
          <VideoMetadataForm
            videoId={videoId}
            initial={initialMetadata}
            categories={categories}
            layout="inline"
            onSaved={(_, values) => uploadMetadata.set(item.id, values)}
            context={{ processingStatus: status?.processingStatus ?? 'AWAITING_UPLOAD', publishStatus: status?.publishStatus ?? 'DRAFT' }}
          />
        </div>
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        destructive
        title="بارگذاری لغو شود؟"
        description={`«${item.name}» از فهرست حذف می‌شود و بخشی که تاکنون ارسال شده پاک خواهد شد.`}
        confirmLabel="لغو بارگذاری"
        cancelLabel="ادامه بدهم"
        onConfirm={() => onCancel()}
      />
    </li>
  );
}
