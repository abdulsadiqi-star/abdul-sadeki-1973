'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireUser } from '@/lib/auth/guards';
import { toActor } from '@/lib/auth/session';
import { canModerateComments } from '@/lib/permissions';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { applyCommentStatus } from '@/features/comments/moderation-core';
import { notify } from '@/features/notifications/service';
import { studioLimits } from './limits';

const approveSchema = z.object({ commentId: z.string().min(10).max(40) }).strict();

/**
 * Dashboard quick action: approve a comment that is waiting for the creator.
 *
 * Authorization is re-derived from the database on every call: the comment must belong to a video of a channel the
 * caller may moderate (`canModerateComments`: the channel owner, or a moderator). Anything else answers 404 —
 * never 403 — so comment ids cannot be probed. Only PENDING comments are approvable here (an already approved one
 * is an idempotent no-op); rejected/spam/deleted comments are handled on the comments page.
 */
export async function approveCommentAction(input: unknown): Promise<ActionResult<{ approved: boolean }>> {
  return runAction(async () => {
    const user = await requireUser();
    const { commentId } = parse(approveSchema, input);
    await enforceRateLimit('studio-comment:user', user.id, studioLimits.moderate);

    const comment = await db.comment.findUnique({
      where: { id: commentId },
      select: { id: true, status: true, videoId: true, authorId: true, video: { select: { channelId: true, title: true } } },
    });
    if (!comment || !canModerateComments(toActor(user), { channelId: comment.video.channelId })) {
      throw Errors.notFound('دیدگاه پیدا نشد.');
    }
    if (comment.status === 'APPROVED') return { approved: true };
    if (comment.status !== 'PENDING') throw Errors.conflict('این دیدگاه دیگر در انتظار تأیید نیست.');

    const change = await applyCommentStatus(commentId, 'APPROVED', { actorId: user.id });
    if (change) {
      await notify({
        userId: comment.authorId,
        type: 'COMMENT_APPROVED',
        title: `دیدگاه شما در «${comment.video.title}» تأیید شد`,
        href: `/watch/${comment.videoId}`,
        actorId: user.id,
        videoId: comment.videoId,
        channelId: comment.video.channelId,
        commentId,
      });
    }
    revalidatePath('/studio');
    return { approved: true };
  });
}
