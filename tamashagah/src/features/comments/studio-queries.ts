import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { normalizeUserText, truncate } from '@/lib/persian';
import type { CommentStatus } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { MAX_PAGE_SIZE, SPAM_WRITERS_MAX, STUDIO_PAGE_SIZE } from './limits';
import type { StudioTab } from './schemas';

/**
 * Data for /studio/comments (reference: the creator-studio "دیدگاه‌ها" screen).
 *
 * Tabs (all scoped to the channel's videos, DELETED comments never appear):
 *   all      published, held and rejected comments (everything except spam)
 *   spam     comments the heuristics or the creator marked as spam
 *   pending  comments waiting for approval
 *   replies  answers (anything that is not top-level), except spam
 */
const LIVE: CommentStatus[] = ['APPROVED', 'PENDING', 'REJECTED'];

function whereForTab(channelId: string, tab: StudioTab): Prisma.CommentWhereInput {
  const base: Prisma.CommentWhereInput = { video: { channelId } };
  switch (tab) {
    case 'spam':
      return { ...base, status: 'SPAM' };
    case 'pending':
      return { ...base, status: 'PENDING' };
    case 'replies':
      return { ...base, status: { in: LIVE }, rootId: { not: null } };
    default:
      return { ...base, status: { in: LIVE } };
  }
}

export type StudioCounts = Record<StudioTab, number>;

/** Live counts for the pill tabs. */
export async function getStudioCommentCounts(channelId: string): Promise<StudioCounts> {
  const [all, spam, pending, replies] = await Promise.all(
    (['all', 'spam', 'pending', 'replies'] as const).map((tab) => db.comment.count({ where: whereForTab(channelId, tab) })),
  );
  return { all: all!, spam: spam!, pending: pending!, replies: replies! };
}

export type StudioCommentRow = {
  id: string;
  body: string;
  status: CommentStatus;
  /** ISO string */
  createdAt: string;
  isReply: boolean;
  /** Short quote of the comment being answered (replies tab). */
  parentExcerpt: string | null;
  replyCount: number;
  reportCount: number;
  author: { id: string; name: string; avatarUrl: string | null; blocked: boolean };
  /** True for the channel owner's own comments (no approve / block controls). */
  isOwner: boolean;
  video: { id: string; title: string; posterUrl: string | null };
};

export type StudioCommentsPage = {
  items: StudioCommentRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

export async function listStudioComments(
  channelId: string,
  opts: { tab: StudioTab; q?: string; page?: number; pageSize?: number },
): Promise<StudioCommentsPage> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? STUDIO_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const requested = Math.max(1, Math.floor(opts.page ?? 1));
  const q = opts.q ? normalizeUserText(opts.q).slice(0, 100) : '';

  const where: Prisma.CommentWhereInput = {
    ...whereForTab(channelId, opts.tab),
    ...(q
      ? {
          OR: [
            { body: { contains: q, mode: 'insensitive' } },
            { author: { displayName: { contains: q, mode: 'insensitive' } } },
            { author: { channel: { name: { contains: q, mode: 'insensitive' } } } },
            { video: { title: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const total = await db.comment.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pageCount);

  const rows = await db.comment.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      body: true,
      status: true,
      createdAt: true,
      rootId: true,
      parentId: true,
      replyCount: true,
      reportCount: true,
      authorId: true,
      author: { select: { displayName: true, avatarKey: true, channel: { select: { name: true, avatarKey: true } } } },
      video: { select: { id: true, title: true, posterKey: true, channel: { select: { ownerId: true } } } },
    },
  });

  // Parent quotes (replies) and block flags for the page, each in ONE query.
  const parentIds = [...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))];
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const [parents, blocks] = await Promise.all([
    parentIds.length ? db.comment.findMany({ where: { id: { in: parentIds } }, select: { id: true, body: true } }) : [],
    authorIds.length ? db.channelBlock.findMany({ where: { channelId, userId: { in: authorIds } }, select: { userId: true } }) : [],
  ]);
  const parentBody = new Map(parents.map((p) => [p.id, p.body]));
  const blocked = new Set(blocks.map((b) => b.userId));

  return {
    items: rows.map((r) => ({
      id: r.id,
      body: r.body,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      isReply: r.rootId !== null,
      parentExcerpt: r.parentId && parentBody.has(r.parentId) ? truncate(parentBody.get(r.parentId)!.replace(/\s+/g, ' '), 90) : null,
      replyCount: r.replyCount,
      reportCount: r.reportCount,
      author: {
        id: r.authorId,
        name: r.author.channel?.name ?? r.author.displayName,
        avatarUrl: mediaUrl(r.author.channel?.avatarKey ?? r.author.avatarKey),
        blocked: blocked.has(r.authorId),
      },
      isOwner: r.authorId === r.video.channel.ownerId,
      video: { id: r.video.id, title: r.video.title, posterUrl: mediaUrl(r.video.posterKey) },
    })),
    total,
    page,
    pageCount,
    pageSize,
  };
}

export type SpamWriter = { userId: string; name: string; avatarUrl: string | null; spamCount: number; blocked: boolean };

/**
 * People who posted spam on this channel (most first), plus everybody currently blocked even without spam,
 * so the creator can always undo a block.
 */
export async function listSpamWriters(channelId: string): Promise<SpamWriter[]> {
  const [grouped, blocks] = await Promise.all([
    db.comment.groupBy({
      by: ['authorId'],
      where: { status: 'SPAM', video: { channelId } },
      _count: { _all: true },
      orderBy: { _count: { authorId: 'desc' } },
      take: SPAM_WRITERS_MAX,
    }),
    db.channelBlock.findMany({ where: { channelId }, select: { userId: true }, take: 200 }),
  ]);
  const counts = new Map(grouped.map((g) => [g.authorId, g._count._all]));
  const blockedIds = new Set(blocks.map((b) => b.userId));
  const ids = [...new Set([...counts.keys(), ...blockedIds])];
  if (ids.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, avatarKey: true, channel: { select: { name: true, avatarKey: true } } },
  });
  return users
    .map((u) => ({
      userId: u.id,
      name: u.channel?.name ?? u.displayName,
      avatarUrl: mediaUrl(u.channel?.avatarKey ?? u.avatarKey),
      spamCount: counts.get(u.id) ?? 0,
      blocked: blockedIds.has(u.id),
    }))
    .sort((a, b) => b.spamCount - a.spamCount || a.name.localeCompare(b.name, 'fa'));
}
