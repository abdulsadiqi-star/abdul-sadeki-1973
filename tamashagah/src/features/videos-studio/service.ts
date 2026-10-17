/**
 * Studio video management — the business rules behind the Server Actions and route handlers
 * (`actions.ts`, `app/api/studio/videos/**`). Runtime-agnostic: no `next/*`, no `server-only`, so it is
 * integration-tested directly against the database.
 *
 * Authorization: every function takes the `Actor` and re-derives access from the database
 * (`canManageVideo`: the channel owner or a moderator). Videos the actor may not manage are reported as
 * NOT_FOUND — their existence is never revealed.
 */
import { db, type Prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { randomToken } from '@/lib/ids';
import { processImage } from '@/lib/images';
import { logger } from '@/lib/logger';
import { buildVideoSearchFields } from '@/lib/persian';
import { isListedPublicly, ownsChannel, type Actor } from '@/lib/permissions';
import { enqueueVideoCleanup, enqueueVideoProcessing, VIDEO_JOB_ATTEMPTS } from '@/lib/queue';
import { getStorage, keys, type StorageDriver } from '@/lib/storage';
import { detectKind, type KindChoice } from '@/features/transcoding/kind';
import { invalidateVideoAccess } from '@/features/videos/media-access';
import { studioMessages } from './labels';
import { computePublishUpdate, fanOutNewVideo } from './publishing';
import type { VideoMetadata } from './schemas';
import { prepareSubtitle, SubtitleError } from './subtitles';
import { removeUploadFiles } from './cleanup';

const log = logger.child({ module: 'studio' });

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MAX_SUBTITLES_PER_VIDEO = 10;
const DAY_MS = 86_400_000;

const managedSelect = {
  id: true,
  channelId: true,
  title: true,
  description: true,
  tags: true,
  categoryId: true,
  language: true,
  kind: true,
  processingStatus: true,
  publishStatus: true,
  visibility: true,
  publishOnReady: true,
  publishedAt: true,
  scheduledFor: true,
  commentsEnabled: true,
  ageRestricted: true,
  width: true,
  height: true,
  durationSeconds: true,
  sourceKey: true,
  posterKey: true,
  takedownAt: true,
  channel: { select: { name: true, ownerId: true, suspendedAt: true } },
} satisfies Prisma.VideoSelect;

type ManagedVideo = Prisma.VideoGetPayload<{ select: typeof managedSelect }>;

/** Load a video the actor may manage, or throw NOT_FOUND (never 403: existence must not leak). */
export async function loadManagedVideo(actor: Actor, videoId: string): Promise<ManagedVideo> {
  const video = await db.video.findUnique({ where: { id: videoId }, select: managedSelect });
  // Owner only: moderators act through the staff panel (policy matrix + audit row), never through studio mutations.
  if (!video || !ownsChannel(actor, video.channelId)) throw Errors.notFound(studioMessages.notFound);
  return video;
}

const isPubliclyListed = (v: Pick<ManagedVideo, 'visibility' | 'publishStatus' | 'processingStatus' | 'takedownAt' | 'channelId'> & { channel: { suspendedAt: Date | null } }) =>
  isListedPublicly({
    channelId: v.channelId,
    visibility: v.visibility,
    publishStatus: v.publishStatus,
    processingStatus: v.processingStatus,
    takedownAt: v.takedownAt,
    channelSuspendedAt: v.channel.suspendedAt,
  });

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export type UpdateResult = {
  id: string;
  publishStatus: ManagedVideo['publishStatus'];
  visibility: ManagedVideo['visibility'];
  kind: ManagedVideo['kind'];
  scheduledFor: string | null;
  publishedAt: string | null;
};

export async function updateVideoMetadata(actor: Actor, videoId: string, meta: VideoMetadata, now: Date = new Date()): Promise<UpdateResult> {
  await loadManagedVideo(actor, videoId); // fail fast (and uniformly) before doing any other work

  if (meta.categoryId) {
    const category = await db.category.findFirst({ where: { id: meta.categoryId, isActive: true }, select: { id: true } });
    if (!category) throw Errors.validation({ categoryId: [studioMessages.categoryInvalid] });
  }

  const result = await db.$transaction(async (tx) => {
    // Same row lock the worker takes when it finishes processing: a save that races with "READY" must not
    // overwrite the publish decision with a stale view of the video.
    await tx.$queryRaw`SELECT "id" FROM "Video" WHERE "id" = ${videoId} FOR UPDATE`;
    const video = await tx.video.findUnique({ where: { id: videoId }, select: managedSelect });
    if (!video) throw Errors.notFound(studioMessages.notFound);

    let scheduledFor: Date | null = null;
    if (meta.publishMode === 'SCHEDULE') {
      scheduledFor = meta.scheduledFor ?? null;
      if (!scheduledFor) throw Errors.validation({ scheduledFor: [studioMessages.scheduleRequired] });
      const unchanged = video.scheduledFor !== null && Math.abs(video.scheduledFor.getTime() - scheduledFor.getTime()) < 1_000;
      if (!unchanged && scheduledFor.getTime() <= now.getTime()) throw Errors.validation({ scheduledFor: [studioMessages.scheduleInPast] });
      if (scheduledFor.getTime() > now.getTime() + 366 * DAY_MS) throw Errors.validation({ scheduledFor: [studioMessages.scheduleTooFar] });
    }
    const publish = computePublishUpdate(video, { mode: meta.publishMode, scheduledFor }, now);

    // Kind: an explicit choice wins; "auto" re-runs detection when the dimensions are known.
    const choice: KindChoice = meta.kindChoice;
    let kind = video.kind;
    if (choice === 'VIDEO' || choice === 'SHORT') kind = choice;
    else if (video.processingStatus === 'READY' && video.width && video.height && video.durationSeconds) {
      kind = detectKind({ width: video.width, height: video.height, durationSeconds: video.durationSeconds });
    }
    if (video.processingStatus !== 'READY') await rememberKindChoice(tx, videoId, choice);

    const search = buildVideoSearchFields({
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      channelName: video.channel.name,
    });
    const updated = await tx.video.update({
      where: { id: videoId },
      data: {
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: meta.categoryId,
        visibility: meta.visibility,
        commentsEnabled: meta.commentsEnabled,
        ...(meta.language ? { language: meta.language } : {}),
        ...(meta.ageRestricted !== undefined ? { ageRestricted: meta.ageRestricted } : {}),
        kind,
        publishOnReady: publish.publishOnReady,
        publishStatus: publish.publishStatus,
        publishedAt: publish.publishedAt,
        scheduledFor: publish.scheduledFor,
        ...search,
      },
      select: managedSelect,
    });
    return { updated, wasListed: isPubliclyListed(video) };
  });

  invalidateVideoAccess(videoId);
  // Went (or stayed) public through this save: announce it to followers once.
  if (isPubliclyListed(result.updated) && !result.wasListed) {
    await fanOutNewVideo(videoId).catch((err) => log.error({ err, videoId }, 'new-video fan-out failed'));
  }
  const v = result.updated;
  return {
    id: v.id,
    publishStatus: v.publishStatus,
    visibility: v.visibility,
    kind: v.kind,
    scheduledFor: v.scheduledFor?.toISOString() ?? null,
    publishedAt: v.publishedAt?.toISOString() ?? null,
  };
}

/** The creator's kind choice must survive until processing finishes: it lives on the video's SOURCE asset. */
async function rememberKindChoice(tx: Prisma.TransactionClient, videoId: string, choice: KindChoice): Promise<void> {
  const storageKey = keys.upload(videoId);
  const existing = await tx.mediaAsset.findFirst({ where: { videoId, kind: 'SOURCE', storageKey }, select: { id: true, meta: true } });
  const meta = { ...((existing?.meta as Record<string, unknown> | null) ?? {}), kindChoice: choice };
  if (existing) await tx.mediaAsset.update({ where: { id: existing.id }, data: { meta } });
  else await tx.mediaAsset.create({ data: { videoId, kind: 'SOURCE', storageKey, meta } });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Hard delete: the rows go immediately (comments, likes, assets, jobs cascade), the files are removed by a
 * `video.cleanup` job. A second, delayed pass catches bytes of an upload or transcode that was still in flight.
 */
export async function deleteVideo(actor: Actor, videoId: string): Promise<void> {
  const video = await loadManagedVideo(actor, videoId);
  await db.video.delete({ where: { id: videoId } });
  invalidateVideoAccess(videoId);
  const inFlight = video.processingStatus !== 'READY' && video.processingStatus !== 'FAILED';
  try {
    await enqueueVideoCleanup(videoId);
    if (inFlight) await enqueueVideoCleanup(videoId, { delayMs: 30 * 60_000 });
  } catch (err) {
    // The row is gone either way; try to remove the files right now when the queue is unavailable.
    log.warn({ err, videoId }, 'could not enqueue cleanup; removing files inline');
    await removeFilesInline(videoId);
  }
}

async function removeFilesInline(videoId: string, storage: StorageDriver = getStorage()): Promise<void> {
  await storage.deletePrefix(keys.videoPrefix(videoId)).catch((err) => log.error({ err, videoId }, 'inline cleanup failed'));
  await removeUploadFiles(videoId, storage).catch((err) => log.error({ err, videoId }, 'inline cleanup failed'));
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export async function retryProcessing(actor: Actor, videoId: string): Promise<{ queued: true }> {
  const video = await loadManagedVideo(actor, videoId);
  if (video.processingStatus !== 'FAILED') throw Errors.conflict('فقط پردازش ناموفق را می‌توان دوباره امتحان کرد.');
  const sourceKey = video.sourceKey ?? keys.upload(videoId);
  const head = await getStorage().head(sourceKey);
  if (!head) throw Errors.badRequest(studioMessages.sourceGone);

  const job = await db.$transaction(async (tx) => {
    const { count } = await tx.video.updateMany({
      where: { id: videoId, processingStatus: 'FAILED' },
      data: { processingStatus: 'QUEUED', failureReason: null, sourceKey },
    });
    if (count === 0) return null;
    return tx.transcodeJob.create({ data: { videoId, status: 'QUEUED', maxAttempts: VIDEO_JOB_ATTEMPTS }, select: { id: true } });
  });
  if (!job) throw Errors.conflict('پردازش این ویدیو در حال انجام است.');
  invalidateVideoAccess(videoId);
  try {
    const queueJobId = await enqueueVideoProcessing(videoId);
    await db.transcodeJob.update({ where: { id: job.id }, data: { queueJobId } });
  } catch (err) {
    log.error({ err, videoId }, 'could not enqueue the retry; the requeue job will pick it up');
  }
  return { queued: true };
}

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

export type BulkRequest =
  | { action: 'publish'; ids: string[] }
  | { action: 'visibility'; ids: string[]; visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' }
  | { action: 'delete'; ids: string[] };

export type BulkResult = { done: string[]; skipped: { id: string; reason: string }[] };

/**
 * Apply one operation to many of the actor's OWN videos. Ids that are not the actor's (or do not exist) are
 * reported as skipped with the same message — a caller cannot tell the two apart.
 */
export async function bulkUpdateVideos(actor: Actor, request: BulkRequest, now: Date = new Date()): Promise<BulkResult> {
  const channelId = actor?.channelId;
  if (!actor || !channelId) throw Errors.forbidden('برای این کار ابتدا باید کانال بسازید.');
  const ids = [...new Set(request.ids)];
  const rows = await db.video.findMany({ where: { id: { in: ids }, channelId }, select: managedSelect });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const result: BulkResult = { done: [], skipped: [] };

  for (const id of ids) {
    const video = byId.get(id);
    if (!video) {
      result.skipped.push({ id, reason: studioMessages.notFound });
      continue;
    }
    try {
      if (request.action === 'delete') {
        await deleteVideo(actor, id);
      } else if (request.action === 'visibility') {
        if (video.visibility !== request.visibility) {
          await db.video.update({ where: { id }, data: { visibility: request.visibility } });
          invalidateVideoAccess(id);
          const after = { ...video, visibility: request.visibility };
          if (isPubliclyListed(after) && !isPubliclyListed(video)) await fanOutNewVideo(id);
        }
      } else {
        if (video.processingStatus !== 'READY') {
          result.skipped.push({ id, reason: studioMessages.notReady });
          continue;
        }
        if (video.publishStatus === 'PUBLISHED') {
          result.skipped.push({ id, reason: 'قبلاً منتشر شده است.' });
          continue;
        }
        const update = computePublishUpdate(video, { mode: 'PUBLISH' }, now);
        await db.video.update({
          where: { id },
          data: { publishOnReady: update.publishOnReady, publishStatus: update.publishStatus, publishedAt: update.publishedAt, scheduledFor: update.scheduledFor },
        });
        invalidateVideoAccess(id);
        await fanOutNewVideo(id);
      }
      result.done.push(id);
    } catch (err) {
      log.error({ err, videoId: id, action: request.action }, 'bulk operation failed for a video');
      result.skipped.push({ id, reason: 'انجام این کار برای این ویدیو ممکن نشد.' });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

async function replacePoster(videoId: string, newKey: string, meta: Prisma.InputJsonValue, dims: { width: number; height: number }): Promise<string | null> {
  const old = await db.$transaction(async (tx) => {
    const current = await tx.video.findUnique({ where: { id: videoId }, select: { posterKey: true } });
    if (!current) throw Errors.notFound(studioMessages.notFound);
    await tx.mediaAsset.deleteMany({ where: { videoId, kind: 'POSTER' } });
    await tx.mediaAsset.create({
      data: { videoId, kind: 'POSTER', storageKey: newKey, mimeType: 'image/jpeg', width: dims.width, height: dims.height, isDefault: true, meta },
    });
    await tx.video.update({ where: { id: videoId }, data: { posterKey: newKey } });
    return current.posterKey;
  });
  invalidateVideoAccess(videoId);
  return old;
}

/** Delete a replaced poster object (never one of the generated candidates, which stay selectable). */
async function dropOldPoster(storage: StorageDriver, oldKey: string | null, newKey: string): Promise<void> {
  if (!oldKey || oldKey === newKey || !/\/thumbs\/poster_[A-Za-z0-9_-]+\.jpg$/.test(oldKey)) return;
  await storage.delete(oldKey).catch((err) => log.warn({ err, key: oldKey }, 'could not delete the replaced poster'));
}

function requireReady(video: ManagedVideo): void {
  if (video.processingStatus !== 'READY') throw Errors.conflict(studioMessages.notReady);
}

/** Use one of the generated candidate frames (1..3) as the poster. */
export async function chooseThumbnail(actor: Actor, videoId: string, index: number): Promise<{ posterKey: string }> {
  const video = await loadManagedVideo(actor, videoId);
  requireReady(video);
  const candidate = await db.mediaAsset.findFirst({
    where: { videoId, kind: 'THUMBNAIL', label: String(index) },
    select: { storageKey: true, width: true, height: true },
  });
  if (!candidate) throw Errors.notFound('این تصویر پیدا نشد.');

  const storage = getStorage();
  const object = await storage.get(candidate.storageKey);
  if (!object) throw Errors.notFound('فایل این تصویر پیدا نشد.');
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk as Uint8Array));
  const posterKey = keys.poster(videoId, randomToken(9));
  await storage.put(posterKey, Buffer.concat(chunks), { contentType: 'image/jpeg', cacheControl: IMMUTABLE });
  const old = await replacePoster(videoId, posterKey, { source: 'auto', index }, { width: candidate.width ?? 0, height: candidate.height ?? 0 });
  await dropOldPoster(storage, old, posterKey);
  return { posterKey };
}

/** Replace the poster with the creator's own image (decoded, cropped, re-encoded: the original bytes are never stored). */
export async function setCustomThumbnail(actor: Actor, videoId: string, image: Buffer): Promise<{ posterKey: string }> {
  const video = await loadManagedVideo(actor, videoId);
  requireReady(video);
  const portrait = (video.height ?? 0) > (video.width ?? 0);
  const processed = await processImage(image, {
    width: portrait ? 720 : 1280,
    height: portrait ? 1280 : 720,
    fit: 'cover',
    format: 'jpeg',
    quality: 86,
  });
  const storage = getStorage();
  const posterKey = keys.poster(videoId, randomToken(9));
  await storage.put(posterKey, processed.data, { contentType: 'image/jpeg', cacheControl: IMMUTABLE });
  const old = await replacePoster(videoId, posterKey, { source: 'custom' }, { width: processed.width, height: processed.height });
  await dropOldPoster(storage, old, posterKey);
  return { posterKey };
}

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

export type SubtitleDto = { id: string; language: string; label: string; isDefault: boolean; cues: number | null; url: string };

/** Upload a `.srt` / `.vtt` file. SRT is converted to WebVTT here; one subtitle per language (re-uploading replaces it). */
export async function addSubtitle(
  actor: Actor,
  videoId: string,
  input: { language: string; label: string; bytes: Uint8Array },
): Promise<{ id: string; cues: number }> {
  await loadManagedVideo(actor, videoId);
  let prepared;
  try {
    prepared = prepareSubtitle(input.bytes);
  } catch (err) {
    if (err instanceof SubtitleError) throw Errors.validation({ file: [err.message] }, err.message);
    throw err;
  }

  const storageKey = keys.subtitle(videoId, input.language);
  const existing = await db.mediaAsset.findMany({ where: { videoId, kind: 'SUBTITLE' }, select: { id: true, storageKey: true, isDefault: true } });
  const replacing = existing.find((a) => a.storageKey === storageKey);
  if (!replacing && existing.length >= MAX_SUBTITLES_PER_VIDEO) {
    throw Errors.conflict(`حداکثر ${MAX_SUBTITLES_PER_VIDEO} زیرنویس برای هر ویدیو مجاز است.`);
  }

  const body = Buffer.from(prepared.vtt, 'utf8');
  await getStorage().put(storageKey, body, { contentType: 'text/vtt; charset=utf-8', cacheControl: 'public, max-age=60' });
  const data = {
    mimeType: 'text/vtt',
    sizeBytes: BigInt(body.byteLength),
    language: input.language,
    label: input.label,
    meta: { cues: prepared.cues, source: prepared.source },
  };
  const asset = replacing
    ? await db.mediaAsset.update({ where: { id: replacing.id }, data, select: { id: true } })
    : await db.mediaAsset.create({
        // the first subtitle of a video becomes the default one
        data: { videoId, kind: 'SUBTITLE', storageKey, isDefault: existing.length === 0, ...data },
        select: { id: true },
      });
  return { id: asset.id, cues: prepared.cues };
}

export async function removeSubtitle(actor: Actor, videoId: string, assetId: string): Promise<void> {
  await loadManagedVideo(actor, videoId);
  const asset = await db.mediaAsset.findFirst({ where: { id: assetId, videoId, kind: 'SUBTITLE' }, select: { id: true, storageKey: true, isDefault: true } });
  if (!asset) throw Errors.notFound('این زیرنویس پیدا نشد.');
  await db.mediaAsset.delete({ where: { id: asset.id } });
  await getStorage().delete(asset.storageKey).catch((err) => log.warn({ err, key: asset.storageKey }, 'could not delete the subtitle file'));
  if (asset.isDefault) {
    const next = await db.mediaAsset.findFirst({ where: { videoId, kind: 'SUBTITLE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (next) await db.mediaAsset.update({ where: { id: next.id }, data: { isDefault: true } });
  }
}

