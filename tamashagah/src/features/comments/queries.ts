import 'server-only';
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { mediaUrl } from '@/lib/media-url';
import type { Actor } from '@/lib/permissions';
import { clamp } from '@/lib/utils';
import { loadViewableVideo } from '@/features/watch/access';
import { getReportedCommentIds } from '@/features/reports/service';
import type { Prisma } from '@/generated/prisma/client';
import type { CommentDTO, CommentPageDTO, RepliesPageDTO } from './dto';
import { COMMENT_PAGE_SIZE, MAX_PAGE_SIZE, REPLY_PAGE_SIZE } from './limits';

/** Everything needed to render one comment (author identity, reply target). */
export const commentSelect = {
  id: true,
  videoId: true,
  authorId: true,
  parentId: true,
  rootId: true,
  body: true,
  status: true,
  replyCount: true,
  createdAt: true,
  author: {
    select: {
      displayName: true,
      avatarKey: true,
      channel: { select: { handle: true, name: true, avatarKey: true, isVerified: true } },
    },
  },
  replyToUser: { select: { displayName: true, channel: { select: { name: true } } } },
} satisfies Prisma.CommentSelect;

export type CommentRow = Prisma.CommentGetPayload<{ select: typeof commentSelect }>;

export type CommentContext = {
  /** Owner of the channel the video belongs to (gets the «سازنده» badge). */
  channelOwnerId: string;
  viewerId: string | null;
  reportedIds: ReadonlySet<string>;
};

export function toCommentDTO(row: CommentRow, ctx: CommentContext): CommentDTO {
  const channel = row.author.channel;
  const repliesToReply = row.parentId !== null && row.parentId !== row.rootId;
  return {
    id: row.id,
    videoId: row.videoId,
    body: row.body,
    // Only these two are ever selected for display; anything else is filtered out by `visibleTo`.
    status: row.status === 'PENDING' ? 'PENDING' : 'APPROVED',
    createdAt: row.createdAt.toISOString(),
    replyCount: row.replyCount,
    rootId: row.rootId,
    author: {
      id: row.authorId,
      name: channel?.name ?? row.author.displayName,
      avatarUrl: mediaUrl(channel?.avatarKey ?? row.author.avatarKey),
      handle: channel?.handle ?? null,
      verified: channel?.isVerified ?? false,
      isCreator: row.authorId === ctx.channelOwnerId,
    },
    replyToName: repliesToReply && row.replyToUser ? (row.replyToUser.channel?.name ?? row.replyToUser.displayName) : null,
    isOwn: ctx.viewerId !== null && row.authorId === ctx.viewerId,
    reported: ctx.reportedIds.has(row.id),
  };
}

/** Public comments plus the viewer's own held (PENDING) ones. */
export function visibleTo(viewerId: string | null): Prisma.CommentWhereInput {
  return { OR: [{ status: 'APPROVED' }, ...(viewerId ? [{ status: 'PENDING' as const, authorId: viewerId }] : [])] };
}

const isCommentingOff = (video: { commentsEnabled: boolean; channel: { commentsMode: string } }) =>
  !video.commentsEnabled || video.channel.commentsMode === 'DISABLED';

/**
 * One page of top-level comments, newest first (cursor = id of the last item). Throws NOT_FOUND for videos the
 * actor may not see. When the creator turned comments off nothing is listed.
 */
export async function getCommentPage(
  videoId: string,
  actor: Actor,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<CommentPageDTO> {
  const video = await loadViewableVideo(videoId, actor);
  if (isCommentingOff(video)) return { items: [], nextCursor: null, total: 0, disabled: true };

  const viewerId = actor?.id ?? null;
  const limit = clamp(opts.limit ?? COMMENT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const rows = await db.comment.findMany({
    where: { videoId: video.id, rootId: null, ...visibleTo(viewerId) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: commentSelect,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const reportedIds = await getReportedCommentIds(viewerId, page.map((r) => r.id));
  const ctx: CommentContext = { channelOwnerId: video.channel.ownerId, viewerId, reportedIds };
  return {
    items: page.map((r) => toCommentDTO(r, ctx)),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    total: video.commentCount,
  };
}

/** One page of replies under a root comment, oldest first (reads like a conversation). */
export async function getReplyPage(
  rootId: string,
  actor: Actor,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<RepliesPageDTO> {
  const root = await db.comment.findUnique({
    where: { id: rootId },
    select: { id: true, rootId: true, videoId: true, status: true, authorId: true },
  });
  const viewerId = actor?.id ?? null;
  const rootVisible = !!root && root.rootId === null && (root.status === 'APPROVED' || (root.status === 'PENDING' && root.authorId === viewerId));
  if (!root || !rootVisible) throw Errors.notFound('دیدگاه پیدا نشد.');
  const video = await loadViewableVideo(root.videoId, actor);
  if (isCommentingOff(video)) return { items: [], nextCursor: null };

  const limit = clamp(opts.limit ?? REPLY_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const rows = await db.comment.findMany({
    where: { rootId: root.id, ...visibleTo(viewerId) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: commentSelect,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const reportedIds = await getReportedCommentIds(viewerId, page.map((r) => r.id));
  const ctx: CommentContext = { channelOwnerId: video.channel.ownerId, viewerId, reportedIds };
  return { items: page.map((r) => toCommentDTO(r, ctx)), nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
}
