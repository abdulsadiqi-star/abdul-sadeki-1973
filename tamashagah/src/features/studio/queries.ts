import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { addDaysToKey, dayKeyToInstant, todayKey } from '@/lib/analytics/time';
import { utcBound } from '@/features/analytics/sql';
import { countUnreadNotifications, listNotifications } from '@/features/notifications/queries';
import type { DashboardComment, DashboardData, DashboardVideo, UploadAlertVideo } from './types';

const RECENT_VIDEOS = 5;
const RECENT_COMMENTS = 5;
const ALERT_VIDEOS = 5;

/**
 * Everything the studio dashboard shows, from persisted rows only. All numbers are scoped by `channelId`
 * (derived from the session by the caller). View figures come from ViewEvent rows — the same source as the
 * analytics page — so the two always agree; SEED rows are counted but flagged in `sample`.
 */
export async function getDashboardData(args: { userId: string; channelId: string; now?: Date }): Promise<DashboardData> {
  const { userId, channelId } = args;
  const today = todayKey(args.now ?? new Date());
  const todayStart = dayKeyToInstant(today);
  const tomorrowStart = dayKeyToInstant(addDaysToKey(today, 1));

  const [
    videoCount,
    publishedCount,
    channel,
    [views],
    recentVideoRows,
    recentCommentRows,
    pendingComments,
    unread,
    notificationPage,
    alertRows,
  ] = await Promise.all([
    db.video.count({ where: { channelId, processingStatus: { not: 'AWAITING_UPLOAD' } } }),
    db.video.count({ where: { channelId, processingStatus: 'READY', publishStatus: 'PUBLISHED' } }),
    db.channel.findUnique({ where: { id: channelId }, select: { followerCount: true } }),
    db.$queryRaw<{ total: number; today: number; seedTotal: number; seedToday: number }[]>`
      SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE e."createdAt" >= ${utcBound(todayStart)} AND e."createdAt" < ${utcBound(tomorrowStart)}))::int AS today,
             (count(*) FILTER (WHERE e."source" = 'SEED'))::int AS "seedTotal",
             (count(*) FILTER (WHERE e."source" = 'SEED' AND e."createdAt" >= ${utcBound(todayStart)} AND e."createdAt" < ${utcBound(tomorrowStart)}))::int AS "seedToday"
      FROM "ViewEvent" e
      WHERE e."channelId" = ${channelId}`,
    db.video.findMany({
      where: { channelId, processingStatus: { not: 'AWAITING_UPLOAD' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RECENT_VIDEOS,
      select: {
        id: true,
        title: true,
        kind: true,
        posterKey: true,
        durationSeconds: true,
        processingStatus: true,
        publishStatus: true,
        visibility: true,
        takedownAt: true,
        scheduledFor: true,
        publishedAt: true,
        createdAt: true,
      },
    }),
    db.comment.findMany({
      where: { video: { channelId }, status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RECENT_COMMENTS,
      select: {
        id: true,
        body: true,
        status: true,
        createdAt: true,
        author: { select: { displayName: true, avatarKey: true, channel: { select: { name: true, avatarKey: true } } } },
        video: { select: { id: true, title: true } },
      },
    }),
    db.comment.count({ where: { video: { channelId }, status: 'PENDING' } }),
    countUnreadNotifications(userId),
    listNotifications(userId, { limit: 3 }),
    db.video.findMany({
      where: { channelId, processingStatus: { in: ['QUEUED', 'PROCESSING', 'FAILED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ALERT_VIDEOS * 2,
      select: {
        id: true,
        title: true,
        processingStatus: true,
        failureReason: true,
        jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { progress: true } },
      },
    }),
  ]);

  // Per-video all-time views / likes for the few rows shown (two small grouped queries on indexed columns).
  const videoIds = recentVideoRows.map((v) => v.id);
  const [viewGroups, likeGroups] = videoIds.length
    ? await Promise.all([
        db.viewEvent.groupBy({ by: ['videoId'], where: { channelId, videoId: { in: videoIds } }, _count: { _all: true } }),
        db.videoLike.groupBy({ by: ['videoId'], where: { videoId: { in: videoIds } }, _count: { _all: true } }),
      ])
    : [[], []];
  const viewsByVideo = new Map(viewGroups.map((g) => [g.videoId, g._count._all]));
  const likesByVideo = new Map(likeGroups.map((g) => [g.videoId, g._count._all]));

  const recentVideos: DashboardVideo[] = recentVideoRows.map((v) => ({
    id: v.id,
    title: v.title,
    kind: v.kind,
    posterKey: v.posterKey,
    durationSeconds: v.durationSeconds,
    processingStatus: v.processingStatus,
    publishStatus: v.publishStatus,
    visibility: v.visibility,
    takedownAt: v.takedownAt?.toISOString() ?? null,
    scheduledFor: v.scheduledFor?.toISOString() ?? null,
    date: (v.publishedAt ?? v.createdAt).toISOString(),
    views: viewsByVideo.get(v.id) ?? 0,
    likes: likesByVideo.get(v.id) ?? 0,
  }));

  const recentComments: DashboardComment[] = recentCommentRows.map((c) => ({
    id: c.id,
    body: c.body,
    status: c.status as 'PENDING' | 'APPROVED',
    createdAt: c.createdAt.toISOString(),
    author: {
      name: c.author.channel?.name ?? c.author.displayName,
      avatarUrl: mediaUrl(c.author.channel?.avatarKey ?? c.author.avatarKey),
    },
    video: c.video,
  }));

  const toAlert = (v: (typeof alertRows)[number]): UploadAlertVideo => ({
    id: v.id,
    title: v.title,
    status: v.processingStatus,
    progress: v.jobs[0]?.progress ?? null,
    failureReason: v.failureReason,
  });
  const alerts = {
    processing: alertRows.filter((v) => v.processingStatus !== 'FAILED').slice(0, ALERT_VIDEOS).map(toAlert),
    failed: alertRows.filter((v) => v.processingStatus === 'FAILED').slice(0, ALERT_VIDEOS).map(toAlert),
  };

  return {
    counts: {
      videos: videoCount,
      published: publishedCount,
      followers: channel?.followerCount ?? 0,
      totalViews: views?.total ?? 0,
      todayViews: views?.today ?? 0,
    },
    sample: {
      totalViews: { real: (views?.total ?? 0) - (views?.seedTotal ?? 0), seed: views?.seedTotal ?? 0 },
      todayViews: { real: (views?.today ?? 0) - (views?.seedToday ?? 0), seed: views?.seedToday ?? 0 },
    },
    recentVideos,
    recentComments,
    pendingComments,
    notifications: { unread, items: notificationPage.items },
    alerts,
  };
}
