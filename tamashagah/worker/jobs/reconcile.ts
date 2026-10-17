/**
 * Nightly reconciliation of the denormalized counters. They are updated transactionally next to the rows they
 * summarize, so drift should be rare — this job recomputes them from the source rows and fixes (and reports) any
 * difference:
 *
 *   Video.likeCount        = number of VideoLike rows
 *   Video.commentCount     = number of APPROVED comments (top-level + replies)
 *   Video.viewCount        = number of ViewEvent rows
 *   Comment.replyCount     = number of APPROVED replies in the thread (rootId = this comment)
 *   Channel.followerCount  = number of Follow rows
 *
 * Each counter is ONE set-based UPDATE that only touches rows whose value is wrong. A like landing between the
 * aggregate and the update can be off by one until the next run — acceptable for a safety net.
 */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'worker', job: 'reconcile' });

export type ReconcileReport = {
  videoLikes: number;
  videoComments: number;
  videoViews: number;
  commentReplies: number;
  channelFollowers: number;
};

export async function reconcileCounters(): Promise<ReconcileReport> {
  const videoLikes = await db.$executeRaw`
    UPDATE "Video" v SET "likeCount" = s.cnt
    FROM (
      SELECT v2."id", COALESCE(l.cnt, 0)::int AS cnt
      FROM "Video" v2
      LEFT JOIN (SELECT "videoId", count(*)::int AS cnt FROM "VideoLike" GROUP BY "videoId") l ON l."videoId" = v2."id"
    ) s
    WHERE v."id" = s."id" AND v."likeCount" <> s.cnt`;

  const videoComments = await db.$executeRaw`
    UPDATE "Video" v SET "commentCount" = s.cnt
    FROM (
      SELECT v2."id", COALESCE(c.cnt, 0)::int AS cnt
      FROM "Video" v2
      LEFT JOIN (
        SELECT "videoId", count(*)::int AS cnt FROM "Comment" WHERE "status" = 'APPROVED' GROUP BY "videoId"
      ) c ON c."videoId" = v2."id"
    ) s
    WHERE v."id" = s."id" AND v."commentCount" <> s.cnt`;

  const videoViews = await db.$executeRaw`
    UPDATE "Video" v SET "viewCount" = s.cnt
    FROM (
      SELECT v2."id", COALESCE(e.cnt, 0)::int AS cnt
      FROM "Video" v2
      LEFT JOIN (SELECT "videoId", count(*)::int AS cnt FROM "ViewEvent" GROUP BY "videoId") e ON e."videoId" = v2."id"
    ) s
    WHERE v."id" = s."id" AND v."viewCount" <> s.cnt`;

  const commentReplies = await db.$executeRaw`
    UPDATE "Comment" c SET "replyCount" = s.cnt
    FROM (
      SELECT c2."id", COALESCE(r.cnt, 0)::int AS cnt
      FROM "Comment" c2
      LEFT JOIN (
        SELECT "rootId", count(*)::int AS cnt FROM "Comment"
        WHERE "status" = 'APPROVED' AND "rootId" IS NOT NULL GROUP BY "rootId"
      ) r ON r."rootId" = c2."id"
    ) s
    WHERE c."id" = s."id" AND c."replyCount" <> s.cnt`;

  const channelFollowers = await db.$executeRaw`
    UPDATE "Channel" ch SET "followerCount" = s.cnt
    FROM (
      SELECT ch2."id", COALESCE(f.cnt, 0)::int AS cnt
      FROM "Channel" ch2
      LEFT JOIN (SELECT "channelId", count(*)::int AS cnt FROM "Follow" GROUP BY "channelId") f ON f."channelId" = ch2."id"
    ) s
    WHERE ch."id" = s."id" AND ch."followerCount" <> s.cnt`;

  const report: ReconcileReport = { videoLikes, videoComments, videoViews, commentReplies, channelFollowers };
  const corrected = Object.values(report).reduce((a, b) => a + b, 0);
  if (corrected > 0) log.warn({ ...report }, 'counters were out of sync and have been corrected');
  else log.info('counters are consistent');
  return report;
}
