import 'server-only';
import { db } from '@/lib/db';
import { monetizationRequirements } from '@/config/site';
import { publicVideoWhere } from '@/features/videos/visibility';
import { trailingJalaliMonthBuckets } from '@/lib/analytics/ranges';
import { dayKeyToJalali } from '@/lib/analytics/time';
import { utcBound } from '@/features/analytics/sql';
import type { MonetizationStatus } from '@/generated/prisma/enums';

/**
 * Real numbers behind the monetization page. Everything that counts towards eligibility ignores synthetic rows
 * (`ViewEvent.source = 'SEED'`): a development seed must never make a channel look eligible. SEED rows are
 * reported separately (`sample*`) so the page can say so.
 */

export type MonetizationStats = {
  followers: number;
  /** READY + PUBLISHED + PUBLIC videos of a channel that is not suspended. */
  publicVideos: number;
  /** Watch hours of REAL view events in the last `windowDays` days. */
  watchHours: number;
  /** All-time REAL views. */
  totalViews: number;
  /** Hours / events of SEED rows inside the window that were NOT counted. */
  sampleWatchHours: number;
  sampleViewEvents: number;
  channelSuspended: boolean;
};

export async function getMonetizationStats(channelId: string, now: Date = new Date()): Promise<MonetizationStats> {
  const since = new Date(now.getTime() - monetizationRequirements.windowDays * 86_400_000);
  const [channel, publicVideos, [events]] = await Promise.all([
    db.channel.findUnique({ where: { id: channelId }, select: { followerCount: true, suspendedAt: true } }),
    db.video.count({ where: { channelId, ...publicVideoWhere } }),
    db.$queryRaw<{ watchSeconds: number; sampleSeconds: number; totalViews: number; sampleEvents: number }[]>`
      SELECT coalesce(sum(e."watchSeconds") FILTER (WHERE e."source" = 'REAL' AND e."createdAt" >= ${utcBound(since)} AND e."createdAt" <= ${utcBound(now)}), 0)::float8 AS "watchSeconds",
             coalesce(sum(e."watchSeconds") FILTER (WHERE e."source" = 'SEED' AND e."createdAt" >= ${utcBound(since)} AND e."createdAt" <= ${utcBound(now)}), 0)::float8 AS "sampleSeconds",
             (count(*) FILTER (WHERE e."source" = 'REAL'))::int AS "totalViews",
             (count(*) FILTER (WHERE e."source" = 'SEED' AND e."createdAt" >= ${utcBound(since)} AND e."createdAt" <= ${utcBound(now)}))::int AS "sampleEvents"
      FROM "ViewEvent" e
      WHERE e."channelId" = ${channelId}`,
  ]);
  return {
    followers: channel?.followerCount ?? 0,
    publicVideos,
    watchHours: (events?.watchSeconds ?? 0) / 3600,
    totalViews: events?.totalViews ?? 0,
    sampleWatchHours: (events?.sampleSeconds ?? 0) / 3600,
    sampleViewEvents: events?.sampleEvents ?? 0,
    channelSuspended: channel?.suspendedAt != null,
  };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export type StatsSnapshot = { followers: number; totalViews: number; watchHours: number; videoCount: number; capturedAt: string };

export type ApplicationView = {
  id: string;
  status: MonetizationStatus;
  contactEmail: string | null;
  /** ISO strings */
  acceptedTermsAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  decisionNote: string | null;
  snapshot: StatsSnapshot | null;
};

/** Defensive reader for `statsSnapshot` (a Json column the admin side may also read or write). */
export function parseSnapshot(value: unknown): StatsSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const followers = num(v.followers);
  const totalViews = num(v.totalViews);
  const watchHours = num(v.watchHours);
  const videoCount = num(v.videoCount);
  if (followers === null || totalViews === null || watchHours === null || videoCount === null) return null;
  return { followers, totalViews, watchHours, videoCount, capturedAt: typeof v.capturedAt === 'string' ? v.capturedAt : '' };
}

/** The channel's applications, newest first (history is never deleted). */
export async function listApplications(channelId: string): Promise<ApplicationView[]> {
  const rows = await db.monetizationApplication.findMany({
    where: { channelId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    contactEmail: row.contactEmail,
    acceptedTermsAt: row.acceptedTermsAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    decisionNote: row.decisionNote,
    snapshot: parseSnapshot(row.statsSnapshot),
  }));
}

// ---------------------------------------------------------------------------
// Monthly history
// ---------------------------------------------------------------------------

export type HistoryMonth = {
  /** `1405-07` */
  key: string;
  jy: number;
  jm: number;
  fromKey: string;
  toKey: string;
  views: number;
  watchHours: number;
  /** New followers minus unfollows (REAL events). */
  netFollowers: number;
  /** The current month is only partly over. */
  partial: boolean;
};

export type MonetizationHistory = {
  months: HistoryMonth[];
  /** SEED events inside the 12 months that are NOT part of the numbers. */
  sampleEvents: number;
};

/** Views, watch hours and net follower growth per Jalali month for the last 12 months (REAL data only). */
export async function getMonetizationHistory(channelId: string, now: Date = new Date(), monthCount = 12): Promise<MonetizationHistory> {
  const buckets = trailingJalaliMonthBuckets(monthCount, now);
  const keys = buckets.map((b) => b.key);
  const froms = buckets.map((b) => b.from.toISOString());
  const tos = buckets.map((b) => b.to.toISOString());

  const [views, follows] = await Promise.all([
    db.$queryRaw<{ key: string; views: number; watchSeconds: number; sampleViews: number }[]>`
      WITH b("key", "fromAt", "toAt") AS (SELECT * FROM unnest(${keys}::text[], ${froms}::timestamptz[], ${tos}::timestamptz[]))
      SELECT b."key" AS key,
             (count(e."id") FILTER (WHERE e."source" = 'REAL'))::int AS views,
             coalesce(sum(e."watchSeconds") FILTER (WHERE e."source" = 'REAL'), 0)::float8 AS "watchSeconds",
             (count(e."id") FILTER (WHERE e."source" = 'SEED'))::int AS "sampleViews"
      FROM b
      LEFT JOIN "ViewEvent" e
        ON e."channelId" = ${channelId}
       AND e."createdAt" >= (b."fromAt" AT TIME ZONE 'UTC') AND e."createdAt" < (b."toAt" AT TIME ZONE 'UTC')
      GROUP BY b."key"`,
    db.$queryRaw<{ key: string; net: number; sampleEvents: number }[]>`
      WITH b("key", "fromAt", "toAt") AS (SELECT * FROM unnest(${keys}::text[], ${froms}::timestamptz[], ${tos}::timestamptz[]))
      SELECT b."key" AS key,
             (count(f."id") FILTER (WHERE f."source" = 'REAL' AND f."type" = 'FOLLOW') - count(f."id") FILTER (WHERE f."source" = 'REAL' AND f."type" = 'UNFOLLOW'))::int AS net,
             (count(f."id") FILTER (WHERE f."source" = 'SEED'))::int AS "sampleEvents"
      FROM b
      LEFT JOIN "FollowEvent" f
        ON f."channelId" = ${channelId}
       AND f."createdAt" >= (b."fromAt" AT TIME ZONE 'UTC') AND f."createdAt" < (b."toAt" AT TIME ZONE 'UTC')
      GROUP BY b."key"`,
  ]);

  const viewsByKey = new Map(views.map((r) => [r.key, r]));
  const followsByKey = new Map(follows.map((r) => [r.key, r]));
  const lastIndex = buckets.length - 1;
  const months = buckets.map((bucket, index): HistoryMonth => {
    const { jy, jm } = dayKeyToJalali(bucket.fromKey);
    return {
      key: bucket.key,
      jy,
      jm,
      fromKey: bucket.fromKey,
      toKey: bucket.toKey,
      views: viewsByKey.get(bucket.key)?.views ?? 0,
      watchHours: (viewsByKey.get(bucket.key)?.watchSeconds ?? 0) / 3600,
      netFollowers: followsByKey.get(bucket.key)?.net ?? 0,
      partial: index === lastIndex,
    };
  });
  const sampleEvents = views.reduce((sum, r) => sum + r.sampleViews, 0) + follows.reduce((sum, r) => sum + r.sampleEvents, 0);
  return { months, sampleEvents };
}
