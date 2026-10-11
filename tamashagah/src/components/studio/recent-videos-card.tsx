import Link from 'next/link';
import { BarChart3, Eye, Heart, Pencil, Upload, Video as VideoIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronEnd } from '@/components/icons';
import { EmptyState } from '@/components/empty-state';
import { getFormatter } from '@/lib/format-server';
import { videoStatusBadge } from '@/features/studio/status';
import type { DashboardVideo } from '@/features/studio/types';
import { VideoThumb } from './video-thumb';

/** "ویدیوهای من": the latest uploads with thumbnail, views, likes, status and shortcuts to edit / analytics. */
export async function RecentVideosCard({ videos }: { videos: DashboardVideo[] }) {
  const f = await getFormatter();
  return (
    <Card data-testid="recent-videos">
      <CardHeader>
        <CardTitle className="text-base">ویدیوهای من</CardTitle>
        <CardAction>
          <Button asChild variant="ghost" size="xs">
            <Link href="/studio/videos">
              همه‌ی ویدیوها <ChevronEnd />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {videos.length === 0 ? (
          <EmptyState
            icon={VideoIcon}
            title="هنوز ویدیویی ندارید"
            description="اولین ویدیوی خود را بارگذاری کنید تا اینجا نمایش داده شود."
            action={
              <Button asChild>
                <Link href="/studio/upload">
                  <Upload /> بارگذاری ویدیو
                </Link>
              </Button>
            }
            className="py-8"
          />
        ) : (
          <ul className="divide-y">
            {videos.map((video) => {
              const status = videoStatusBadge(video);
              return (
                <li key={video.id} className="flex gap-3 py-3 first:pt-0 last:pb-0" data-testid="dashboard-video">
                  <VideoThumb posterKey={video.posterKey} className="w-28 sm:w-32" />
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
                    <div className="min-w-0">
                      <h3 className="line-clamp-2 text-sm leading-6 font-semibold">
                        <Link href={`/studio/videos/${video.id}/edit`} dir="auto" className="hover:text-primary focus-visible:text-primary">
                          {video.title}
                        </Link>
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1" title="بازدید">
                          <Eye aria-hidden="true" className="size-3.5" />
                          <span className="tabular-nums">{f.number(video.views)}</span>
                          <span className="sr-only">بازدید</span>
                        </span>
                        <span className="inline-flex items-center gap-1" title="پسند">
                          <Heart aria-hidden="true" className="size-3.5" />
                          <span className="tabular-nums">{f.number(video.likes)}</span>
                          <span className="sr-only">پسند</span>
                        </span>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button asChild variant="ghost" size="xs">
                        <Link href={`/studio/videos/${video.id}/edit`} aria-label={`ویرایش «${video.title}»`}>
                          <Pencil /> ویرایش
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="xs">
                        <Link href={`/studio/analytics?video=${video.id}`} aria-label={`آمار «${video.title}»`}>
                          <BarChart3 /> آمار
                        </Link>
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
