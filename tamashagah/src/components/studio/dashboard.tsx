import { env } from '@/lib/env';
import { getDashboardData } from '@/features/studio/queries';
import { DashboardStats } from './dashboard-stats';
import { FirstUploadCard } from './first-upload-card';
import { NotificationsCard } from './notifications-card';
import { RecentCommentsCard } from './recent-comments-card';
import { RecentVideosCard } from './recent-videos-card';
import { TipCards } from './tip-cards';
import { UploadAlerts } from './upload-alerts';

/** Body of /studio for a channel owner (the page wraps it in Suspense with a skeleton). */
export async function Dashboard({ userId, channel }: { userId: string; channel: { id: string; name: string } }) {
  const data = await getDashboardData({ userId, channelId: channel.id });
  const showSample = env.SHOW_SEED_DATA_NOTICE;
  const hasSample = showSample && (data.sample.totalViews.seed > 0 || data.sample.todayViews.seed > 0);
  const isNewChannel = data.counts.videos === 0;

  return (
    <div className="space-y-6">
      <UploadAlerts processing={data.alerts.processing} failed={data.alerts.failed} />
      {isNewChannel && <FirstUploadCard channelName={channel.name} />}
      <DashboardStats data={data} showSample={showSample} />
      {hasSample && (
        <p className="-mt-3 text-xs text-muted-foreground" data-testid="sample-footnote">
          «نمونه» یعنی بخشی از این عدد از رویدادهای نمونه‌ی آزمایشی است، نه رفتار واقعی بینندگان. جزئیات در بخش آمار بازدید آمده است.
        </p>
      )}
      <TipCards />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {!isNewChannel && <RecentVideosCard videos={data.recentVideos} />}
        <RecentCommentsCard comments={data.recentComments} pending={data.pendingComments} />
      </div>
      <NotificationsCard unread={data.notifications.unread} items={data.notifications.items} />
    </div>
  );
}
