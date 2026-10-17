import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import {
  addDaysToKey,
  dayKeyToInstant,
  jalaliMonthDayKeys,
  jalaliMonthOfKey,
  todayKey,
  type DayKey,
} from '@/lib/analytics/time';
import type { ResolvedRange } from '@/lib/analytics/ranges';
import {
  average,
  bucketize,
  emptyDaily,
  percentChange,
  sumDaily,
  type DailyAggregate,
} from '@/lib/analytics/series';
import type { DeviceType, ProcessingStatus, PublishStatus, VideoKind, Visibility } from '@/generated/prisma/enums';
import { tehranDayOf, utcBound } from './sql';
import type {
  AnalyticsOverview,
  AnalyticsScope,
  CardStats,
  DeviceShare,
  RangeChanges,
  RangeTotals,
  SortDirection,
  SourceShare,
  TopVideo,
  VideoPerformancePage,
  VideoPerformanceRow,
  VideoSortKey,
} from './types';

/**
 * Analytics engine: SQL aggregations over persisted rows (ViewEvent, VideoLike, Comment, FollowEvent, Follow).
 *
 *  - Day bucketing is done by PostgreSQL in Asia/Tehran (see `sql.ts` for the timestamp trap), the series is
 *    gap-filled in `lib/analytics/series.ts`.
 *  - Every query is scoped by `channelId` (and `videoId` when set) INSIDE the SQL, so even a caller that forgot an
 *    ownership check can never read another channel's rows. `findOwnedVideo` is the check for the video filter.
 *  - Nothing here reads the denormalized counters except `Channel.followerCount` (kept in the same transaction as
 *    the Follow rows).
 *  - Synthetic rows (`source = SEED`) are counted like real ones but reported separately in `data`.
 */

const SOURCES_SHOWN = 6;
const TOP_VIDEOS = 5;

/** The video, only if it belongs to `channelId` (otherwise `null`: callers answer 404, never 403). */
export async function findOwnedVideo(channelId: string, videoId: string): Promise<{ id: string; title: string } | null> {
  return db.video.findFirst({ where: { id: videoId, channelId }, select: { id: true, title: true } });
}

const viewVideoFilter = (videoId: string | null) => (videoId ? Prisma.sql`AND e."videoId" = ${videoId}` : Prisma.empty);
const likeVideoFilter = (videoId: string | null) => (videoId ? Prisma.sql`AND l."videoId" = ${videoId}` : Prisma.empty);
const commentVideoFilter = (videoId: string | null) => (videoId ? Prisma.sql`AND c."videoId" = ${videoId}` : Prisma.empty);

type Daily = Map<DayKey, DailyAggregate>;

function patchDay(map: Daily, key: DayKey, patch: Partial<DailyAggregate>): void {
  const row = map.get(key) ?? emptyDaily();
  Object.assign(row, patch);
  map.set(key, row);
}

// ---------------------------------------------------------------------------
// Series (one scan per table over [previous.from, range.to) — the previous period comes for free)
// ---------------------------------------------------------------------------

async function loadViewDays(channelId: string, videoId: string | null, from: Date, to: Date, into: Daily): Promise<void> {
  const rows = await db.$queryRaw<{ key: string; views: number; uniqueViewers: number; watchSeconds: number; seedViews: number }[]>`
    SELECT ${tehranDayOf('e."createdAt"')} AS key,
           count(*)::int AS views,
           count(DISTINCT e."viewerKey")::int AS "uniqueViewers",
           coalesce(sum(e."watchSeconds"), 0)::float8 AS "watchSeconds",
           (count(*) FILTER (WHERE e."source" = 'SEED'))::int AS "seedViews"
    FROM "ViewEvent" e
    WHERE e."channelId" = ${channelId} ${viewVideoFilter(videoId)}
      AND e."createdAt" >= ${utcBound(from)} AND e."createdAt" < ${utcBound(to)}
    GROUP BY 1`;
  for (const r of rows) patchDay(into, r.key, { views: r.views, uniqueViewers: r.uniqueViewers, watchSeconds: r.watchSeconds, seedViews: r.seedViews });
}

async function loadLikeDays(channelId: string, videoId: string | null, from: Date, to: Date, into: Daily): Promise<void> {
  const rows = await db.$queryRaw<{ key: string; likes: number }[]>`
    SELECT ${tehranDayOf('l."createdAt"')} AS key, count(*)::int AS likes
    FROM "VideoLike" l
    JOIN "Video" v ON v."id" = l."videoId"
    WHERE v."channelId" = ${channelId} ${likeVideoFilter(videoId)}
      AND l."createdAt" >= ${utcBound(from)} AND l."createdAt" < ${utcBound(to)}
    GROUP BY 1`;
  for (const r of rows) patchDay(into, r.key, { likes: r.likes });
}

async function loadCommentDays(channelId: string, videoId: string | null, from: Date, to: Date, into: Daily): Promise<void> {
  const rows = await db.$queryRaw<{ key: string; comments: number }[]>`
    SELECT ${tehranDayOf('c."createdAt"')} AS key, count(*)::int AS comments
    FROM "Comment" c
    JOIN "Video" v ON v."id" = c."videoId"
    WHERE v."channelId" = ${channelId} AND c."status" = 'APPROVED' ${commentVideoFilter(videoId)}
      AND c."createdAt" >= ${utcBound(from)} AND c."createdAt" < ${utcBound(to)}
    GROUP BY 1`;
  for (const r of rows) patchDay(into, r.key, { comments: r.comments });
}

async function loadFollowDays(channelId: string, from: Date, to: Date, into: Daily): Promise<void> {
  const rows = await db.$queryRaw<{ key: string; newFollowers: number; unfollows: number; seedFollowEvents: number }[]>`
    SELECT ${tehranDayOf('f."createdAt"')} AS key,
           (count(*) FILTER (WHERE f."type" = 'FOLLOW'))::int AS "newFollowers",
           (count(*) FILTER (WHERE f."type" = 'UNFOLLOW'))::int AS "unfollows",
           (count(*) FILTER (WHERE f."source" = 'SEED'))::int AS "seedFollowEvents"
    FROM "FollowEvent" f
    WHERE f."channelId" = ${channelId}
      AND f."createdAt" >= ${utcBound(from)} AND f."createdAt" < ${utcBound(to)}
    GROUP BY 1`;
  for (const r of rows) {
    patchDay(into, r.key, { newFollowers: r.newFollowers, unfollows: r.unfollows, seedFollowEvents: r.seedFollowEvents });
  }
}

/** Distinct viewers cannot be summed over days, so they get their own queries. */
async function loadPeriodUniques(channelId: string, videoId: string | null, range: ResolvedRange): Promise<{ current: number; previous: number }> {
  const [row] = await db.$queryRaw<{ current: number; previous: number }[]>`
    SELECT (count(DISTINCT e."viewerKey") FILTER (WHERE e."createdAt" >= ${utcBound(range.from)}))::int AS "current",
           (count(DISTINCT e."viewerKey") FILTER (WHERE e."createdAt" < ${utcBound(range.from)}))::int AS "previous"
    FROM "ViewEvent" e
    WHERE e."channelId" = ${channelId} ${viewVideoFilter(videoId)}
      AND e."createdAt" >= ${utcBound(range.previous.from)} AND e."createdAt" < ${utcBound(range.to)}`;
  return { current: row?.current ?? 0, previous: row?.previous ?? 0 };
}

/** Distinct viewers per monthly bucket (a viewer who returns every week counts once per month). */
async function loadBucketUniques(channelId: string, videoId: string | null, range: ResolvedRange): Promise<Map<string, number>> {
  const keys = range.buckets.map((b) => b.key);
  const froms = range.buckets.map((b) => b.from.toISOString());
  const tos = range.buckets.map((b) => b.to.toISOString());
  const rows = await db.$queryRaw<{ key: string; uniques: number }[]>`
    WITH b("key", "fromAt", "toAt") AS (
      SELECT * FROM unnest(${keys}::text[], ${froms}::timestamptz[], ${tos}::timestamptz[])
    )
    SELECT b."key" AS key, count(DISTINCT e."viewerKey")::int AS uniques
    FROM b
    JOIN "ViewEvent" e
      ON e."createdAt" >= (b."fromAt" AT TIME ZONE 'UTC') AND e."createdAt" < (b."toAt" AT TIME ZONE 'UTC')
    WHERE e."channelId" = ${channelId} ${viewVideoFilter(videoId)}
    GROUP BY b."key"`;
  return new Map(rows.map((r) => [r.key, r.uniques]));
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

async function loadDevices(channelId: string, videoId: string | null, range: ResolvedRange): Promise<DeviceShare[]> {
  const rows = await db.$queryRaw<{ device: DeviceType; views: number }[]>`
    SELECT e."device"::text AS device, count(*)::int AS views
    FROM "ViewEvent" e
    WHERE e."channelId" = ${channelId} ${viewVideoFilter(videoId)}
      AND e."createdAt" >= ${utcBound(range.from)} AND e."createdAt" < ${utcBound(range.to)}
    GROUP BY e."device"
    ORDER BY views DESC, device`;
  return rows;
}

async function loadSources(channelId: string, videoId: string | null, range: ResolvedRange): Promise<SourceShare[]> {
  return db.$queryRaw<SourceShare[]>`
    SELECT coalesce(nullif(e."referrer", ''), 'direct') AS source, count(*)::int AS views
    FROM "ViewEvent" e
    WHERE e."channelId" = ${channelId} ${viewVideoFilter(videoId)}
      AND e."createdAt" >= ${utcBound(range.from)} AND e."createdAt" < ${utcBound(range.to)}
    GROUP BY 1
    ORDER BY views DESC, source
    LIMIT ${SOURCES_SHOWN}`;
}

/** Adds the long tail as one `other` row so the shares always add up to the total. */
function withOtherSources(top: SourceShare[], totalViews: number): SourceShare[] {
  const shown = top.reduce((sum, r) => sum + r.views, 0);
  return totalViews > shown ? [...top, { source: 'other', views: totalViews - shown }] : top;
}

async function loadTopVideos(channelId: string, range: ResolvedRange): Promise<TopVideo[]> {
  const rows = await db.$queryRaw<{ id: string; views: number; watchSeconds: number }[]>`
    SELECT e."videoId" AS id, count(*)::int AS views, coalesce(sum(e."watchSeconds"), 0)::float8 AS "watchSeconds"
    FROM "ViewEvent" e
    WHERE e."channelId" = ${channelId}
      AND e."createdAt" >= ${utcBound(range.from)} AND e."createdAt" < ${utcBound(range.to)}
    GROUP BY e."videoId"
    ORDER BY views DESC, e."videoId"
    LIMIT ${TOP_VIDEOS}`;
  if (rows.length === 0) return [];
  const videos = await db.video.findMany({
    where: { id: { in: rows.map((r) => r.id) }, channelId },
    select: { id: true, title: true, posterKey: true },
  });
  const byId = new Map(videos.map((v) => [v.id, v]));
  return rows.flatMap((r) => {
    const video = byId.get(r.id);
    return video ? [{ id: r.id, title: video.title, posterKey: video.posterKey, views: r.views, watchSeconds: r.watchSeconds }] : [];
  });
}

async function loadCards(scope: AnalyticsScope, videoId: string | null, now: Date): Promise<CardStats> {
  const today = todayKey(now);
  const todayStart = dayKeyToInstant(today);
  const tomorrowStart = dayKeyToInstant(addDaysToKey(today, 1));
  const monthStart = dayKeyToInstant(jalaliMonthDayKeys(jalaliMonthOfKey(today)).fromKey);

  const viewsQuery = db.$queryRaw<{ today: number; month: number; seedToday: number; seedMonth: number }[]>`
    SELECT (count(*) FILTER (WHERE e."createdAt" >= ${utcBound(todayStart)}))::int AS today,
           count(*)::int AS month,
           (count(*) FILTER (WHERE e."createdAt" >= ${utcBound(todayStart)} AND e."source" = 'SEED'))::int AS "seedToday",
           (count(*) FILTER (WHERE e."source" = 'SEED'))::int AS "seedMonth"
    FROM "ViewEvent" e
    WHERE e."channelId" = ${scope.channelId} ${viewVideoFilter(videoId)}
      AND e."createdAt" >= ${utcBound(monthStart)} AND e."createdAt" < ${utcBound(tomorrowStart)}`;

  const [[views], channel, notifySubscribers] = await Promise.all([
    viewsQuery,
    videoId ? null : db.channel.findUnique({ where: { id: scope.channelId }, select: { followerCount: true } }),
    videoId ? null : db.follow.count({ where: { channelId: scope.channelId, notify: true } }),
  ]);
  return {
    todayViews: views?.today ?? 0,
    monthViews: views?.month ?? 0,
    seedToday: (views?.seedToday ?? 0) > 0,
    seedMonth: (views?.seedMonth ?? 0) > 0,
    followers: videoId ? null : (channel?.followerCount ?? 0),
    notifySubscribers: videoId ? null : (notifySubscribers ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function totalsOf(daily: DailyAggregate, uniqueViewers: number): RangeTotals {
  return {
    views: daily.views,
    uniqueViewers,
    watchSeconds: daily.watchSeconds,
    avgViewSeconds: average(daily.watchSeconds, daily.views),
    likes: daily.likes,
    comments: daily.comments,
    newFollowers: daily.newFollowers,
    unfollows: daily.unfollows,
    netFollowers: daily.newFollowers - daily.unfollows,
  };
}

function changesOf(current: RangeTotals, previous: RangeTotals): RangeChanges {
  return {
    views: percentChange(current.views, previous.views),
    uniqueViewers: percentChange(current.uniqueViewers, previous.uniqueViewers),
    watchSeconds: percentChange(current.watchSeconds, previous.watchSeconds),
    avgViewSeconds: percentChange(current.avgViewSeconds, previous.avgViewSeconds),
    likes: percentChange(current.likes, previous.likes),
    comments: percentChange(current.comments, previous.comments),
    newFollowers: percentChange(current.newFollowers, previous.newFollowers),
    netFollowers: percentChange(current.netFollowers, previous.netFollowers),
  };
}

/**
 * Everything the analytics page shows for one range, channel-wide or for one video.
 * Throws `NOT_FOUND` when `scope.videoId` is not a video of `scope.channelId`.
 */
export async function getAnalyticsOverview(scope: AnalyticsScope, range: ResolvedRange, now: Date = new Date()): Promise<AnalyticsOverview> {
  const video = scope.videoId ? await findOwnedVideo(scope.channelId, scope.videoId) : null;
  if (scope.videoId && !video) throw Errors.notFound('ویدیو پیدا نشد.');
  const videoId = video?.id ?? null;
  const { channelId } = scope;

  const daily: Daily = new Map();
  const [uniques, bucketUniques, devices, topSources, topVideos, cards] = await Promise.all([
    loadPeriodUniques(channelId, videoId, range),
    range.granularity === 'month' ? loadBucketUniques(channelId, videoId, range) : undefined,
    loadDevices(channelId, videoId, range),
    loadSources(channelId, videoId, range),
    videoId ? ([] as TopVideo[]) : loadTopVideos(channelId, range),
    loadCards(scope, videoId, now),
    // the series loaders fill `daily` (one scan per table over [previous.from, range.to))
    loadViewDays(channelId, videoId, range.previous.from, range.to, daily),
    loadLikeDays(channelId, videoId, range.previous.from, range.to, daily),
    loadCommentDays(channelId, videoId, range.previous.from, range.to, daily),
    // follows are a channel-level fact: there is no per-video attribution
    videoId ? undefined : loadFollowDays(channelId, range.previous.from, range.to, daily),
  ]);

  const current = sumDaily(daily, range.fromKey, range.toKey);
  const prior = sumDaily(daily, range.previous.fromKey, range.previous.toKey);
  const totals = totalsOf(current, uniques.current);
  const previous = totalsOf(prior, uniques.previous);

  return {
    video,
    range: {
      preset: range.preset,
      granularity: range.granularity,
      fromKey: range.fromKey,
      toKey: range.toKey,
      days: range.days,
      previous: { fromKey: range.previous.fromKey, toKey: range.previous.toKey, days: range.previous.days },
    },
    series: bucketize(range.buckets, daily, bucketUniques),
    totals,
    previous,
    changes: changesOf(totals, previous),
    cards,
    devices,
    sources: withOtherSources(topSources, totals.views),
    topVideos,
    data: {
      views: { real: current.views - current.seedViews, seed: current.seedViews },
      followEvents: {
        real: current.newFollowers + current.unfollows - current.seedFollowEvents,
        seed: current.seedFollowEvents,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Per-video table
// ---------------------------------------------------------------------------

const ORDER_EXPRESSIONS: Record<VideoSortKey, Prisma.Sql> = {
  views: Prisma.sql`coalesce(ve.views, 0)`,
  watch: Prisma.sql`coalesce(ve.watch, 0)`,
  avg: Prisma.sql`CASE WHEN coalesce(ve.views, 0) > 0 THEN ve.watch / ve.views ELSE 0 END`,
  likes: Prisma.sql`coalesce(lk.likes, 0)`,
  comments: Prisma.sql`coalesce(cm.comments, 0)`,
  published: Prisma.sql`v."publishedAt"`,
  title: Prisma.sql`v."title"`,
};

type VideoRow = {
  id: string;
  title: string;
  kind: VideoKind;
  posterKey: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  views: number;
  uniqueViewers: number;
  watchSeconds: number;
  likes: number;
  comments: number;
};

async function queryVideoPerformance(
  channelId: string,
  range: ResolvedRange,
  opts: { sort: VideoSortKey; dir: SortDirection; limit: number; offset: number },
): Promise<VideoPerformanceRow[]> {
  const order = ORDER_EXPRESSIONS[opts.sort];
  const direction = opts.dir === 'asc' ? Prisma.sql`ASC NULLS LAST` : Prisma.sql`DESC NULLS LAST`;
  const rows = await db.$queryRaw<VideoRow[]>`
    SELECT v."id", v."title", v."kind"::text AS kind, v."posterKey", v."durationSeconds", v."publishedAt",
           v."processingStatus"::text AS "processingStatus", v."publishStatus"::text AS "publishStatus", v."visibility"::text AS visibility,
           coalesce(ve.views, 0)::int AS views,
           coalesce(ve.uniques, 0)::int AS "uniqueViewers",
           coalesce(ve.watch, 0)::float8 AS "watchSeconds",
           coalesce(lk.likes, 0)::int AS likes,
           coalesce(cm.comments, 0)::int AS comments
    FROM "Video" v
    LEFT JOIN (
      SELECT e."videoId", count(*) AS views, count(DISTINCT e."viewerKey") AS uniques, sum(e."watchSeconds") AS watch
      FROM "ViewEvent" e
      WHERE e."channelId" = ${channelId}
        AND e."createdAt" >= ${utcBound(range.from)} AND e."createdAt" < ${utcBound(range.to)}
      GROUP BY e."videoId"
    ) ve ON ve."videoId" = v."id"
    LEFT JOIN (
      SELECT l."videoId", count(*) AS likes
      FROM "VideoLike" l JOIN "Video" lv ON lv."id" = l."videoId"
      WHERE lv."channelId" = ${channelId}
        AND l."createdAt" >= ${utcBound(range.from)} AND l."createdAt" < ${utcBound(range.to)}
      GROUP BY l."videoId"
    ) lk ON lk."videoId" = v."id"
    LEFT JOIN (
      SELECT c."videoId", count(*) AS comments
      FROM "Comment" c JOIN "Video" cv ON cv."id" = c."videoId"
      WHERE cv."channelId" = ${channelId} AND c."status" = 'APPROVED'
        AND c."createdAt" >= ${utcBound(range.from)} AND c."createdAt" < ${utcBound(range.to)}
      GROUP BY c."videoId"
    ) cm ON cm."videoId" = v."id"
    WHERE v."channelId" = ${channelId} AND v."processingStatus" <> 'AWAITING_UPLOAD'
    ORDER BY ${order} ${direction}, v."id"
    LIMIT ${opts.limit} OFFSET ${opts.offset}`;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    posterKey: r.posterKey,
    durationSeconds: r.durationSeconds,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    processingStatus: r.processingStatus,
    publishStatus: r.publishStatus,
    visibility: r.visibility,
    views: r.views,
    uniqueViewers: r.uniqueViewers,
    watchSeconds: r.watchSeconds,
    avgViewSeconds: average(r.watchSeconds, r.views),
    likes: r.likes,
    comments: r.comments,
  }));
}

const countVideos = (channelId: string) =>
  db.video.count({ where: { channelId, processingStatus: { not: 'AWAITING_UPLOAD' } } });

/** One page of the per-video performance table (offset pagination, deterministic order). */
export async function listVideoPerformance(
  channelId: string,
  range: ResolvedRange,
  opts: { sort?: VideoSortKey; dir?: SortDirection; page?: number; pageSize?: number } = {},
): Promise<VideoPerformancePage> {
  const pageSize = Math.min(Math.max(Math.trunc(opts.pageSize ?? 10), 1), 50);
  const total = await countVideos(channelId);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Math.trunc(opts.page ?? 1), 1), pageCount);
  const rows = await queryVideoPerformance(channelId, range, {
    sort: opts.sort ?? 'views',
    dir: opts.dir ?? 'desc',
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return { rows, total, page, pageSize, pageCount };
}

/** Every video of the channel (capped) for the CSV export. */
export const EXPORT_VIDEO_LIMIT = 5_000;
export async function listAllVideoPerformance(channelId: string, range: ResolvedRange): Promise<VideoPerformanceRow[]> {
  return queryVideoPerformance(channelId, range, { sort: 'views', dir: 'desc', limit: EXPORT_VIDEO_LIMIT, offset: 0 });
}
