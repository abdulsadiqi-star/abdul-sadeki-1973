import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import type { NotificationType } from '@/generated/prisma/enums';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  /** ISO string */
  createdAt: string;
  actor: { name: string; avatarUrl: string | null } | null;
};

export type NotificationPage = { items: NotificationItem[]; nextCursor: string | null };

export async function listNotifications(
  userId: string,
  opts: { limit?: number; cursor?: string | null; unreadOnly?: boolean } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const rows = await db.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      actor: { select: { displayName: true, avatarKey: true, channel: { select: { name: true, avatarKey: true } } } },
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
      actor: n.actor
        ? {
            name: n.actor.channel?.name ?? n.actor.displayName,
            avatarUrl: mediaUrl(n.actor.channel?.avatarKey ?? n.actor.avatarKey),
          }
        : null,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export function countUnreadNotifications(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Mark specific notifications (or all, when `ids` is omitted) as read. Returns how many changed. */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const { count } = await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return count;
}
