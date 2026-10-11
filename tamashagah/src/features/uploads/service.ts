/**
 * Upload lifecycle on the server side (database part). Used by the tus hooks, by the "upload finished" confirmation
 * action and by the tests. Runtime-agnostic (no `next/*`).
 *
 *   createAwaitingUpload   POST            quota check + `Video(AWAITING_UPLOAD)`
 *   completeUpload         last PATCH      QUEUED + TranscodeJob + queue job (idempotent)
 *   discardUpload          DELETE / purge  row + files
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { buildVideoSearchFields } from '@/lib/persian';
import { enqueueVideoCleanup, enqueueVideoProcessing, VIDEO_JOB_ATTEMPTS } from '@/lib/queue';
import { getStorage, keys, type StorageDriver } from '@/lib/storage';
import { invalidateVideoAccess } from '@/features/videos/media-access';
import type { Visibility } from '@/generated/prisma/enums';
import { checkQuota, titleFromFilename, type UploadLimits } from './policy';

const log = logger.child({ module: 'uploads' });

export const readUploadLimits = (): UploadLimits => ({
  maxBytes: env.UPLOAD_MAX_BYTES,
  maxPerDay: env.UPLOAD_MAX_PER_DAY,
  dailyQuotaBytes: env.UPLOAD_DAILY_QUOTA_BYTES,
});

const DAY_MS = 24 * 3_600_000;

export type CreateUploadInput = {
  videoId: string;
  channelId: string;
  channelName: string;
  defaultVisibility: Visibility;
  filename: string;
  mime: string;
  size: number;
};

/**
 * Create the video record for a new upload, enforcing the DAILY quota (count and bytes of the videos this channel
 * created in the last 24 h) inside a transaction serialized per channel, so parallel uploads cannot overshoot it.
 */
export async function createAwaitingUpload(input: CreateUploadInput, limits: UploadLimits = readUploadLimits()): Promise<void> {
  const title = titleFromFilename(input.filename);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`upload:${input.channelId}`}, 0))`;
    const since = new Date(Date.now() - DAY_MS);
    const usage = await tx.video.aggregate({
      where: { channelId: input.channelId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { sourceSizeBytes: true },
    });
    const check = checkQuota({ count: usage._count._all, bytes: Number(usage._sum.sourceSizeBytes ?? 0n) }, input.size, limits);
    if (!check.ok) throw Errors.quotaExceeded(check.message);

    await tx.video.create({
      data: {
        id: input.videoId,
        channelId: input.channelId,
        title,
        processingStatus: 'AWAITING_UPLOAD',
        publishStatus: 'DRAFT',
        // New videos start with the channel's default visibility and are published as soon as they are ready.
        visibility: input.defaultVisibility,
        publishOnReady: true,
        originalFilename: input.filename,
        // Reserved up front so the quota sees it; replaced by the real size when the upload completes.
        sourceSizeBytes: BigInt(input.size),
        sourceMime: input.mime,
        ...buildVideoSearchFields({ title, channelName: input.channelName }),
      },
    });
  });
  log.info({ videoId: input.videoId, channelId: input.channelId, bytes: input.size }, 'upload created');
}

export type CompleteResult = 'queued' | 'already' | 'incomplete' | 'missing';

/**
 * The bytes are all there: move the video to QUEUED, create its TranscodeJob and enqueue processing.
 * Idempotent — called from the tus `onUploadFinish` hook AND from the client's "finished" confirmation (which heals
 * the case where the last response was lost); only the first call changes anything.
 */
export async function completeUpload(videoId: string, storage: StorageDriver = getStorage()): Promise<CompleteResult> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { processingStatus: true, sourceSizeBytes: true, sourceMime: true, originalFilename: true },
  });
  if (!video) return 'missing';
  if (video.processingStatus !== 'AWAITING_UPLOAD') return 'already';

  const sourceKey = keys.upload(videoId);
  const head = await storage.head(sourceKey);
  const declared = Number(video.sourceSizeBytes ?? 0n);
  // fs: the file exists from the first byte, so the size is what proves completeness; s3: the object only appears
  // when the multipart upload was completed.
  if (!head || head.size !== declared) return 'incomplete';

  const queued = await db.$transaction(async (tx) => {
    const { count } = await tx.video.updateMany({
      where: { id: videoId, processingStatus: 'AWAITING_UPLOAD' },
      data: { processingStatus: 'QUEUED', sourceKey, sourceSizeBytes: BigInt(head.size), failureReason: null },
    });
    if (count === 0) return null;
    // Keep an existing SOURCE row (it may already carry the creator's kind choice) and refresh its facts.
    const existing = await tx.mediaAsset.findFirst({ where: { videoId, kind: 'SOURCE', storageKey: sourceKey }, select: { id: true } });
    if (existing) {
      await tx.mediaAsset.update({ where: { id: existing.id }, data: { sizeBytes: BigInt(head.size), mimeType: video.sourceMime } });
    } else {
      await tx.mediaAsset.create({
        data: { videoId, kind: 'SOURCE', storageKey: sourceKey, mimeType: video.sourceMime, sizeBytes: BigInt(head.size), meta: { kindChoice: 'auto' } },
      });
    }
    return tx.transcodeJob.create({ data: { videoId, status: 'QUEUED', maxAttempts: VIDEO_JOB_ATTEMPTS }, select: { id: true } });
  });
  if (!queued) return 'already';

  invalidateVideoAccess(videoId);
  try {
    const queueJobId = await enqueueVideoProcessing(videoId);
    await db.transcodeJob.update({ where: { id: queued.id }, data: { queueJobId } });
  } catch (err) {
    // The video stays QUEUED; the maintenance job `video.requeue-orphans` enqueues it once Redis is back.
    log.error({ err, videoId }, 'could not enqueue processing; the requeue job will retry');
  }
  log.info({ videoId, bytes: head.size }, 'upload complete; queued for processing');
  return 'queued';
}

/** Cancel / abandon an unfinished upload: the row (only while it is still AWAITING_UPLOAD) and its files. */
export async function discardUpload(videoId: string): Promise<boolean> {
  const { count } = await db.video.deleteMany({ where: { id: videoId, processingStatus: 'AWAITING_UPLOAD' } });
  if (count === 0) return false;
  invalidateVideoAccess(videoId);
  await enqueueVideoCleanup(videoId).catch((err) => log.warn({ err, videoId }, 'could not enqueue cleanup'));
  return true;
}
