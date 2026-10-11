/**
 * Content moderation: videos, comments, channels and blocked commenters.
 *
 * Every function:
 *   1. re-reads what it acts on from the database (ids from the browser are never trusted),
 *   2. authorizes with the pure policy (`checkTargetUser`: matrix + self/admin rules),
 *   3. changes the data, closes the related reports and writes EXACTLY ONE audit row in ONE transaction,
 *   4. notifies the affected user afterwards (best effort — `notify` never throws).
 *
 * Runtime-agnostic (no next/* imports).
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { enqueueVideoCleanup } from '@/lib/queue';
import { applyCommentStatus } from '@/features/comments/moderation-core';
import { notify } from '@/features/notifications/service';
import { checkTargetUser } from '@/features/admin/policy';
import type { CommentStatus } from '@/generated/prisma/enums';
import { writeAudit } from './audit';
import { messages } from './messages';
import { assertAllowed } from './permissions';
import { closeReports, requireRelatedReport, type LoadedReport } from './reports';
import type { Staff, TargetRef } from './types';

const ownerSelect = { id: true, role: true, displayName: true } as const;

// ===========================================================================
// Videos
// ===========================================================================

async function loadVideo(videoId: string) {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      takedownAt: true,
      channelId: true,
      channel: { select: { id: true, name: true, handle: true, ownerId: true, owner: { select: ownerSelect } } },
    },
  });
  if (!video) throw Errors.notFound('ویدیو پیدا نشد.');
  return video;
}

export async function takedownVideo(
  staff: Staff,
  input: { videoId: string; reason: string; reportId?: string; resolveAll: boolean },
): Promise<{ resolvedReportIds: string[] }> {
  const video = await loadVideo(input.videoId);
  const owner = video.channel.owner;
  assertAllowed(checkTargetUser(staff, owner, 'video.takedown'));

  const resolvedReportIds = await db.$transaction(async (tx) => {
    await requireRelatedReport(tx, input.reportId, (r) => r.targetType === 'VIDEO' && r.videoId === video.id);
    const { count } = await tx.video.updateMany({
      where: { id: video.id, takedownAt: null },
      data: { takedownAt: new Date(), takedownReason: input.reason },
    });
    if (count === 0) throw Errors.conflict('این ویدیو از قبل از دسترس عمومی خارج شده است.');

    const ids = await closeReports(tx, {
      staffId: staff.id,
      status: 'ACTIONED',
      resolution: `خارج‌کردن ویدیو از دسترس: ${input.reason}`,
      reportId: input.reportId,
      scope: [{ type: 'VIDEO', id: video.id }],
      resolveAll: input.resolveAll,
    });
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'VIDEO_TAKEDOWN',
      videoId: video.id,
      channelId: video.channelId,
      targetUserId: owner.id,
      reportId: input.reportId,
      reason: input.reason,
      meta: { resolvedReportIds: ids, videoTitle: video.title },
    });
    return ids;
  });

  await notify({ userId: owner.id, actorId: staff.id, videoId: video.id, channelId: video.channelId, ...messages.videoTakedown(video, input.reason) });
  return { resolvedReportIds };
}

export async function restoreVideo(staff: Staff, input: { videoId: string; reason: string; reportId?: string }): Promise<void> {
  const video = await loadVideo(input.videoId);
  const owner = video.channel.owner;
  assertAllowed(checkTargetUser(staff, owner, 'video.restore'));

  await db.$transaction(async (tx) => {
    // The report (if any) is only linked, never closed: restoring is an undo, not a verdict on the report.
    await requireRelatedReport(tx, input.reportId, (r) => r.targetType === 'VIDEO' && r.videoId === video.id, { requireOpen: false });
    const { count } = await tx.video.updateMany({
      where: { id: video.id, takedownAt: { not: null } },
      data: { takedownAt: null, takedownReason: null },
    });
    if (count === 0) throw Errors.conflict('این ویدیو از دسترس خارج نشده است.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'VIDEO_RESTORE',
      videoId: video.id,
      channelId: video.channelId,
      targetUserId: owner.id,
      reportId: input.reportId,
      reason: input.reason,
      meta: { videoTitle: video.title },
    });
  });

  await notify({ userId: owner.id, actorId: staff.id, videoId: video.id, channelId: video.channelId, ...messages.videoRestore(video, input.reason) });
}

/**
 * Hard delete (administrators only): rows go in the same transaction as the audit row, the files are removed
 * by the `video.cleanup` job afterwards. Reports about the video are removed by the database cascade — the audit
 * row keeps the title and reason, so the decision stays explainable.
 */
export async function forceDeleteVideo(
  staff: Staff,
  input: { videoId: string; reason: string },
): Promise<{ cleanupQueued: boolean }> {
  const video = await loadVideo(input.videoId);
  const owner = video.channel.owner;
  assertAllowed(checkTargetUser(staff, owner, 'video.delete'));

  await db.$transaction(async (tx) => {
    const reportCount = await tx.report.count({ where: { targetType: 'VIDEO', videoId: video.id } });
    // videoId is stored in meta: the column itself becomes NULL (ON DELETE SET NULL) once the row is gone.
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'VIDEO_DELETE',
      channelId: video.channelId,
      targetUserId: owner.id,
      reason: input.reason,
      meta: { videoId: video.id, videoTitle: video.title, channelName: video.channel.name, deletedReports: reportCount },
    });
    const { count } = await tx.video.deleteMany({ where: { id: video.id } });
    if (count === 0) throw Errors.notFound('ویدیو پیدا نشد.');
  });

  let cleanupQueued = true;
  try {
    await enqueueVideoCleanup(video.id);
  } catch (err) {
    cleanupQueued = false;
    logger.error({ err, videoId: video.id }, 'video deleted but the storage cleanup job could not be queued');
  }
  await notify({ userId: owner.id, actorId: staff.id, channelId: video.channelId, ...messages.videoDelete(video, input.reason) });
  return { cleanupQueued };
}

// ===========================================================================
// Comments (always through applyCommentStatus — the single owner of counters and comment audit rows)
// ===========================================================================

async function loadComment(commentId: string) {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      status: true,
      videoId: true,
      authorId: true,
      moderatedById: true,
      author: { select: ownerSelect },
      video: { select: { id: true, title: true, channelId: true } },
    },
  });
  if (!comment) throw Errors.notFound('دیدگاه پیدا نشد.');
  return comment;
}

export async function deleteComment(
  staff: Staff,
  input: { commentId: string; reason: string; reportId?: string; resolveAll: boolean },
): Promise<{ resolvedReportIds: string[] }> {
  const comment = await loadComment(input.commentId);
  assertAllowed(checkTargetUser(staff, comment.author, 'comment.delete'));
  if (comment.status === 'DELETED') throw Errors.conflict('این دیدگاه از قبل حذف شده است.');

  const resolvedReportIds = await db.$transaction(async (tx) => {
    await requireRelatedReport(tx, input.reportId, (r) => r.targetType === 'COMMENT' && r.commentId === comment.id);
    const ids = await closeReports(tx, {
      staffId: staff.id,
      status: 'ACTIONED',
      resolution: `حذف دیدگاه: ${input.reason}`,
      reportId: input.reportId,
      scope: [{ type: 'COMMENT', id: comment.id }],
      resolveAll: input.resolveAll,
    });
    const change = await applyCommentStatus(comment.id, 'DELETED', {
      actorId: staff.id,
      note: input.reason,
      tx,
      audit: { reportId: input.reportId ?? null, meta: { resolvedReportIds: ids } },
    });
    if (!change) throw Errors.conflict('این دیدگاه از قبل حذف شده است.');
    return ids;
  });

  await notify({
    userId: comment.authorId,
    actorId: staff.id,
    videoId: comment.videoId,
    commentId: comment.id,
    channelId: comment.video.channelId,
    ...messages.commentDelete(comment, input.reason),
  });
  return { resolvedReportIds };
}

const RESTORABLE_STATUSES: readonly CommentStatus[] = ['APPROVED', 'PENDING', 'REJECTED', 'SPAM'];

/**
 * Undo a deletion: the comment returns to the state it had before it was deleted (normally APPROVED), so the
 * creator's own decisions (rejected / spam / waiting for approval) are not overridden. Comments their author
 * deleted themselves cannot be restored by staff.
 */
export async function restoreComment(
  staff: Staff,
  input: { commentId: string; reason: string; reportId?: string },
): Promise<{ restoredTo: CommentStatus }> {
  const comment = await loadComment(input.commentId);
  assertAllowed(checkTargetUser(staff, comment.author, 'comment.restore'));
  if (comment.status !== 'DELETED') throw Errors.conflict('این دیدگاه حذف نشده است.');
  if (comment.moderatedById && comment.moderatedById === comment.authorId) {
    throw Errors.conflict('این دیدگاه را خود نویسنده حذف کرده است و قابل بازگرداندن نیست.');
  }

  const restoredTo = await db.$transaction(async (tx) => {
    await requireRelatedReport(tx, input.reportId, (r) => r.targetType === 'COMMENT' && r.commentId === comment.id, { requireOpen: false });
    const lastDeletion = await tx.moderationAction.findFirst({
      where: { commentId: comment.id, type: 'COMMENT_DELETE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { meta: true },
    });
    const before = (lastDeletion?.meta as { from?: CommentStatus } | null)?.from;
    const target: CommentStatus = before && RESTORABLE_STATUSES.includes(before) ? before : 'APPROVED';
    const change = await applyCommentStatus(comment.id, target, {
      actorId: staff.id,
      note: input.reason,
      tx,
      audit: { type: 'COMMENT_RESTORE', reportId: input.reportId ?? null },
    });
    if (!change) throw Errors.conflict('وضعیت این دیدگاه تغییر کرده است. صفحه را تازه کنید.');
    return target;
  });

  await notify({
    userId: comment.authorId,
    actorId: staff.id,
    videoId: comment.videoId,
    commentId: comment.id,
    channelId: comment.video.channelId,
    ...messages.commentRestore(comment, input.reason),
  });
  return { restoredTo };
}

// ===========================================================================
// Blocked commenters
// ===========================================================================

async function loadBlockSubjects(channelId: string, userId: string) {
  const [channel, user] = await Promise.all([
    db.channel.findUnique({ where: { id: channelId }, select: { id: true, name: true, ownerId: true } }),
    db.user.findUnique({ where: { id: userId }, select: ownerSelect }),
  ]);
  if (!channel) throw Errors.notFound('کانال پیدا نشد.');
  if (!user) throw Errors.notFound('کاربر پیدا نشد.');
  if (user.id === channel.ownerId) throw Errors.badRequest('مالک کانال را نمی‌توان از دیدگاه‌گذاشتن در کانال خودش مسدود کرد.');
  return { channel, user };
}

export async function blockCommenter(
  staff: Staff,
  input: { channelId: string; userId: string; reason: string; reportId?: string },
): Promise<void> {
  const { channel, user } = await loadBlockSubjects(input.channelId, input.userId);
  assertAllowed(checkTargetUser(staff, user, 'commenter.block'));

  await db.$transaction(async (tx) => {
    await requireRelatedReport(
      tx,
      input.reportId,
      (r) => r.targetType === 'COMMENT' && r.comment?.authorId === user.id && r.comment.video.channelId === channel.id,
      { requireOpen: false },
    );
    const { count } = await tx.channelBlock.createMany({
      data: [{ channelId: channel.id, userId: user.id, reason: input.reason }],
      skipDuplicates: true,
    });
    if (count === 0) throw Errors.conflict('این کاربر از قبل در این کانال مسدود است.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'CHANNEL_USER_BLOCK',
      channelId: channel.id,
      targetUserId: user.id,
      reportId: input.reportId,
      reason: input.reason,
      meta: { channelName: channel.name, targetUserName: user.displayName },
    });
  });

  await notify({ userId: user.id, actorId: staff.id, channelId: channel.id, ...messages.commenterBlocked(channel, input.reason) });
}

export async function unblockCommenter(
  staff: Staff,
  input: { channelId: string; userId: string; reason: string; reportId?: string },
): Promise<void> {
  const { channel, user } = await loadBlockSubjects(input.channelId, input.userId);
  assertAllowed(checkTargetUser(staff, user, 'commenter.block'));

  await db.$transaction(async (tx) => {
    await requireRelatedReport(
      tx,
      input.reportId,
      (r) => r.targetType === 'COMMENT' && r.comment?.authorId === user.id && r.comment.video.channelId === channel.id,
      { requireOpen: false },
    );
    const { count } = await tx.channelBlock.deleteMany({ where: { channelId: channel.id, userId: user.id } });
    if (count === 0) throw Errors.conflict('این کاربر در این کانال مسدود نیست.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'CHANNEL_USER_UNBLOCK',
      channelId: channel.id,
      targetUserId: user.id,
      reportId: input.reportId,
      reason: input.reason,
      meta: { channelName: channel.name, targetUserName: user.displayName },
    });
  });

  await notify({ userId: user.id, actorId: staff.id, channelId: channel.id, ...messages.commenterUnblocked(channel, input.reason) });
}

// ===========================================================================
// Channels
// ===========================================================================

async function loadChannel(channelId: string) {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, name: true, handle: true, isVerified: true, suspendedAt: true, ownerId: true, owner: { select: ownerSelect } },
  });
  if (!channel) throw Errors.notFound('کانال پیدا نشد.');
  return channel;
}

/** A report may accompany a channel decision when it is about the channel itself or one of its videos. */
const relatesToChannel = (channelId: string) => (r: LoadedReport) =>
  (r.targetType === 'CHANNEL' && r.channelId === channelId) || (r.targetType === 'VIDEO' && r.video?.channelId === channelId);

export async function suspendChannel(
  staff: Staff,
  input: { channelId: string; reason: string; reportId?: string; resolveAll: boolean },
): Promise<{ resolvedReportIds: string[] }> {
  const channel = await loadChannel(input.channelId);
  assertAllowed(checkTargetUser(staff, channel.owner, 'channel.suspend'));

  const resolvedReportIds = await db.$transaction(async (tx) => {
    const primary = await requireRelatedReport(tx, input.reportId, relatesToChannel(channel.id));
    const { count } = await tx.channel.updateMany({ where: { id: channel.id, suspendedAt: null }, data: { suspendedAt: new Date() } });
    if (count === 0) throw Errors.conflict('این کانال از قبل تعلیق شده است.');

    const scope: TargetRef[] = [{ type: 'CHANNEL', id: channel.id }];
    if (primary?.targetType === 'VIDEO' && primary.videoId) scope.push({ type: 'VIDEO', id: primary.videoId });
    const ids = await closeReports(tx, {
      staffId: staff.id,
      status: 'ACTIONED',
      resolution: `تعلیق کانال: ${input.reason}`,
      reportId: input.reportId,
      scope,
      resolveAll: input.resolveAll,
    });
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'CHANNEL_SUSPEND',
      channelId: channel.id,
      targetUserId: channel.ownerId,
      reportId: input.reportId,
      reason: input.reason,
      meta: { resolvedReportIds: ids, channelName: channel.name },
    });
    return ids;
  });

  await notify({ userId: channel.ownerId, actorId: staff.id, channelId: channel.id, ...messages.channelSuspend(channel, input.reason) });
  return { resolvedReportIds };
}

export async function restoreChannel(staff: Staff, input: { channelId: string; reason: string; reportId?: string }): Promise<void> {
  const channel = await loadChannel(input.channelId);
  assertAllowed(checkTargetUser(staff, channel.owner, 'channel.restore'));

  await db.$transaction(async (tx) => {
    await requireRelatedReport(tx, input.reportId, relatesToChannel(channel.id), { requireOpen: false });
    const { count } = await tx.channel.updateMany({ where: { id: channel.id, suspendedAt: { not: null } }, data: { suspendedAt: null } });
    if (count === 0) throw Errors.conflict('این کانال تعلیق نشده است.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'CHANNEL_RESTORE',
      channelId: channel.id,
      targetUserId: channel.ownerId,
      reportId: input.reportId,
      reason: input.reason,
      meta: { channelName: channel.name },
    });
  });

  await notify({ userId: channel.ownerId, actorId: staff.id, channelId: channel.id, ...messages.channelRestore(channel, input.reason) });
}

export async function verifyChannel(staff: Staff, input: { channelId: string; note: string | null }): Promise<void> {
  const channel = await loadChannel(input.channelId);
  assertAllowed(checkTargetUser(staff, channel.owner, 'channel.verify'));
  if (channel.suspendedAt) throw Errors.conflict('کانال تعلیق‌شده را نمی‌توان تأیید کرد.');

  await db.$transaction(async (tx) => {
    const { count } = await tx.channel.updateMany({
      where: { id: channel.id, isVerified: false },
      data: { isVerified: true, verifiedAt: new Date() },
    });
    if (count === 0) throw Errors.conflict('این کانال از قبل تأیید شده است.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'CHANNEL_VERIFY',
      channelId: channel.id,
      targetUserId: channel.ownerId,
      reason: input.note,
      meta: { channelName: channel.name, source: 'direct' },
    });
  });

  await notify({ userId: channel.ownerId, actorId: staff.id, channelId: channel.id, ...messages.channelVerified(channel, input.note) });
}

export async function unverifyChannel(staff: Staff, input: { channelId: string; reason: string }): Promise<void> {
  const channel = await loadChannel(input.channelId);
  assertAllowed(checkTargetUser(staff, channel.owner, 'channel.verify'));

  await db.$transaction(async (tx) => {
    const { count } = await tx.channel.updateMany({
      where: { id: channel.id, isVerified: true },
      data: { isVerified: false, verifiedAt: null },
    });
    if (count === 0) throw Errors.conflict('این کانال تأیید نشده است.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'CHANNEL_UNVERIFY',
      channelId: channel.id,
      targetUserId: channel.ownerId,
      reason: input.reason,
      meta: { channelName: channel.name },
    });
  });

  await notify({ userId: channel.ownerId, actorId: staff.id, channelId: channel.id, ...messages.channelUnverified(channel, input.reason) });
}
