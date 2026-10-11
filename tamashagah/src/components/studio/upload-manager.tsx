'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, Layers, MailWarning, RefreshCw, Smartphone, X, type LucideIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormatter } from '@/components/providers/format-provider';
import { getUploadEngine, uploadMetadata, useUploadItems } from '@/features/uploads/client/use-upload-engine';
import { titleFromFilename, type UploadLimits } from '@/features/uploads/policy';
import { useVideoStatuses } from '@/features/videos-studio/client/use-video-statuses';
import { deleteVideoAction, retryProcessingAction } from '@/features/videos-studio/actions';
import { defaultMetadata } from '@/features/videos-studio/metadata';
import type { PendingUpload, StudioVideoItem, UploadUsage } from '@/features/videos-studio/queries';
import { studioMessages } from '@/features/videos-studio/labels';
import type { Visibility } from '@/generated/prisma/enums';
import { ProcessingProgress, VideoStateBadge } from './video-status';
import { UploadCard } from './upload-card';
import { UploadDropzone } from './upload-dropzone';
import { UploadPendingList } from './upload-pending-list';
import type { CategoryOption } from './video-metadata-form';

type Props = {
  limits: UploadLimits;
  usage: UploadUsage;
  emailVerified: boolean;
  categories: CategoryOption[];
  defaultVisibility: Visibility;
  pending: PendingUpload[];
  processing: StudioVideoItem[];
};

function Tip({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: string }) {
  return (
    <div className="flex gap-3 rounded-xl border bg-card p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs leading-6 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function UploadManager({ limits, usage, emailVerified, categories, defaultVisibility, pending, processing }: Props) {
  const f = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const items = useUploadItems();
  const [rejections, setRejections] = useState<{ name: string; message: string }[]>([]);
  const [handledPending, setHandledPending] = useState<ReadonlySet<string>>(new Set());
  const [dismissedRows, setDismissedRows] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    getUploadEngine().configure({ maxBytes: limits.maxBytes });
  }, [limits.maxBytes]);

  // Everything the page needs to poll: finished uploads and the videos that were already processing on arrival.
  const tracked = useMemo(() => new Set(items.map((item) => item.videoId).filter((id): id is string => Boolean(id))), [items]);
  const rows = processing.filter((video) => !tracked.has(video.id) && !dismissedRows.has(video.id));
  const pollIds = useMemo(
    () => [...items.filter((item) => item.status === 'done' && item.videoId).map((item) => item.videoId!), ...rows.map((row) => row.id)],
    [items, rows],
  );
  const { statuses } = useVideoStatuses(pollIds);

  // A finished upload changes the quota and removes the entry from the "unfinished uploads" list: refresh server data.
  const doneCount = items.filter((item) => item.status === 'done').length;
  const previousDone = useRef(doneCount);
  useEffect(() => {
    if (doneCount > previousDone.current) router.refresh();
    previousDone.current = doneCount;
  }, [doneCount, router]);

  function addFiles(files: File[], resume?: PendingUpload) {
    const engine = getUploadEngine();
    const result = engine.add(files, resume ? { resumeVideoId: resume.id } : {});
    for (const item of result.added) {
      uploadMetadata.set(item.id, resume ? resume.metadata : defaultMetadata({ title: titleFromFilename(item.name), visibility: defaultVisibility }));
    }
    setRejections(result.rejected);
  }

  async function retryProcessing(videoId: string) {
    const result = await retryProcessingAction({ id: videoId });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(studioMessages.retryQueued);
    await queryClient.invalidateQueries({ queryKey: ['studio', 'video-statuses'] });
  }

  async function discardPending(upload: PendingUpload) {
    const result = await deleteVideoAction({ id: upload.id });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    setHandledPending((prev) => new Set(prev).add(upload.id));
    toast.success('بارگذاری ناتمام حذف شد.');
  }

  const visiblePending = pending.filter((upload) => !handledPending.has(upload.id) && !tracked.has(upload.id));
  const remainingCount = Math.max(0, limits.maxPerDay - usage.count);
  const remainingBytes = Math.max(0, limits.dailyQuotaBytes - usage.bytes);

  return (
    <div className="space-y-6">
      {!emailVerified && (
        <Alert variant="warning">
          <MailWarning />
          <AlertTitle>ایمیل شما هنوز تأیید نشده است</AlertTitle>
          <AlertDescription>برای بارگذاری ویدیو ابتدا پیوند تأییدی را که به ایمیل‌تان فرستاده‌ایم باز کنید.</AlertDescription>
        </Alert>
      )}

      <UploadDropzone
        maxBytes={limits.maxBytes}
        disabled={!emailVerified}
        disabledReason="تا تأیید ایمیل، امکان بارگذاری ندارید."
        onFiles={(files) => addFiles(files)}
      />

      <p className="-mt-2 text-center text-xs text-muted-foreground" data-testid="upload-quota">
        سهمیه‌ی امروز: {f.number(remainingCount)} ویدیو و {f.bytes(remainingBytes)} حجم باقی مانده است.
      </p>

      {rejections.length > 0 && (
        <Alert variant="destructive" data-testid="upload-rejections">
          <AlertCircle />
          <AlertTitle className="flex items-center justify-between gap-2">
            <span>این فایل‌ها اضافه نشدند</span>
            <Button variant="ghost" size="icon-xs" aria-label="بستن این پیام" onClick={() => setRejections([])}>
              <X />
            </Button>
          </AlertTitle>
          <AlertDescription className="text-foreground">
            <ul className="list-disc space-y-1 ps-4">
              {rejections.map((rejection, index) => (
                <li key={`${rejection.name}-${index}`}>
                  <span dir="auto" className="font-medium">
                    {rejection.name}
                  </span>
                  : {rejection.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <UploadPendingList
        items={visiblePending}
        disabled={!emailVerified}
        onContinue={(upload, file) => {
          setHandledPending((prev) => new Set(prev).add(upload.id));
          addFiles([file], upload);
        }}
        onDiscard={discardPending}
      />

      {items.length > 0 && (
        <section aria-labelledby="uploads-heading" className="space-y-3">
          <h2 id="uploads-heading" className="text-base font-bold">
            بارگذاری‌های این نشست
          </h2>
          <ul className="space-y-4" data-testid="upload-list">
            {[...items].reverse().map((item) => (
              <UploadCard
                key={item.id}
                item={item}
                status={item.videoId ? statuses.get(item.videoId) : undefined}
                initialMetadata={uploadMetadata.get(item.id) ?? defaultMetadata({ title: titleFromFilename(item.name), visibility: defaultVisibility })}
                categories={categories}
                onPause={() => getUploadEngine().pause(item.id)}
                onResume={() => getUploadEngine().resume(item.id)}
                onCancel={() => getUploadEngine().cancel(item.id)}
                onRetry={() => getUploadEngine().retry(item.id)}
                onDismiss={() => getUploadEngine().dismiss(item.id)}
                onRetryProcessing={retryProcessing}
              />
            ))}
          </ul>
        </section>
      )}

      {rows.length > 0 && (
        <Card data-testid="processing-videos">
          <CardHeader>
            <CardTitle>در حال پردازش</CardTitle>
            <CardDescription>این ویدیوها بارگذاری شده‌اند و آماده‌ی انتشار می‌شوند. می‌توانید صفحه را ببندید؛ پردازش ادامه پیدا می‌کند.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {rows.map((row) => {
                const live = statuses.get(row.id) ?? row;
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0" data-testid="processing-row">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/studio/videos/${row.id}/edit`} className="truncate text-sm font-medium hover:text-primary" dir="auto">
                          {live.title}
                        </Link>
                        <VideoStateBadge video={live} />
                      </div>
                      <ProcessingProgress video={live} variant="compact" />
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label="حذف از این فهرست" onClick={() => setDismissedRows((prev) => new Set(prev).add(row.id))}>
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && rows.length === 0 && visiblePending.length === 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          <Tip icon={RefreshCw} title="بارگذاری ادامه‌پذیر">
            اگر اینترنت قطع شود یا صفحه بسته شود، همان فایل را دوباره انتخاب کنید تا از همان‌جا ادامه پیدا کند.
          </Tip>
          <Tip icon={Layers} title="کیفیت‌ها خودکار ساخته می‌شود">
            از فایل شما نسخه‌های ۱۰۸۰، ۷۲۰، ۴۸۰ و ۳۶۰ ساخته می‌شود تا هر بیننده با هر اینترنتی بتواند ببیند.
          </Tip>
          <Tip icon={Smartphone} title="شورتس">
            ویدیوهای عمودی کوتاه‌تر از ۹۰ ثانیه به‌صورت خودکار در بخش شورتس منتشر می‌شوند.
          </Tip>
        </div>
      )}
    </div>
  );
}
