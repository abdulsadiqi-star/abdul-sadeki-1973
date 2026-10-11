/**
 * Housekeeping jobs of the `maintenance` queue (everything except publishing and counters):
 *
 *   purgeStaleUploads     AWAITING_UPLOAD videos older than UPLOAD_STALE_HOURS (abandoned uploads)
 *   purgeExpiredAuth      expired / revoked sessions and used / expired e-mail tokens
 *   cleanupVideoFiles     `video.cleanup`: delete `videos/<id>/` and `uploads/<id>*` of a deleted video
 *   requeueOrphans        QUEUED videos whose queue job vanished (e.g. Redis was down when the upload finished)
 *
 * All of them are idempotent and safe to run concurrently or twice.
 */
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { enqueueVideoCleanup, enqueueVideoProcessing, getQueue, VIDEO_JOB_ATTEMPTS } from '@/lib/queue';
import { removeAllVideoFiles } from '@/features/videos-studio/cleanup';

const log = logger.child({ module: 'worker', job: 'housekeeping' });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Abandoned uploads
// ---------------------------------------------------------------------------

export async function purgeStaleUploads(now: Date = new Date()): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - env.UPLOAD_STALE_HOURS * HOUR);
  let purged = 0;
  for (;;) {
    const stale = await db.video.findMany({
      where: { processingStatus: 'AWAITING_UPLOAD', createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    if (stale.length === 0) break;
    let progressed = 0;
    for (const { id } of stale) {
      // Delete the ROW first, guarded by the status: an upload that completed a moment ago is not touched.
      const { count } = await db.video.deleteMany({ where: { id, processingStatus: 'AWAITING_UPLOAD' } });
      if (count === 0) continue;
      progressed++;
      purged++;
      try {
        await removeAllVideoFiles(id);
      } catch (err) {
        // Storage hiccup: let the cleanup queue retry instead of leaking the files.
        log.warn({ err, videoId: id }, 'could not remove stale upload files now; scheduling cleanup');
        await enqueueVideoCleanup(id).catch(() => undefined);
      }
    }
    if (progressed === 0) break; // nothing deletable in this batch: avoid spinning
  }
  if (purged > 0) log.info({ purged, staleHours: env.UPLOAD_STALE_HOURS }, 'stale uploads purged');
  return { purged };
}

// ---------------------------------------------------------------------------
// Auth tables
// ---------------------------------------------------------------------------

export async function purgeExpiredAuth(now: Date = new Date()): Promise<{ sessions: number; emailTokens: number }> {
  const absoluteCutoff = new Date(now.getTime() - env.SESSION_ABSOLUTE_TTL_DAYS * DAY);
  const sessions = await db.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }, { createdAt: { lt: absoluteCutoff } }] },
  });
  // Expired tokens stay for a day so the UI can say "this link expired"; used tokens for a week (audit trail).
  const emailTokens = await db.emailToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - DAY) } }, { usedAt: { lt: new Date(now.getTime() - 7 * DAY) } }] },
  });
  if (sessions.count + emailTokens.count > 0) {
    log.info({ sessions: sessions.count, emailTokens: emailTokens.count }, 'expired auth rows purged');
  }
  return { sessions: sessions.count, emailTokens: emailTokens.count };
}

// ---------------------------------------------------------------------------
// video.cleanup
// ---------------------------------------------------------------------------

/** Delete the files of a video whose row is gone. A video that still exists is never touched. */
export async function cleanupVideoFiles(videoId: string): Promise<{ skipped: boolean }> {
  const exists = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (exists) {
    log.warn({ videoId }, 'cleanup requested for a video that still exists; skipped');
    return { skipped: true };
  }
  await removeAllVideoFiles(videoId);
  return { skipped: false };
}

// ---------------------------------------------------------------------------
// Orphaned queue jobs
// ---------------------------------------------------------------------------

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

/**
 * A video is QUEUED when its upload finished. If enqueueing failed at that moment (Redis down) or the job was
 * lost, nothing would ever process it. This job finds such videos and enqueues them again.
 */
export async function requeueOrphanedVideos(now: Date = new Date(), olderThanMs = 5 * 60_000): Promise<{ requeued: number }> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const candidates = await db.video.findMany({
    where: { processingStatus: 'QUEUED', updatedAt: { lt: cutoff } },
    orderBy: { updatedAt: 'asc' },
    take: 100,
    select: { id: true, jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, queueJobId: true } } },
  });

  let requeued = 0;
  const queue = getQueue('video');
  for (const video of candidates) {
    const job = video.jobs[0];
    if (job?.queueJobId) {
      const existing = await queue.getJob(job.queueJobId);
      const state = existing ? await existing.getState() : null;
      if (state && LIVE_STATES.has(state)) continue; // still on its way
    }
    const queueJobId = await enqueueVideoProcessing(video.id);
    if (job) await db.transcodeJob.update({ where: { id: job.id }, data: { queueJobId } });
    else await db.transcodeJob.create({ data: { videoId: video.id, status: 'QUEUED', queueJobId, maxAttempts: VIDEO_JOB_ATTEMPTS } });
    // Touch the row so the next run does not look at it again immediately.
    await db.video.update({ where: { id: video.id }, data: { updatedAt: new Date() } });
    requeued++;
  }
  if (requeued > 0) log.warn({ requeued }, 'orphaned queued videos were enqueued again');
  return { requeued };
}
