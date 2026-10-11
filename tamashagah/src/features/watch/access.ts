/**
 * One place that answers "may this actor touch this video, and what do we need to know about it?".
 *
 * Used by the view/heartbeat endpoints, comments, reports and playlists so every entry point applies the same
 * rule: anything the actor may not see is a plain 404 (never 403), so private/draft/taken-down videos cannot be
 * probed. Runtime-agnostic (no next/* imports).
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { canViewVideo, type Actor, type VideoAccessInfo } from '@/lib/permissions';
import type { Prisma } from '@/generated/prisma/client';

export const viewableVideoSelect = {
  id: true,
  title: true,
  channelId: true,
  durationSeconds: true,
  commentsEnabled: true,
  commentCount: true,
  visibility: true,
  publishStatus: true,
  processingStatus: true,
  takedownAt: true,
  channel: { select: { id: true, ownerId: true, name: true, handle: true, commentsMode: true, suspendedAt: true } },
} satisfies Prisma.VideoSelect;

export type ViewableVideoRow = Prisma.VideoGetPayload<{ select: typeof viewableVideoSelect }>;

export type ViewableVideo = ViewableVideoRow & {
  /** True when anybody with the link may watch it (public views / public comments). */
  publiclyWatchable: boolean;
};

export function accessInfoOf(row: Pick<ViewableVideoRow, 'channelId' | 'visibility' | 'publishStatus' | 'processingStatus' | 'takedownAt'> & { channel: { suspendedAt: Date | null } }): VideoAccessInfo {
  return {
    channelId: row.channelId,
    visibility: row.visibility,
    publishStatus: row.publishStatus,
    processingStatus: row.processingStatus,
    takedownAt: row.takedownAt,
    channelSuspendedAt: row.channel.suspendedAt,
  };
}

/** Load a video the actor may see, or throw NOT_FOUND (also when it simply does not exist). */
export async function loadViewableVideo(videoId: string, actor: Actor): Promise<ViewableVideo> {
  const row = await db.video.findUnique({ where: { id: videoId }, select: viewableVideoSelect });
  if (!row) throw Errors.notFound('ویدیو پیدا نشد.');
  const access = accessInfoOf(row);
  if (!canViewVideo(actor, access)) throw Errors.notFound('ویدیو پیدا نشد.');
  return { ...row, publiclyWatchable: canViewVideo(null, access) };
}
