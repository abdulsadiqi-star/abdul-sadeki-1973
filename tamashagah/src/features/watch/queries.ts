import 'server-only';
import { cache } from 'react';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { hlsMasterUrl, mediaUrl } from '@/lib/media-url';
import { canManageVideo, canViewVideo, isModerator, ownsChannel, type VideoAccessInfo } from '@/lib/permissions';
import type { CommentsMode, ProcessingStatus, PublishStatus, VideoKind, Visibility } from '@/generated/prisma/enums';
import { resumePositionFor } from './view-rules';

export type WatchSubtitle = { id: string; lang: string; label: string; src: string; isDefault: boolean };

export type WatchVideo = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  kind: VideoKind;
  language: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  takedownAt: string | null;
  /** Only filled for the owner and moderators. */
  takedownReason: string | null;
  failureReason: string | null;
  commentsEnabled: boolean;
  commentsMode: CommentsMode;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  /** ISO string (publishedAt, falling back to createdAt). */
  publishedAt: string;
  posterUrl: string | null;
  /** Master playlist URL the player loads. */
  hlsUrl: string;
  category: { slug: string; nameFa: string } | null;
  channel: {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string | null;
    isVerified: boolean;
    followerCount: number;
    ownerId: string;
  };
  subtitles: WatchSubtitle[];
  /** Why the current viewer sees what they see. */
  access: {
    isOwner: boolean;
    isModerator: boolean;
    /** Anybody with the link could watch it right now (READY, published, not taken down, PUBLIC/UNLISTED). */
    publiclyWatchable: boolean;
    /** Eligible for Google-style indexing: public + listed. */
    listed: boolean;
  };
};

/**
 * Load a video for the watch page, or `null` when the current viewer may not see it at all — private, draft,
 * scheduled, taken-down, unfinished and unknown videos are indistinguishable (the page answers 404 for all of
 * them, so nothing leaks). Memoized per request, so `generateMetadata` and the page share one query.
 */
export const getWatchVideo = cache(async (id: string): Promise<WatchVideo | null> => {
  const user = await getCurrentUser();
  const actor = toActor(user);

  const row = await db.video.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      tags: true,
      kind: true,
      language: true,
      durationSeconds: true,
      width: true,
      height: true,
      processingStatus: true,
      publishStatus: true,
      visibility: true,
      takedownAt: true,
      takedownReason: true,
      failureReason: true,
      commentsEnabled: true,
      viewCount: true,
      likeCount: true,
      commentCount: true,
      publishedAt: true,
      createdAt: true,
      posterKey: true,
      hlsMasterKey: true,
      channelId: true,
      category: { select: { slug: true, nameFa: true } },
      channel: {
        select: { id: true, handle: true, name: true, avatarKey: true, isVerified: true, followerCount: true, ownerId: true, commentsMode: true, suspendedAt: true },
      },
      assets: {
        where: { kind: 'SUBTITLE' },
        orderBy: [{ isDefault: 'desc' }, { language: 'asc' }, { id: 'asc' }],
        select: { id: true, storageKey: true, language: true, label: true, isDefault: true },
      },
    },
  });
  if (!row) return null;

  const access: VideoAccessInfo = {
    channelId: row.channelId,
    visibility: row.visibility,
    publishStatus: row.publishStatus,
    processingStatus: row.processingStatus,
    takedownAt: row.takedownAt,
    channelSuspendedAt: row.channel.suspendedAt,
  };
  if (!canViewVideo(actor, access)) return null;

  const staff = canManageVideo(actor, access);
  const publiclyWatchable = canViewVideo(null, access);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags: row.tags,
    kind: row.kind,
    language: row.language,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    processingStatus: row.processingStatus,
    publishStatus: row.publishStatus,
    visibility: row.visibility,
    takedownAt: row.takedownAt?.toISOString() ?? null,
    takedownReason: staff ? row.takedownReason : null,
    failureReason: staff ? row.failureReason : null,
    commentsEnabled: row.commentsEnabled,
    commentsMode: row.channel.commentsMode,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    posterUrl: mediaUrl(row.posterKey),
    // The pipeline writes the master playlist to the documented location; use the stored key when present.
    hlsUrl: mediaUrl(row.hlsMasterKey) ?? hlsMasterUrl(row.id),
    category: row.category,
    channel: {
      id: row.channel.id,
      handle: row.channel.handle,
      name: row.channel.name,
      avatarUrl: mediaUrl(row.channel.avatarKey),
      isVerified: row.channel.isVerified,
      followerCount: row.channel.followerCount,
      ownerId: row.channel.ownerId,
    },
    // Only WebVTT tracks are playable (the media route serves `subs/<lang>.vtt`).
    subtitles: row.assets.flatMap((a) => {
      const src = a.storageKey.endsWith('.vtt') ? mediaUrl(a.storageKey) : null;
      return src ? [{ id: a.id, lang: a.language ?? 'und', label: a.label ?? a.language ?? 'زیرنویس', src, isDefault: a.isDefault }] : [];
    }),
    access: {
      isOwner: ownsChannel(actor, row.channelId),
      isModerator: isModerator(actor),
      publiclyWatchable,
      listed: publiclyWatchable && row.visibility === 'PUBLIC',
    },
  };
});

/** The signed-in viewer's saved playback position (resume), or null. */
export async function getResumePosition(userId: string | null, videoId: string, durationSeconds: number | null) {
  if (!userId) return null;
  const row = await db.watchHistory.findUnique({
    where: { userId_videoId: { userId, videoId } },
    select: { positionSeconds: true, lastWatchedAt: true },
  });
  if (!row) return null;
  // Not worth resuming (first seconds / finished video): the player starts from the beginning.
  if (resumePositionFor(row.positionSeconds, durationSeconds) === 0) return null;
  return { positionSeconds: row.positionSeconds, at: row.lastWatchedAt.toISOString() };
}

/** Latest processing job of a video (for the owner's status panel). */
export async function getProcessingInfo(videoId: string) {
  const job = await db.transcodeJob.findFirst({
    where: { videoId },
    orderBy: { createdAt: 'desc' },
    select: { progress: true, stage: true, error: true },
  });
  return { progress: job?.progress ?? 0, stage: job?.stage ?? null, error: job?.error ?? null };
}
