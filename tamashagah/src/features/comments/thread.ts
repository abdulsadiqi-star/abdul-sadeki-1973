import { db } from '@/lib/db';
import { applyCommentStatus } from './moderation-core';

/**
 * Delete a comment through `applyCommentStatus`. Deleting a TOP-LEVEL comment also deletes its live replies
 * (APPROVED / PENDING): they would otherwise stay counted in `Video.commentCount` while no longer being
 * reachable. Replies are removed first, each one adjusting the counters exactly once.
 */
export async function deleteCommentThread(
  comment: { id: string; rootId: string | null },
  actorId: string | null,
  note?: string | null,
): Promise<void> {
  if (comment.rootId === null) {
    const replies = await db.comment.findMany({
      where: { rootId: comment.id, status: { in: ['APPROVED', 'PENDING'] } },
      select: { id: true },
    });
    for (const reply of replies) {
      await applyCommentStatus(reply.id, 'DELETED', { actorId, note: 'حذف همراه با دیدگاه اصلی' });
    }
  }
  await applyCommentStatus(comment.id, 'DELETED', { actorId, note });
}
