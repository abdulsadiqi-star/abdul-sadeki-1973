import Link from 'next/link';
import type { Route } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VideoThumb } from '@/components/studio/video-thumb';
import { getFormatter } from '@/lib/format-server';
import { analyticsHref, type AnalyticsQuery } from '@/features/analytics/schemas';
import type { TopVideo } from '@/features/analytics/types';
import { ANALYTICS_PATH } from './video-performance-table';

/** The most-viewed videos of the range, ranked, with a bar relative to the leader (the numbers are printed too). */
export async function TopVideosCard({ videos, query }: { videos: TopVideo[]; query: AnalyticsQuery }) {
  const f = await getFormatter();
  const max = Math.max(1, ...videos.map((v) => v.views));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">پربازدیدترین ویدیوها</CardTitle>
        <CardDescription>بر اساس تعداد بازدید در بازه‌ی انتخاب‌شده</CardDescription>
      </CardHeader>
      <CardContent>
        {videos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">در این بازه بازدیدی ثبت نشده است.</p>
        ) : (
          <ol className="space-y-4">
            {videos.map((video, index) => (
              <li key={video.id} className="flex items-center gap-3" data-testid="top-video">
                <span aria-hidden="true" className="w-5 shrink-0 text-center text-sm font-bold text-muted-foreground tabular-nums">
                  {f.number(index + 1)}
                </span>
                <VideoThumb posterKey={video.posterKey} className="w-20 shrink-0" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={analyticsHref(ANALYTICS_PATH, { ...query, video: video.id, page: 1 }) as Route}
                    dir="auto"
                    className="line-clamp-1 text-sm font-semibold hover:text-primary focus-visible:text-primary"
                  >
                    <span className="sr-only">رتبه‌ی {f.number(index + 1)}: </span>
                    {video.title}
                  </Link>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, Math.round((video.views / max) * 100))}%` }} />
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {f.number(video.views)} بازدید · {f.number(Math.round(video.watchSeconds / 60))} دقیقه
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
