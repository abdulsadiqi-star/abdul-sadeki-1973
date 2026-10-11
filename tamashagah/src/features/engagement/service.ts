/**
 * Core engagement operations shared by the watch page, shorts, channel pages and library:
 * like, follow and "watch later". Every operation re-checks visibility on the server, keeps the
 * denormalized counters in the SAME transaction, and is idempotent (safe to call twice).
 *
 * Runtime-agnostic (no next/* imports) so it can be unit/integration tested and reused by workers.
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { watchLaterPlaylistId } from '@/lib/ids';
import { canViewVideo, type Actor, type VideoAccessInfo } from '@/lib/permissions';
import { notify } from '@/features/notifications/service';
import type { UserRole } from '@/generated/prisma/enums';

export type Viewer = { id: string; displayName: string; role: UserRole; channelId: string | null; emailVerified: boolean };

const videoAccessSelect = {
  id: true,
  title: true,
  channelId: true,
  visibility: true,
  publishStatus: true,
  processingStatus: true,
  takedownAt: true,
  channel: { select: { ownerId: true, suspendedAt: true } },
} as const;

async function loadViewableVideo(viewer: Viewer, videoId: string) {
  const video = await db.video.findUnique({ where: { id: videoId }, select: videoAccessSelect });
  const actor: Actor = { id: viewer.id, role: viewer.role, channelId: viewer.channelId, emailVerified: viewer.emailVerified };
  const access: VideoAccessInfo | null = video && {
    channelId: video.channelId,
    visibility: video.visibility,
    publishStatus: video.publishStatus,
    processingStatus: video.processingStatus,
    takedownAt: video.takedownAt,
    channelSuspendedAt: video.channel.suspendedAt,
  };
  // 404 (not 403) so private videos cannot be probed.
  if (!video || !access || !canViewVideo(actor, access)) throw Errors.notFound('ویدیو پیدا نشد.');
  return video;
}

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

export async function setLike(viewer: Viewer, videoId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number }> {
  const video = await loadViewableVideo(viewer, videoId);

  const newlyLiked = await db.$transaction(async (tx) => {
    if (liked) {
      const { count } = await tx.videoLike.createMany({ data: [{ userId: viewer.id, videoId }], skipDuplicates: true });
      if (count) await tx.video.update({ where: { id: videoId }, data: { likeCount: { increment: 1 } } });
      return count > 0;
    }
    const { count } = await tx.videoLike.deleteMany({ where: { userId: viewer.id, videoId } });
    if (count) await tx.video.update({ where: { id: videoId }, data: { likeCount: { decrement: count } } });
    return false;
  });

  if (newlyLiked) {
    // One notification per (viewer, video) per day — like/unlike toggling must not spam the creator.
    const since = new Date(Date.now() - 24 * 3_600_000);
    const already = await db.notification.count({
      where: { userId: video.channel.ownerId, actorId: viewer.id, videoId, type: 'VIDEO_LIKED', createdAt: { gte: since } },
    });
    if (!already) {
      await notify({
        userId: video.channel.ownerId,
        type: 'VIDEO_LIKED',
        title: `${viewer.displayName} ویدیوی «${video.title}» را پسندید`,
        href: `/watch/${videoId}`,
        actorId: viewer.id,
        videoId,
        channelId: video.channelId,
      });
    }
  }

  const { likeCount } = await db.video.findUniqueOrThrow({ where: { id: videoId }, select: { likeCount: true } });
  return { liked, likeCount };
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

export async function setFollow(
  viewer: Viewer,
  channelId: string,
  follow: boolean,
): Promise<{ following: boolean; followerCount: number }> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, ownerId: true, name: true, handle: true, suspendedAt: true },
  });
  if (!channel || channel.suspendedAt) throw Errors.notFound('کانال پیدا نشد.');
  if (channel.ownerId === viewer.id) throw Errors.badRequest('نمی‌توانید کانال خودتان را دنبال کنید.');

  const changed = await db.$transaction(async (tx) => {
    if (follow) {
      const { count } = await tx.follow.createMany({ data: [{ userId: viewer.id, channelId }], skipDuplicates: true });
      if (count) {
        await tx.channel.update({ where: { id: channelId }, data: { followerCount: { increment: 1 } } });
        await tx.followEvent.create({ data: { channelId, userId: viewer.id, type: 'FOLLOW' } });
      }
      return count > 0;
    }
    const { count } = await tx.follow.deleteMany({ where: { userId: viewer.id, channelId } });
    if (count) {
      await tx.channel.update({ where: { id: channelId }, data: { followerCount: { decrement: count } } });
      await tx.followEvent.create({ data: { channelId, userId: viewer.id, type: 'UNFOLLOW' } });
    }
    return false;
  });

  if (follow && changed) {
    await notify({
      userId: channel.ownerId,
      type: 'NEW_FOLLOWER',
      title: `${viewer.displayName} کانال «${channel.name}» را دنبال کرد`,
      href: `/channel/${channel.handle}`,
      actorId: viewer.id,
      channelId,
    });
  }

  const { followerCount } = await db.channel.findUniqueOrThrow({ where: { id: channelId }, select: { followerCount: true } });
  return { following: follow, followerCount };
}

/** Toggle new-video notifications for a followed channel. */
export async function setFollowNotifications(userId: string, channelId: string, notifyOnNewVideo: boolean): Promise<void> {
  const { count } = await db.follow.updateMany({ where: { userId, channelId }, data: { notify: notifyOnNewVideo } });
  if (!count) throw Errors.notFound('ابتدا کانال را دنبال کنید.');
}

// ---------------------------------------------------------------------------
// Watch later (a system playlist with the deterministic id "wl_<userId>")
// ---------------------------------------------------------------------------

export async function setWatchLater(viewer: Viewer, videoId: string, saved: boolean): Promise<{ saved: boolean }> {
  await loadViewableVideo(viewer, videoId);
  const playlistId = watchLaterPlaylistId(viewer.id);

  await db.$transaction(async (tx) => {
    await tx.playlist.upsert({
      where: { id: playlistId },
      create: { id: playlistId, ownerId: viewer.id, kind: 'WATCH_LATER', title: 'بعداً تماشا می‌کنم', visibility: 'PRIVATE' },
      update: {},
    });
    if (saved) {
      const last = await tx.playlistItem.aggregate({ where: { playlistId }, _max: { position: true } });
      await tx.playlistItem.createMany({
        data: [{ playlistId, videoId, position: (last._max.position ?? -1) + 1 }],
        skipDuplicates: true,
      });
    } else {
      await tx.playlistItem.deleteMany({ where: { playlistId, videoId } });
    }
  });
  return { saved };
}

// ---------------------------------------------------------------------------
// Viewer state (one round trip for like/follow/save buttons)
// ---------------------------------------------------------------------------

export type ViewerState = { liked: boolean; following: boolean; notifyEnabled: boolean; saved: boolean };

export async function getViewerState(userId: string | null, videoId: string, channelId: string): Promise<ViewerState> {
  if (!userId) return { liked: false, following: false, notifyEnabled: false, saved: false };
  const [like, follow, saved] = await Promise.all([
    db.videoLike.findUnique({ where: { userId_videoId: { userId, videoId } }, select: { userId: true } }),
    db.follow.findUnique({ where: { userId_channelId: { userId, channelId } }, select: { notify: true } }),
    db.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId: watchLaterPlaylistId(userId), videoId } },
      select: { id: true },
    }),
  ]);
  return { liked: !!like, following: !!follow, notifyEnabled: follow?.notify ?? false, saved: !!saved };
}

/** Which of these videos the user liked / saved (for lists such as shorts or library). */
export async function getLikedVideoIds(userId: string | null, videoIds: string[]): Promise<Set<string>> {
  if (!userId || videoIds.length === 0) return new Set();
  const rows = await db.videoLike.findMany({ where: { userId, videoId: { in: videoIds } }, select: { videoId: true } });
  return new Set(rows.map((r) => r.videoId));
}
