/**
 * Viewer-side comment operations: post, reply, delete your own.
 *
 * Server rules (all enforced here, never in the UI):
 *  - verified e-mail required; 404 for videos the viewer may not see
 *  - channel `commentsMode` DISABLED or `Video.commentsEnabled = false` → FORBIDDEN
 *  - users blocked by the channel (ChannelBlock) cannot post → BLOCKED
 *  - text is normalized (`normalizeUserText`) and limited to 1000 characters
 *  - APPROVAL_REQUIRED channels hold everything (PENDING); the spam heuristics (spam.ts) hold (PENDING) or
 *    discard (SPAM) suspicious comments; the channel owner is exempt
 *  - replies are flattened under the root comment (`rootId`, `replyToUserId`); you can only answer APPROVED comments
 *  - counters: `Video.commentCount` / `Comment.replyCount` change in the SAME transaction when an APPROVED
 *    comment is created; every later status change goes through `applyCommentStatus` (moderation-core.ts)
 *  - notifications (best effort): NEW_COMMENT / COMMENT_PENDING → owner, COMMENT_REPLY → the answered person
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { normalizeUserText, toPersianDigits } from '@/lib/persian';
import type { Actor } from '@/lib/permissions';
import { notify } from '@/features/notifications/service';
import { loadViewableVideo } from '@/features/watch/access';
import type { Viewer } from '@/features/engagement/service';
import { hasVisibleText } from '@/features/engagement/text';
import type { CommentStatus } from '@/generated/prisma/enums';
import type { PostCommentResultDTO, PostOutcome } from './dto';
import { COMMENT_MAX_LENGTH, SPAM_DUPLICATE_WINDOW_MS } from './limits';
import { newCommentNotice, pendingCommentNotice, replyNotice } from './notifications';
import { commentSelect, toCommentDTO } from './queries';
import { evaluateComment } from './spam';
import { deleteCommentThread } from './thread';

export const actorOf = (v: Viewer): NonNullable<Actor> => ({ id: v.id, role: v.role, channelId: v.channelId, emailVerified: v.emailVerified });

/** Normalize and validate the text of a comment (throws a field error on `body`). */
export function cleanCommentBody(raw: string): string {
  const body = normalizeUserText(raw, { multiline: true });
  if (!hasVisibleText(body)) throw Errors.validation({ body: ['متن دیدگاه را بنویسید.'] });
  if (Array.from(body).length > COMMENT_MAX_LENGTH) {
    throw Errors.validation({ body: [`دیدگاه نباید بیش از ${toPersianDigits(COMMENT_MAX_LENGTH)} نویسه باشد.`] });
  }
  return body;
}

export async function postComment(
  viewer: Viewer,
  input: { videoId: string; body: string; parentId?: string | null },
): Promise<PostCommentResultDTO> {
  if (!viewer.emailVerified) throw Errors.emailNotVerified('برای ارسال دیدگاه ابتدا ایمیل خود را تأیید کنید.');
  const video = await loadViewableVideo(input.videoId, actorOf(viewer));
  const channel = video.channel;
  if (!video.commentsEnabled || channel.commentsMode === 'DISABLED') {
    throw Errors.forbidden('دیدگاه‌ها برای این ویدیو بسته شده است.');
  }

  const isOwner = channel.ownerId === viewer.id;
  if (!isOwner) {
    const block = await db.channelBlock.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: viewer.id } },
      select: { userId: true },
    });
    if (block) throw Errors.blocked('امکان ارسال دیدگاه در این کانال برای شما محدود شده است.');
  }

  const body = cleanCommentBody(input.body);

  // Decide what happens to the comment.
  let status: CommentStatus = 'APPROVED';
  let outcome: PostOutcome = 'published';
  if (!isOwner) {
    const recent = await db.comment.findMany({
      where: { authorId: viewer.id, status: { not: 'DELETED' }, createdAt: { gt: new Date(Date.now() - SPAM_DUPLICATE_WINDOW_MS) } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { body: true },
    });
    const verdict = evaluateComment({ body, recentBodies: recent.map((r) => r.body) });
    if (verdict.verdict === 'spam') {
      status = 'SPAM';
      outcome = 'spam';
    } else if (verdict.verdict === 'pending' || channel.commentsMode === 'APPROVAL_REQUIRED') {
      status = 'PENDING';
      outcome = 'pending';
    }
  }

  const { row, replyToUserId } = await db.$transaction(async (tx) => {
    let rootId: string | null = null;
    let parentId: string | null = null;
    let replyToUserId: string | null = null;
    if (input.parentId) {
      const parent = await tx.comment.findUnique({
        where: { id: input.parentId },
        select: { id: true, videoId: true, authorId: true, rootId: true, status: true },
      });
      if (!parent || parent.videoId !== video.id || parent.status !== 'APPROVED') throw Errors.notFound('دیدگاهی که می‌خواهید به آن پاسخ دهید پیدا نشد.');
      rootId = parent.rootId ?? parent.id;
      if (rootId !== parent.id) {
        // Replying to a reply: the thread must still be public.
        const root = await tx.comment.findUnique({ where: { id: rootId }, select: { status: true } });
        if (root?.status !== 'APPROVED') throw Errors.notFound('دیدگاهی که می‌خواهید به آن پاسخ دهید پیدا نشد.');
      }
      parentId = parent.id;
      replyToUserId = parent.authorId;
    }

    const created = await tx.comment.create({
      data: { videoId: video.id, authorId: viewer.id, body, status, parentId, rootId, replyToUserId },
      select: commentSelect,
    });
    if (status === 'APPROVED') {
      await tx.video.update({ where: { id: video.id }, data: { commentCount: { increment: 1 } } });
      if (rootId) await tx.comment.update({ where: { id: rootId }, data: { replyCount: { increment: 1 } } });
    }
    return { row: created, replyToUserId };
  });

  await notifyAboutNewComment({
    status,
    isOwner,
    ownerId: channel.ownerId,
    video: { id: video.id, title: video.title, channelId: video.channelId },
    commentId: row.id,
    authorId: viewer.id,
    authorName: row.author.channel?.name ?? row.author.displayName,
    body,
    repliedToUserId: replyToUserId,
  });

  return {
    comment: status === 'SPAM' ? null : toCommentDTO(row, { channelOwnerId: channel.ownerId, viewerId: viewer.id, reportedIds: new Set() }),
    outcome,
  };
}

async function notifyAboutNewComment(p: {
  status: CommentStatus;
  isOwner: boolean;
  ownerId: string;
  video: { id: string; title: string; channelId: string };
  commentId: string;
  authorId: string;
  authorName: string;
  body: string;
  repliedToUserId: string | null;
}): Promise<void> {
  const ctx = { video: p.video, commentId: p.commentId, authorName: p.authorName, authorId: p.authorId, body: p.body };
  if (p.status === 'PENDING') {
    await notify(pendingCommentNotice(ctx, p.ownerId));
  } else if (p.status === 'APPROVED') {
    if (p.repliedToUserId) await notify(replyNotice(ctx, p.repliedToUserId)); // replies notify the answered person
    else await notify(newCommentNotice(ctx, p.ownerId)); // top-level comments notify the creator
  }
  // SPAM: silent (the creator finds it in the spam tab; no notification noise).
}

/** Delete your own (visible) comment. A deleted top-level comment takes its replies with it, keeping counters exact. */
export async function deleteOwnComment(viewer: Viewer, commentId: string): Promise<void> {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, status: true, rootId: true },
  });
  if (!comment || comment.authorId !== viewer.id || (comment.status !== 'APPROVED' && comment.status !== 'PENDING')) {
    throw Errors.notFound('دیدگاه پیدا نشد.');
  }
  await deleteCommentThread(comment, viewer.id);
}
