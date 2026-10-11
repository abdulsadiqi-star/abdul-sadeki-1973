/**
 * Reporting videos and comments (rows for the admin queue, which another feature owns).
 *
 * Rules: verified users only (enforced by the action), the reporter must be able to SEE the target (404
 * otherwise), nobody reports their own content, one report per reporter + target (database unique constraint →
 * CONFLICT). Runtime-agnostic.
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { normalizeUserText } from '@/lib/persian';
import { loadViewableVideo } from '@/features/watch/access';
import type { Viewer } from '@/features/engagement/service';
import { hasVisibleText } from '@/features/engagement/text';
import type { ReportReasonValue } from './schemas';
import { REPORT_DETAILS_MAX } from './schemas';

type ReportInput = { reason: ReportReasonValue; details?: string | null };

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';

function cleanDetails(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = normalizeUserText(raw, { multiline: true });
  if (!hasVisibleText(text)) return null;
  if (Array.from(text).length > REPORT_DETAILS_MAX) {
    throw Errors.validation({ details: [`توضیحات نباید بیش از ${REPORT_DETAILS_MAX} نویسه باشد.`] });
  }
  return text;
}

const actorOf = (v: Viewer) => ({ id: v.id, role: v.role, channelId: v.channelId, emailVerified: v.emailVerified });

export async function reportVideo(viewer: Viewer, videoId: string, input: ReportInput): Promise<{ id: string }> {
  const details = cleanDetails(input.details);
  const video = await loadViewableVideo(videoId, actorOf(viewer));
  if (video.channel.ownerId === viewer.id) throw Errors.badRequest('نمی‌توانید ویدیوی خودتان را گزارش کنید.');
  try {
    const report = await db.report.create({
      data: { reporterId: viewer.id, targetType: 'VIDEO', videoId: video.id, reason: input.reason, details },
      select: { id: true },
    });
    return report;
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict('شما قبلاً این ویدیو را گزارش کرده‌اید.');
    throw error;
  }
}

export async function reportComment(viewer: Viewer, commentId: string, input: ReportInput): Promise<{ id: string }> {
  const details = cleanDetails(input.details);
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, status: true, videoId: true },
  });
  // Only publicly visible comments can be reported; anything else looks exactly like a missing one.
  if (!comment || comment.status !== 'APPROVED') throw Errors.notFound('دیدگاه پیدا نشد.');
  await loadViewableVideo(comment.videoId, actorOf(viewer));
  if (comment.authorId === viewer.id) throw Errors.badRequest('نمی‌توانید دیدگاه خودتان را گزارش کنید.');

  try {
    // NB: videoId stays NULL on comment reports — (reporterId, videoId) is unique and must stay free for a report of the video itself.
    return await db.$transaction(async (tx) => {
      const report = await tx.report.create({
        data: { reporterId: viewer.id, targetType: 'COMMENT', commentId: comment.id, reason: input.reason, details },
        select: { id: true },
      });
      await tx.comment.update({ where: { id: comment.id }, data: { reportCount: { increment: 1 } } });
      return report;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict('شما قبلاً این دیدگاه را گزارش کرده‌اید.');
    throw error;
  }
}

/** Which of these comments the viewer already reported (so the UI can show "گزارش شد"). */
export async function getReportedCommentIds(userId: string | null, commentIds: string[]): Promise<Set<string>> {
  if (!userId || commentIds.length === 0) return new Set();
  const rows = await db.report.findMany({
    where: { reporterId: userId, commentId: { in: commentIds } },
    select: { commentId: true },
  });
  return new Set(rows.flatMap((r) => (r.commentId ? [r.commentId] : [])));
}
