/**
 * Shared fixtures of the staff-panel integration tests (not a test file itself).
 */
import { db } from '@/lib/db';
import { loginAs, logout } from '../helpers/auth';
import { createChannel, createUser, createVideo, type VideoState } from '../helpers/factories';
import type { Prisma } from '@/generated/prisma/client';
import type { CommentStatus, MonetizationStatus, ReportReason, ReportStatus, TicketStatus, UserRole, VerificationStatus } from '@/generated/prisma/enums';

export { loginAs, logout, createUser, createVideo, createChannel };

type User = Awaited<ReturnType<typeof createUser>>;

export const moderator = () => createUser({ role: 'MODERATOR', displayName: 'ناظر آزمایشی' });
export const administrator = () => createUser({ role: 'ADMIN', displayName: 'مدیر آزمایشی' });
export const creator = (displayName?: string) => createUser({ withChannel: true, displayName });
export const plainUser = (displayName?: string) => createUser({ displayName });

/** Sign in as `user` (a real database session), run `fn`, no cleanup needed (every test starts from empty tables). */
export async function actAs(user: Pick<User, 'id'>): Promise<void> {
  await loginAs(user.id);
}

export async function createComment(opts: {
  videoId: string;
  authorId: string;
  body?: string;
  status?: CommentStatus;
  parentId?: string;
}) {
  const status = opts.status ?? 'APPROVED';
  const comment = await db.comment.create({
    data: {
      videoId: opts.videoId,
      authorId: opts.authorId,
      body: opts.body ?? 'این یک دیدگاه آزمایشی است',
      status,
      parentId: opts.parentId ?? null,
      rootId: opts.parentId ?? null,
    },
  });
  if (status === 'APPROVED') {
    await db.video.update({ where: { id: opts.videoId }, data: { commentCount: { increment: 1 } } });
    if (opts.parentId) await db.comment.update({ where: { id: opts.parentId }, data: { replyCount: { increment: 1 } } });
  }
  return comment;
}

type ReportInput =
  | { reporterId: string | null; video: { id: string }; reason?: ReportReason; status?: ReportStatus; details?: string }
  | { reporterId: string | null; comment: { id: string }; reason?: ReportReason; status?: ReportStatus; details?: string }
  | { reporterId: string | null; channel: { id: string }; reason?: ReportReason; status?: ReportStatus; details?: string };

export async function createReport(input: ReportInput) {
  const base = { reporterId: input.reporterId, reason: input.reason ?? 'SPAM', status: input.status ?? 'OPEN', details: input.details ?? null };
  if ('video' in input) return db.report.create({ data: { ...base, targetType: 'VIDEO', videoId: input.video.id } });
  if ('comment' in input) return db.report.create({ data: { ...base, targetType: 'COMMENT', commentId: input.comment.id } });
  return db.report.create({ data: { ...base, targetType: 'CHANNEL', channelId: input.channel.id } });
}

export const auditRows = (where: Prisma.ModerationActionWhereInput = {}) =>
  db.moderationAction.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

export const notificationsOf = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

/** A creator with one public video — the usual subject of a moderation test. */
export async function creatorWithVideo(state: VideoState = 'public') {
  const owner = await creator();
  const video = await createVideo(owner.channel!.id, { state, title: 'ویدیوی آزمایشی' });
  return { owner, channel: owner.channel!, video };
}

export async function expectFailure(result: Promise<{ ok: boolean; code?: string; message?: string }> | { ok: boolean; code?: string; message?: string }, code: string) {
  const res = await result;
  if (res.ok) throw new Error(`expected ${code} but the action succeeded`);
  if (res.code !== code) throw new Error(`expected ${code} but got ${res.code}: ${res.message}`);
  return res as { ok: false; code: string; message: string };
}

export type { UserRole };


export async function createMonetizationApplication(channelId: string, status: MonetizationStatus = 'SUBMITTED') {
  return db.monetizationApplication.create({
    data: {
      channelId,
      status,
      acceptedTermsAt: new Date(),
      contactEmail: 'creator@example.test',
      submittedAt: status === 'DRAFT' ? null : new Date(),
      statsSnapshot: { followers: 1200, totalViews: 45000, watchHours: 620, videoCount: 9, capturedAt: new Date().toISOString() },
    },
  });
}

export async function createVerificationRequest(channelId: string, status: VerificationStatus = 'SUBMITTED') {
  return db.verificationRequest.create({
    data: {
      channelId,
      status,
      message: 'من مالک رسمی این کانال هستم.',
      evidenceLinks: [{ title: 'صفحه‌ی رسمی', url: 'https://example.com/official' }],
    },
  });
}

export async function createTicket(opts: { userId: string | null; status?: TicketStatus; subject?: string; body?: string; email?: string }) {
  const ticket = await db.supportTicket.create({
    data: {
      userId: opts.userId,
      email: opts.email ?? 'user@example.test',
      subject: opts.subject ?? 'ویدیوی من پردازش نمی‌شود',
      status: opts.status ?? 'OPEN',
      category: 'UPLOAD',
    },
  });
  await db.ticketMessage.create({ data: { ticketId: ticket.id, authorId: opts.userId, isStaff: false, body: opts.body ?? 'سلام، ویدیویی که دیروز بارگذاری کردم هنوز در صف پردازش است.' } });
  return ticket;
}
