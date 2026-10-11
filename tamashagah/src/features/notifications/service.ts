import { db, type Prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { NotificationType } from '@/generated/prisma/enums';

export type NotifyInput = {
  /** Recipient. */
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Internal path the notification opens, e.g. `/watch/${videoId}`. */
  href?: string | null;
  actorId?: string | null;
  channelId?: string | null;
  videoId?: string | null;
  commentId?: string | null;
  data?: Prisma.InputJsonValue;
};

/**
 * Create a notification. Never throws — notifications are best effort and must
 * not break the action that triggered them. Self-notifications are skipped.
 *
 * Runtime-agnostic: also used by the worker (e.g. VIDEO_READY).
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.userId) return;
  try {
    await db.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 500) ?? null,
        href: input.href ?? null,
        actorId: input.actorId ?? null,
        channelId: input.channelId ?? null,
        videoId: input.videoId ?? null,
        commentId: input.commentId ?? null,
        data: input.data,
      },
    });
  } catch (err) {
    logger.error({ err, type: input.type, userId: input.userId }, 'failed to create notification');
  }
}

export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  const rows = inputs.filter((i) => !i.actorId || i.actorId !== i.userId);
  if (rows.length === 0) return;
  try {
    await db.notification.createMany({
      data: rows.map((i) => ({
        userId: i.userId,
        type: i.type,
        title: i.title.slice(0, 200),
        body: i.body?.slice(0, 500) ?? null,
        href: i.href ?? null,
        actorId: i.actorId ?? null,
        channelId: i.channelId ?? null,
        videoId: i.videoId ?? null,
        commentId: i.commentId ?? null,
        data: i.data,
      })),
    });
  } catch (err) {
    logger.error({ err, count: rows.length }, 'failed to create notifications');
  }
}
