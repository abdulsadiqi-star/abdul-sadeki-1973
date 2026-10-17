'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireChannelUser } from '@/lib/auth/guards';
import { toActor } from '@/lib/auth/session';
import { mediaUrl } from '@/lib/media-url';
import { ownsChannel } from '@/lib/permissions';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { uploadLimits } from '@/features/uploads/limits';
import { completeUpload, type CompleteResult } from '@/features/uploads/service';
import { studioLimits } from './limits';
import {
  bulkVideosSchema,
  deleteSubtitleSchema,
  selectThumbnailSchema,
  updateVideoSchema,
  videoRefSchema,
} from './schemas';
import {
  bulkUpdateVideos,
  chooseThumbnail,
  deleteVideo,
  removeSubtitle,
  retryProcessing,
  updateVideoMetadata,
  type BulkResult,
  type UpdateResult,
} from './service';

/**
 * Server Actions of the studio video features. Every one:
 *   1. requires a signed-in user WITH a channel (`requireChannelUser`)
 *   2. validates its input with Zod
 *   3. is rate limited per user
 *   4. re-checks ownership against the database inside the service (`canManageVideo`) — ids from the client are
 *      never trusted, and videos the user may not manage are reported as "not found"
 */

function refresh(id?: string) {
  revalidatePath('/studio/videos');
  if (id) revalidatePath(`/studio/videos/${id}/edit`);
}

export async function updateVideoAction(input: unknown): Promise<ActionResult<UpdateResult>> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const data = parse(updateVideoSchema, input);
    await enforceRateLimit('studio:write', user.id, studioLimits.write);
    const result = await updateVideoMetadata(toActor(user), data.id, data.metadata);
    refresh(data.id);
    return result;
  });
}

export async function deleteVideoAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const { id } = parse(videoRefSchema, input);
    await enforceRateLimit('studio:write', user.id, studioLimits.write);
    await deleteVideo(toActor(user), id);
    refresh();
  });
}

export async function retryProcessingAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const { id } = parse(videoRefSchema, input);
    await enforceRateLimit('studio:retry', user.id, studioLimits.retry);
    await retryProcessing(toActor(user), id);
    refresh(id);
  });
}

export async function bulkVideosAction(input: unknown): Promise<ActionResult<BulkResult>> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const data = parse(bulkVideosSchema, input);
    await enforceRateLimit('studio:bulk', user.id, studioLimits.bulk);
    const result = await bulkUpdateVideos(toActor(user), data);
    refresh();
    return result;
  });
}

/**
 * The browser finished sending the file. Normally the tus server already queued the video from its own hook; this
 * confirmation makes the transition certain even when the final response was lost (idempotent).
 */
export async function confirmUploadAction(input: unknown): Promise<ActionResult<{ status: CompleteResult }>> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const { id } = parse(videoRefSchema, input);
    await enforceRateLimit('upload:confirm', user.id, uploadLimits.confirm);
    // Strict ownership: moderators cannot complete somebody else's upload.
    const video = await db.video.findUnique({ where: { id }, select: { channelId: true } });
    if (!video || !ownsChannel(toActor(user), video.channelId)) throw Errors.notFound();
    const status = await completeUpload(id);
    if (status === 'queued') refresh(id);
    return { status };
  });
}

export async function selectThumbnailAction(input: unknown): Promise<ActionResult<{ posterUrl: string }>> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const { id, index } = parse(selectThumbnailSchema, input);
    await enforceRateLimit('studio:media', user.id, studioLimits.media);
    const { posterKey } = await chooseThumbnail(toActor(user), id, index);
    refresh(id);
    return { posterUrl: mediaUrl(posterKey)! };
  });
}

export async function deleteSubtitleAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const { id, assetId } = parse(deleteSubtitleSchema, input);
    await enforceRateLimit('studio:media', user.id, studioLimits.media);
    await removeSubtitle(toActor(user), id, assetId);
    refresh(id);
  });
}
