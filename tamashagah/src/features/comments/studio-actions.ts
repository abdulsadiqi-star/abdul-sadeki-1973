'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/lib/errors';
import { requireChannelUser, requireUser } from '@/lib/auth/guards';
import { enforceRateLimit, limits } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { toViewer } from '@/features/engagement/viewer';
import type { CommentDTO } from './dto';
import { blockCommenter, moderateComment, moderateComments, replyAsCreator, unblockCommenter } from './moderation-service';
import {
  blockCommenterSchema,
  bulkModerateSchema,
  creatorReplySchema,
  moderateCommentSchema,
  unblockCommenterSchema,
} from './schemas';

/**
 * Studio moderation actions. Authentication is checked here, authorization (`canModerateComments`, derived from
 * the comment's channel in the database) inside the service, so a forged id from another channel is a 404.
 */

const touched = () => revalidatePath('/studio/comments');

export async function moderateCommentAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parse(moderateCommentSchema, input);
    await enforceRateLimit('comment-mod:user', user.id, limits.generalWrite);
    const result = await moderateComment(toViewer(user), data.commentId, data.status);
    touched();
    return result;
  });
}

export async function bulkModerateCommentsAction(input: unknown): Promise<ActionResult<{ changed: number; skipped: number }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parse(bulkModerateSchema, input);
    await enforceRateLimit('comment-mod:user', user.id, limits.generalWrite);
    const result = await moderateComments(toViewer(user), data.commentIds, data.status);
    touched();
    return result;
  });
}

export async function creatorReplyAction(input: unknown): Promise<ActionResult<{ reply: CommentDTO; approvedParent: boolean }>> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parse(creatorReplySchema, input);
    await enforceRateLimit('comment:user', user.id, limits.comment);
    const result = await replyAsCreator(toViewer(user), data.commentId, data.body);
    touched();
    return result;
  });
}

export async function blockCommenterAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const data = parse(blockCommenterSchema, input);
    await enforceRateLimit('comment-mod:user', user.id, limits.generalWrite);
    const result = await blockCommenter(toViewer(user), user.channel.id, data.userId, data.reason);
    touched();
    return result;
  });
}

export async function unblockCommenterAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const data = parse(unblockCommenterSchema, input);
    await enforceRateLimit('comment-mod:user', user.id, limits.generalWrite);
    const result = await unblockCommenter(toViewer(user), user.channel.id, data.userId);
    touched();
    return result;
  });
}
