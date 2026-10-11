'use server';

import { runAction, type ActionResult } from '@/lib/errors';
import { requireUser, requireVerifiedUser } from '@/lib/auth/guards';
import { enforceRateLimit, limits } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { toViewer } from '@/features/engagement/viewer';
import type { PostCommentResultDTO } from './dto';
import { commentIdSchema, postCommentSchema } from './schemas';
import { deleteOwnComment, postComment } from './service';

/**
 * Post a comment (or a reply when `parentId` is set). Verified users only, rate limited, validated and
 * moderated on the server — see service.ts for the full rule set.
 */
export async function postCommentAction(input: unknown): Promise<ActionResult<PostCommentResultDTO>> {
  return runAction(async () => {
    const user = await requireVerifiedUser();
    const data = parse(postCommentSchema, input);
    await enforceRateLimit('comment:user', user.id, limits.comment);
    return postComment(toViewer(user), data);
  });
}

/** Delete one of your own comments (no verification needed to clean up after yourself). */
export async function deleteCommentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parse(commentIdSchema, input);
    await enforceRateLimit('comment-delete:user', user.id, limits.generalWrite);
    await deleteOwnComment(toViewer(user), data.commentId);
  });
}
