import Link from 'next/link';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import type { UploadAlertVideo } from '@/features/studio/types';

/** Heads-up banners: videos still being processed (info) and uploads that failed (destructive, with the reason). */
export async function UploadAlerts({ processing, failed }: { processing: UploadAlertVideo[]; failed: UploadAlertVideo[] }) {
  const f = await getFormatter();
  if (processing.length === 0 && failed.length === 0) return null;
  return (
    <section aria-label="وضعیت بارگذاری‌ها" className="space-y-3" data-testid="upload-alerts">
      {failed.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{f.number(failed.length)} ویدیو پردازش نشد</AlertTitle>
          <AlertDescription>
            <ul className="space-y-1.5">
              {failed.map((video) => (
                <li key={video.id} className="text-foreground">
                  <Link href={`/studio/videos/${video.id}/edit`} dir="auto" className="font-semibold underline-offset-4 hover:underline">
                    {video.title}
                  </Link>
                  <span className="text-muted-foreground"> — {video.failureReason ?? 'علت مشخص نشد؛ دوباره بارگذاری کنید یا با پشتیبانی تماس بگیرید.'}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {processing.length > 0 && (
        <Alert variant="info">
          <Loader2 className="animate-spin motion-reduce:animate-none" />
          <AlertTitle>{f.number(processing.length)} ویدیو در حال پردازش است</AlertTitle>
          <AlertDescription>
            <ul className="space-y-1.5">
              {processing.map((video) => (
                <li key={video.id} className="text-foreground">
                  <Link href={`/studio/videos/${video.id}/edit`} dir="auto" className="font-semibold underline-offset-4 hover:underline">
                    {video.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {' '}
                    — {video.status === 'QUEUED' ? labels.processing.QUEUED : labels.processing.PROCESSING}
                    {video.progress !== null && video.progress > 0 && <> ({f.number(video.progress)}٪)</>}
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
