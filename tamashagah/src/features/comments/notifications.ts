/**
 * Persian copy + inputs for the comment notifications (NEW_COMMENT, COMMENT_PENDING, COMMENT_REPLY,
 * COMMENT_APPROVED). Pure builders so the wording is testable and consistent between posting and moderation.
 */
import { truncate } from '@/lib/persian';
import type { NotifyInput } from '@/features/notifications/service';

type Ctx = {
  video: { id: string; title: string; channelId: string };
  commentId: string;
  /** Display name of the person who wrote the comment (channel name or user name). */
  authorName: string;
  authorId: string;
  body: string;
};

const videoLabel = (title: string) => `«${truncate(title, 48)}»`;
const excerpt = (body: string) => truncate(body.replace(/\s+/g, ' '), 140);
const watchHref = (videoId: string) => `/watch/${videoId}#comments`;

/** To the channel owner: a new public comment under one of their videos. */
export function newCommentNotice(ctx: Ctx, ownerId: string): NotifyInput {
  return {
    userId: ownerId,
    type: 'NEW_COMMENT',
    title: `${ctx.authorName} دیدگاهی زیر ${videoLabel(ctx.video.title)} نوشت`,
    body: excerpt(ctx.body),
    href: watchHref(ctx.video.id),
    actorId: ctx.authorId,
    videoId: ctx.video.id,
    channelId: ctx.video.channelId,
    commentId: ctx.commentId,
  };
}

/** To the channel owner: a comment is waiting for their approval (approval mode, or held by the spam rules). */
export function pendingCommentNotice(ctx: Ctx, ownerId: string): NotifyInput {
  return {
    userId: ownerId,
    type: 'COMMENT_PENDING',
    title: `${ctx.authorName} دیدگاهی زیر ${videoLabel(ctx.video.title)} نوشت که منتظر تأیید شماست`,
    body: excerpt(ctx.body),
    href: '/studio/comments?tab=pending',
    actorId: ctx.authorId,
    videoId: ctx.video.id,
    channelId: ctx.video.channelId,
    commentId: ctx.commentId,
  };
}

/** To the person who was answered. */
export function replyNotice(ctx: Ctx, repliedToUserId: string): NotifyInput {
  return {
    userId: repliedToUserId,
    type: 'COMMENT_REPLY',
    title: `${ctx.authorName} به دیدگاه شما زیر ${videoLabel(ctx.video.title)} پاسخ داد`,
    body: excerpt(ctx.body),
    href: watchHref(ctx.video.id),
    actorId: ctx.authorId,
    videoId: ctx.video.id,
    channelId: ctx.video.channelId,
    commentId: ctx.commentId,
  };
}

/** To the author once the creator approved (published) their comment. */
export function approvedNotice(ctx: Ctx, actorId: string | null): NotifyInput {
  return {
    userId: ctx.authorId,
    type: 'COMMENT_APPROVED',
    title: `دیدگاه شما زیر ${videoLabel(ctx.video.title)} تأیید و منتشر شد`,
    body: excerpt(ctx.body),
    href: watchHref(ctx.video.id),
    actorId,
    videoId: ctx.video.id,
    channelId: ctx.video.channelId,
    commentId: ctx.commentId,
  };
}
