/**
 * Small data builders on top of tests/helpers/factories for the discovery integration tests
 * (events, likes, follows, watch history). Everything goes straight through Prisma.
 */
import { db } from '@/lib/db';
import { randomToken } from '@/lib/ids';
import type { DataSource } from '@/generated/prisma/enums';

const DAY = 86_400_000;

/** Insert `count` ViewEvent rows for a video, `daysAgo` days in the past (default: just now). Also bumps viewCount like the real recorder. */
export async function addViews(
  video: { id: string; channelId: string },
  count: number,
  opts: { daysAgo?: number; source?: DataSource; bumpCounter?: boolean } = {},
): Promise<void> {
  if (count <= 0) return;
  const at = new Date(Date.now() - (opts.daysAgo ?? 0) * DAY - 60_000);
  await db.viewEvent.createMany({
    data: Array.from({ length: count }, () => ({
      videoId: video.id,
      channelId: video.channelId,
      viewerKey: randomToken(8),
      source: opts.source ?? 'REAL',
      createdAt: at,
      lastBeatAt: at,
    })),
  });
  if (opts.bumpCounter) await db.video.update({ where: { id: video.id }, data: { viewCount: { increment: count } } });
}

/** Like `videoId` once per user, `daysAgo` days in the past; keeps the counter in step. */
export async function addLikes(videoId: string, userIds: string[], daysAgo = 0): Promise<void> {
  if (userIds.length === 0) return;
  const createdAt = new Date(Date.now() - daysAgo * DAY - 60_000);
  await db.videoLike.createMany({ data: userIds.map((userId) => ({ userId, videoId, createdAt })), skipDuplicates: true });
  await db.video.update({ where: { id: videoId }, data: { likeCount: { increment: userIds.length } } });
}

export async function follow(userId: string, channelId: string, opts: { notify?: boolean } = {}): Promise<void> {
  await db.follow.create({ data: { userId, channelId, notify: opts.notify ?? true } });
  await db.channel.update({ where: { id: channelId }, data: { followerCount: { increment: 1 } } });
}

export async function watch(
  userId: string,
  videoId: string,
  opts: { position?: number; watched?: number; completed?: boolean; daysAgo?: number } = {},
): Promise<void> {
  const at = new Date(Date.now() - (opts.daysAgo ?? 0) * DAY - 1_000);
  await db.watchHistory.upsert({
    where: { userId_videoId: { userId, videoId } },
    create: {
      userId,
      videoId,
      positionSeconds: opts.position ?? 60,
      watchedSeconds: opts.watched ?? opts.position ?? 60,
      completed: opts.completed ?? false,
      firstWatchedAt: at,
      lastWatchedAt: at,
    },
    update: { positionSeconds: opts.position ?? 60, watchedSeconds: opts.watched ?? opts.position ?? 60, completed: opts.completed ?? false, lastWatchedAt: at },
  });
}

export const daysAgoDate = (days: number): Date => new Date(Date.now() - days * DAY);
