/**
 * Report workflow: loading a report with the information needed to authorize and audit a decision,
 * closing reports (the primary one and — optionally — every other open report on the same target),
 * and the two decisions that do not touch content: dismiss and warn.
 *
 * Runtime-agnostic (no next/* imports): called by the Server Actions in `features/admin/actions`.
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { notify } from '@/features/notifications/service';
import { OPEN_REPORT_STATUSES, checkTargetUser, isReportOpen } from '@/features/admin/policy';
import type { Prisma } from '@/generated/prisma/client';
import type { ReportStatus, ReportTarget } from '@/generated/prisma/enums';
import { writeAudit } from './audit';
import { messages, reportedThing } from './messages';
import { assertAllowed } from './permissions';
import type { Staff, TargetRef, Tx } from './types';

const ownerSelect = { id: true, role: true, displayName: true } as const;

export async function loadReport(tx: Tx, id: string) {
  return tx.report.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      targetType: true,
      videoId: true,
      commentId: true,
      channelId: true,
      video: {
        select: {
          id: true,
          title: true,
          channelId: true,
          channel: { select: { id: true, name: true, handle: true, ownerId: true, owner: { select: ownerSelect } } },
        },
      },
      comment: {
        select: {
          id: true,
          authorId: true,
          videoId: true,
          author: { select: ownerSelect },
          video: { select: { id: true, title: true, channelId: true, channel: { select: { id: true, name: true, handle: true } } } },
        },
      },
      channel: { select: { id: true, name: true, handle: true, ownerId: true, owner: { select: ownerSelect } } },
    },
  });
}
export type LoadedReport = NonNullable<Awaited<ReturnType<typeof loadReport>>>;

/** The thing the report points at (null when the row is inconsistent). */
export function reportTarget(r: Pick<LoadedReport, 'targetType' | 'videoId' | 'commentId' | 'channelId'>): TargetRef | null {
  if (r.targetType === 'VIDEO' && r.videoId) return { type: 'VIDEO', id: r.videoId };
  if (r.targetType === 'COMMENT' && r.commentId) return { type: 'COMMENT', id: r.commentId };
  if (r.targetType === 'CHANNEL' && r.channelId) return { type: 'CHANNEL', id: r.channelId };
  return null;
}

/** The USER whose content / account the report is about (the party the policy protects). */
export function reportOwner(r: LoadedReport): { id: string; role: Staff['role']; displayName: string } | null {
  switch (r.targetType) {
    case 'VIDEO':
      return r.video?.channel.owner ?? null;
    case 'COMMENT':
      return r.comment?.author ?? null;
    case 'CHANNEL':
      return r.channel?.owner ?? null;
  }
}

/** The channel a report concerns (the video's channel, the comment's video's channel, or the channel itself). */
export function reportChannelId(r: LoadedReport): string | null {
  switch (r.targetType) {
    case 'VIDEO':
      return r.video?.channelId ?? null;
    case 'COMMENT':
      return r.comment?.video.channelId ?? null;
    case 'CHANNEL':
      return r.channel?.id ?? null;
  }
}

/** Foreign keys + readable names for the audit row / texts of whatever the report points at. */
export function reportRefs(r: LoadedReport) {
  return {
    videoId: r.targetType === 'VIDEO' ? r.videoId : r.targetType === 'COMMENT' ? (r.comment?.videoId ?? null) : null,
    commentId: r.targetType === 'COMMENT' ? r.commentId : null,
    channelId: reportChannelId(r),
    videoTitle: r.targetType === 'VIDEO' ? (r.video?.title ?? null) : r.targetType === 'COMMENT' ? (r.comment?.video.title ?? null) : null,
    channelName:
      r.targetType === 'VIDEO' ? (r.video?.channel.name ?? null) : r.targetType === 'CHANNEL' ? (r.channel?.name ?? null) : (r.comment?.video.channel.name ?? null),
  };
}

export function reportsOnTarget(target: TargetRef): Prisma.ReportWhereInput {
  switch (target.type) {
    case 'VIDEO':
      return { targetType: 'VIDEO', videoId: target.id };
    case 'COMMENT':
      return { targetType: 'COMMENT', commentId: target.id };
    case 'CHANNEL':
      return { targetType: 'CHANNEL', channelId: target.id };
  }
}

/**
 * Close reports inside the caller's transaction.
 *  - `reportId` (optional) is the report the staff member is looking at: it MUST be open (409 otherwise).
 *  - `scope` lists targets whose OTHER open reports are closed too when `resolveAll` is true.
 * Returns every closed report id (primary first). All updates are conditional on the report still being open,
 * so two moderators deciding at the same time can never both "win".
 */
export async function closeReports(
  tx: Tx,
  opts: {
    staffId: string;
    status: Extract<ReportStatus, 'ACTIONED' | 'DISMISSED'>;
    resolution: string;
    reportId?: string | null;
    scope: TargetRef[];
    resolveAll: boolean;
  },
): Promise<string[]> {
  const now = new Date();
  const data = { status: opts.status, handledById: opts.staffId, handledAt: now, resolution: opts.resolution };
  const closed: string[] = [];

  if (opts.reportId) {
    const { count } = await tx.report.updateMany({
      where: { id: opts.reportId, status: { in: [...OPEN_REPORT_STATUSES] } },
      data,
    });
    if (count === 0) throw Errors.conflict('این گزارش قبلاً بررسی شده است.');
    closed.push(opts.reportId);
  }

  if (opts.resolveAll && opts.scope.length > 0) {
    const others = await tx.report.findMany({
      where: {
        status: { in: [...OPEN_REPORT_STATUSES] },
        OR: opts.scope.map(reportsOnTarget),
        ...(closed.length ? { id: { notIn: closed } } : {}),
      },
      select: { id: true },
    });
    if (others.length > 0) {
      const ids = others.map((o) => o.id);
      await tx.report.updateMany({ where: { id: { in: ids }, status: { in: [...OPEN_REPORT_STATUSES] } }, data });
      closed.push(...ids);
    }
  }
  return closed;
}

/**
 * Validate a client-supplied report id against the action it accompanies (never trust ids from the browser).
 * Actions that CLOSE the report need it open (the default); undo-style actions (restore, unblock, block) only
 * LINK the report from their audit row and pass `requireOpen: false`.
 */
export async function requireRelatedReport(
  tx: Tx,
  reportId: string | undefined | null,
  relates: (r: LoadedReport) => boolean,
  opts: { requireOpen?: boolean } = {},
): Promise<LoadedReport | null> {
  if (!reportId) return null;
  const report = await loadReport(tx, reportId);
  if (!report) throw Errors.notFound('گزارش پیدا نشد.');
  if (!relates(report)) throw Errors.badRequest('این گزارش به مورد انتخاب‌شده مربوط نیست.');
  if ((opts.requireOpen ?? true) && !isReportOpen(report.status)) throw Errors.conflict('این گزارش قبلاً بررسی شده است.');
  return report;
}

// ---------------------------------------------------------------------------
// Decisions that do not change content
// ---------------------------------------------------------------------------

/** OPEN → REVIEWING when a moderator opens the report. Idempotent; not a decision, so it writes no audit row. */
export async function startReportReview(staff: Staff, reportId: string): Promise<{ changed: boolean }> {
  assertAllowed(checkTargetUser(staff, null, 'reports.handle'));
  const { count } = await db.report.updateMany({ where: { id: reportId, status: 'OPEN' }, data: { status: 'REVIEWING' } });
  return { changed: count > 0 };
}

export async function dismissReport(
  staff: Staff,
  input: { reportId: string; reason: string; resolveAll: boolean },
): Promise<{ resolvedReportIds: string[] }> {
  const resolvedReportIds = await db.$transaction(async (tx) => {
    const report = await loadReport(tx, input.reportId);
    if (!report) throw Errors.notFound('گزارش پیدا نشد.');
    const target = reportTarget(report);
    const owner = reportOwner(report);
    // Reports about one's own content (or an administrator's, for a moderator) are handled by someone else.
    assertAllowed(checkTargetUser(staff, owner, 'reports.handle'));
    if (!isReportOpen(report.status)) throw Errors.conflict('این گزارش قبلاً بررسی شده است.');

    const ids = await closeReports(tx, {
      staffId: staff.id,
      status: 'DISMISSED',
      resolution: `رد گزارش: ${input.reason}`,
      reportId: report.id,
      scope: target ? [target] : [],
      resolveAll: input.resolveAll,
    });
    const refs = reportRefs(report);
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'REPORT_DISMISS',
      videoId: refs.videoId,
      commentId: refs.commentId,
      channelId: refs.channelId,
      targetUserId: owner?.id ?? null,
      reportId: report.id,
      reason: input.reason,
      meta: { targetType: report.targetType, resolvedReportIds: ids, videoTitle: refs.videoTitle, channelName: refs.channelName },
    });
    return ids;
  });
  return { resolvedReportIds };
}

export async function warnCreator(
  staff: Staff,
  input: { reportId: string; reason: string; resolveAll: boolean },
): Promise<{ resolvedReportIds: string[] }> {
  const outcome = await db.$transaction(async (tx) => {
    const report = await loadReport(tx, input.reportId);
    if (!report) throw Errors.notFound('گزارش پیدا نشد.');
    const target = reportTarget(report);
    const owner = reportOwner(report);
    if (!owner) throw Errors.conflict('سازنده‌ی این مورد دیگر وجود ندارد.');
    assertAllowed(checkTargetUser(staff, owner, 'creator.warn'));
    if (!isReportOpen(report.status)) throw Errors.conflict('این گزارش قبلاً بررسی شده است.');

    const ids = await closeReports(tx, {
      staffId: staff.id,
      status: 'ACTIONED',
      resolution: `هشدار به سازنده: ${input.reason}`,
      reportId: report.id,
      scope: target ? [target] : [],
      resolveAll: input.resolveAll,
    });
    const refs = reportRefs(report);
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'CREATOR_WARN',
      videoId: refs.videoId,
      commentId: refs.commentId,
      channelId: refs.channelId,
      targetUserId: owner.id,
      reportId: report.id,
      reason: input.reason,
      meta: { targetType: report.targetType, resolvedReportIds: ids, videoTitle: refs.videoTitle, channelName: refs.channelName, targetUserName: owner.displayName },
    });
    return { ids, owner, refs, targetType: report.targetType as ReportTarget };
  });

  const about = reportedThing(outcome.targetType, outcome.targetType === 'CHANNEL' ? outcome.refs.channelName : outcome.refs.videoTitle);
  await notify({
    userId: outcome.owner.id,
    actorId: staff.id,
    videoId: outcome.refs.videoId,
    commentId: outcome.refs.commentId,
    channelId: outcome.refs.channelId,
    ...messages.warning(about, input.reason),
  });
  return { resolvedReportIds: outcome.ids };
}
