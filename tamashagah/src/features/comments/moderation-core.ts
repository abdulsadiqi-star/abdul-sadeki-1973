/**
 * THE single place where a comment's moderation status changes.
 *
 * Both the creator studio (approve / reject / spam / delete) and the admin panel (moderator actions on
 * reported comments) call `applyCommentStatus`, so denormalized counters can never drift apart:
 *
 *   Video.commentCount   = number of APPROVED comments on the video (roots + replies)
 *   Comment.replyCount   = number of APPROVED replies under a root comment
 *
 * Every change is recorded as a ModerationAction. Runtime-agnostic (no next/* imports).
 */
import { db, type Prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import type { CommentStatus, ModerationActionType } from '@/generated/prisma/enums';

const ACTION_FOR: Record<CommentStatus, ModerationActionType> = {
  APPROVED: 'COMMENT_APPROVE',
  REJECTED: 'COMMENT_REJECT',
  SPAM: 'COMMENT_SPAM',
  DELETED: 'COMMENT_DELETE',
  PENDING: 'COMMENT_RESTORE',
};

export type CommentStatusChange = {
  commentId: string;
  from: CommentStatus;
  to: CommentStatus;
  videoId: string;
  authorId: string;
};

/**
 * Move a comment to `status`. Idempotent (returns `null` when nothing changed). The CALLER must have
 * authorized the actor (`canModerateComments`, or `isModerator`) before calling.
 */
export async function applyCommentStatus(
  commentId: string,
  status: CommentStatus,
  opts: {
    actorId: string | null;
    note?: string | null;
    /** Join the caller's transaction instead of opening one (the admin panel commits report resolution + change + audit together). */
    tx?: Prisma.TransactionClient;
    /** Extras for the audit row (admin panel): the report that triggered the change, an action-type override, more metadata. */
    audit?: { reportId?: string | null; type?: ModerationActionType; meta?: Record<string, unknown> };
  },
): Promise<CommentStatusChange | null> {
  const run = async (tx: Prisma.TransactionClient) => {
    const comment = await tx.comment.findUnique({
      where: { id: commentId },
      select: { id: true, status: true, videoId: true, rootId: true, authorId: true, video: { select: { channelId: true } } },
    });
    if (!comment) throw Errors.notFound('دیدگاه پیدا نشد.');
    if (comment.status === status) return null;

    const wasApproved = comment.status === 'APPROVED';
    const isApproved = status === 'APPROVED';
    const delta = wasApproved === isApproved ? 0 : isApproved ? 1 : -1;

    await tx.comment.update({
      where: { id: commentId },
      data: { status, moderatedById: opts.actorId, moderatedAt: new Date(), moderationNote: opts.note ?? null },
    });
    if (delta !== 0) {
      await tx.video.update({ where: { id: comment.videoId }, data: { commentCount: { increment: delta } } });
      if (comment.rootId) await tx.comment.update({ where: { id: comment.rootId }, data: { replyCount: { increment: delta } } });
    }
    await tx.moderationAction.create({
      data: {
        actorId: opts.actorId,
        type: opts.audit?.type ?? ACTION_FOR[status],
        commentId,
        videoId: comment.videoId,
        channelId: comment.video.channelId,
        targetUserId: comment.authorId,
        reportId: opts.audit?.reportId ?? null,
        reason: opts.note ?? null,
        meta: { from: comment.status, to: status, ...opts.audit?.meta } as Prisma.InputJsonObject,
      },
    });
    return { commentId, from: comment.status, to: status, videoId: comment.videoId, authorId: comment.authorId };
  };
  return opts.tx ? run(opts.tx) : db.$transaction(run);
}
