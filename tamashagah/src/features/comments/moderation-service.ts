/**
 * Creator-side comment moderation (studio). Every function re-derives authorization from the database with
 * `canModerateComments` (channel owner or platform moderator) and answers 404 — not 403 — for comments of
 * other channels, so ids cannot be probed. Status changes go ONLY through `applyCommentStatus`
 * (moderation-core.ts), which keeps the counters exact and writes the audit trail.
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { canModerateComments } from '@/lib/permissions';
import { notify } from '@/features/notifications/service';
import type { Viewer } from '@/features/engagement/service';
import type { Prisma } from '@/generated/prisma/client';
import type { CommentDTO } from './dto';
import { applyCommentStatus } from './moderation-core';
import { approvedNotice, replyNotice } from './notifications';
import { actorOf, cleanCommentBody, postComment } from './service';
import { deleteCommentThread } from './thread';
import type { ModerationStatus } from './schemas';

const moderationSelect = {
  id: true,
  rootId: true,
  status: true,
  authorId: true,
  replyToUserId: true,
  body: true,
  videoId: true,
  author: { select: { displayName: true, channel: { select: { name: true } } } },
  video: { select: { id: true, title: true, channelId: true } },
} satisfies Prisma.CommentSelect;

type LoadedComment = Prisma.CommentGetPayload<{ select: typeof moderationSelect }>;

const canModerate = (actor: Viewer, comment: LoadedComment) =>
  canModerateComments(actorOf(actor), { channelId: comment.video.channelId });

/** Tell the author (and the answered person) that a comment became public. */
async function notifyApproved(actor: Viewer, comment: LoadedComment): Promise<void> {
  const ctx = {
    video: { id: comment.video.id, title: comment.video.title, channelId: comment.video.channelId },
    commentId: comment.id,
    authorName: comment.author.channel?.name ?? comment.author.displayName,
    authorId: comment.authorId,
    body: comment.body,
  };
  await notify(approvedNotice(ctx, actor.id));
  if (comment.rootId && comment.replyToUserId && comment.replyToUserId !== comment.authorId && comment.replyToUserId !== actor.id) {
    await notify(replyNotice(ctx, comment.replyToUserId));
  }
}

/** Apply one status to an already loaded + authorized comment. Returns whether anything changed. */
async function applyOne(actor: Viewer, comment: LoadedComment, status: ModerationStatus, note?: string | null): Promise<boolean> {
  if (comment.status === 'DELETED') return false; // deleted comments are gone for good
  if (status === 'DELETED') {
    await deleteCommentThread(comment, actor.id, note);
    return true;
  }
  const change = await applyCommentStatus(comment.id, status, { actorId: actor.id, note });
  if (change?.to === 'APPROVED') await notifyApproved(actor, comment);
  return change !== null;
}

export async function moderateComment(
  actor: Viewer,
  commentId: string,
  status: ModerationStatus,
  note?: string | null,
): Promise<{ changed: boolean }> {
  const comment = await db.comment.findUnique({ where: { id: commentId }, select: moderationSelect });
  if (!comment || comment.status === 'DELETED' || !canModerate(actor, comment)) throw Errors.notFound('دیدگاه پیدا نشد.');
  return { changed: await applyOne(actor, comment, status, note) };
}

/** Apply `status` to many comments; ids the actor may not moderate are skipped silently (counted as `skipped`). */
export async function moderateComments(
  actor: Viewer,
  commentIds: string[],
  status: ModerationStatus,
): Promise<{ changed: number; skipped: number }> {
  const unique = [...new Set(commentIds)];
  const comments = await db.comment.findMany({ where: { id: { in: unique } }, select: moderationSelect });
  let changed = 0;
  for (const comment of comments) {
    if (!canModerate(actor, comment)) continue;
    if (await applyOne(actor, comment, status)) changed += 1;
  }
  return { changed, skipped: unique.length - changed };
}

/**
 * Answer a comment as the channel owner. A held (PENDING) comment is approved first — answering something
 * nobody can see would be pointless — and the reply itself is published immediately (owners are exempt from
 * approval and spam rules).
 */
export async function replyAsCreator(
  actor: Viewer,
  commentId: string,
  rawBody: string,
): Promise<{ reply: CommentDTO; approvedParent: boolean }> {
  const parent = await db.comment.findUnique({ where: { id: commentId }, select: moderationSelect });
  if (!parent || !canModerate(actor, parent)) throw Errors.notFound('دیدگاه پیدا نشد.');
  if (parent.status !== 'APPROVED' && parent.status !== 'PENDING') throw Errors.badRequest('به این دیدگاه نمی‌توان پاسخ داد.');
  cleanCommentBody(rawBody); // validate BEFORE changing anything

  let approvedParent = false;
  if (parent.status === 'PENDING') {
    approvedParent = await applyOne(actor, parent, 'APPROVED');
  }
  const { comment } = await postComment(actor, { videoId: parent.videoId, body: rawBody, parentId: parent.id });
  if (!comment) throw Errors.internal(); // owners are never classified as spam
  return { reply: comment, approvedParent };
}

// ---------------------------------------------------------------------------------------------------------
// Blocking commenters (the "کاربران هرزنویس" list)
// ---------------------------------------------------------------------------------------------------------

export async function blockCommenter(
  actor: Viewer,
  channelId: string,
  userId: string,
  reason?: string | null,
): Promise<{ changed: boolean }> {
  if (!canModerateComments(actorOf(actor), { channelId })) throw Errors.notFound('کانال پیدا نشد.');
  const channel = await db.channel.findUnique({ where: { id: channelId }, select: { ownerId: true } });
  if (!channel) throw Errors.notFound('کانال پیدا نشد.');
  if (channel.ownerId === userId) throw Errors.badRequest('نمی‌توانید صاحب کانال را مسدود کنید.');
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) throw Errors.notFound('کاربر پیدا نشد.');

  const cleanReason = reason?.trim() ? reason.trim().slice(0, 200) : null;
  return db.$transaction(async (tx) => {
    const { count } = await tx.channelBlock.createMany({ data: [{ channelId, userId, reason: cleanReason }], skipDuplicates: true });
    if (count) {
      await tx.moderationAction.create({
        data: { actorId: actor.id, type: 'CHANNEL_USER_BLOCK', channelId, targetUserId: userId, reason: cleanReason },
      });
    }
    return { changed: count > 0 };
  });
}

export async function unblockCommenter(actor: Viewer, channelId: string, userId: string): Promise<{ changed: boolean }> {
  if (!canModerateComments(actorOf(actor), { channelId })) throw Errors.notFound('کانال پیدا نشد.');
  return db.$transaction(async (tx) => {
    const { count } = await tx.channelBlock.deleteMany({ where: { channelId, userId } });
    if (count) {
      await tx.moderationAction.create({ data: { actorId: actor.id, type: 'CHANNEL_USER_UNBLOCK', channelId, targetUserId: userId } });
    }
    return { changed: count > 0 };
  });
}
