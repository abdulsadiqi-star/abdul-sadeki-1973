import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { BarChart3, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronStart } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { VideoDeleteButton } from '@/components/studio/video-delete-button';
import { VideoMetadataForm } from '@/components/studio/video-metadata-form';
import { VideoProcessingPanel } from '@/components/studio/video-processing-panel';
import { VideoSubtitles } from '@/components/studio/video-subtitles';
import { VideoThumbnailPicker } from '@/components/studio/video-thumbnail-picker';
import { requirePageChannelUser } from '@/lib/auth/guards';
import { toActor } from '@/lib/auth/session';
import { getFormatter } from '@/lib/format-server';
import { isVideoId } from '@/lib/ids';
import { getCategories } from '@/features/categories/queries';
import { getStudioEditData } from '@/features/videos-studio/queries';

export const metadata = { title: 'ویرایش ویدیو' };
export const dynamic = 'force-dynamic';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-end font-medium">{children}</dd>
    </>
  );
}

export default async function EditVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isVideoId(id)) notFound();
  const user = await requirePageChannelUser(`/studio/videos/${id}/edit`);
  const [video, categories, f] = await Promise.all([getStudioEditData(toActor(user), id), getCategories(), getFormatter()]);
  // Not yours (or not there at all): the same 404, so ids cannot be probed.
  if (!video) notFound();

  const ready = video.processingStatus === 'READY';

  return (
    <>
      <PageHeader
        title="ویرایش ویدیو"
        description={video.title}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/studio/videos">
                <ChevronStart /> بازگشت به ویدیوها
              </Link>
            </Button>
            {ready && (
              <Button asChild variant="soft" size="sm">
                <Link href={`/watch/${video.id}`}>
                  <ExternalLink /> مشاهده در سایت
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="space-y-5">
          <VideoMetadataForm
            key={`${video.processingStatus}:${video.publishStatus}`}
            videoId={video.id}
            initial={video.metadata}
            categories={categories.map((category) => ({ id: category.id, nameFa: category.nameFa }))}
            context={{ processingStatus: video.processingStatus, publishStatus: video.publishStatus }}
            layout="cards"
          />
          <VideoThumbnailPicker videoId={video.id} thumbnails={video.thumbnails} posterUrl={video.posterUrl} customPoster={video.customPoster} ready={ready} />
          <VideoSubtitles videoId={video.id} subtitles={video.subtitles} />
        </div>

        <aside className="order-first space-y-5 lg:order-none">
          <VideoProcessingPanel
            initial={{
              id: video.id,
              processingStatus: video.processingStatus,
              publishStatus: video.publishStatus,
              scheduledFor: video.scheduledFor,
              job: video.job,
              failureReason: video.failureReason,
              durationSeconds: video.durationSeconds,
              width: video.width,
              height: video.height,
              posterUrl: video.posterUrl,
            }}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">آمار ویدیو</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['بازدید', video.viewCount],
                  ['پسند', video.likeCount],
                  ['دیدگاه', video.commentCount],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-muted/50 px-2 py-2.5">
                    <dd className="text-lg font-extrabold tabular-nums">{f.compact(value as number)}</dd>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                  </div>
                ))}
              </dl>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href={`/studio/analytics?video=${video.id}` as Route}>
                  <BarChart3 /> آمار کامل
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">جزئیات فایل</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
                {video.originalFilename && <Fact label="فایل اصلی"><span dir="auto" title={video.originalFilename}>{video.originalFilename}</span></Fact>}
                {video.sourceSizeBytes != null && <Fact label="حجم">{f.bytes(video.sourceSizeBytes)}</Fact>}
                {video.width && video.height && <Fact label="ابعاد">{f.number(video.width, { useGrouping: false })} × {f.number(video.height, { useGrouping: false })}</Fact>}
                {video.durationSeconds != null && <Fact label="مدت">{f.duration(video.durationSeconds)}</Fact>}
                <Fact label="تاریخ بارگذاری">{f.date(video.createdAt)}</Fact>
                {video.publishedAt && <Fact label="تاریخ انتشار">{f.date(video.publishedAt)}</Fact>}
                <Fact label="شناسه"><span dir="ltr">{video.id}</span></Fact>
              </dl>
            </CardContent>
          </Card>

          <VideoDeleteButton videoId={video.id} title={video.title} />
        </aside>
      </div>
    </>
  );
}
