/**
 * Creator programs: monetization applications (administrators) and verification requests (moderators and up).
 *
 * State machines live in `features/admin/policy.ts`; here they are enforced with conditional updates
 * (`WHERE status = <status we read>`) so a request can never be decided twice or from a stale screen.
 * Runtime-agnostic (no next/* imports).
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { notify } from '@/features/notifications/service';
import {
  MONETIZATION_DECISION_TARGET,
  PENDING_MONETIZATION_STATUSES,
  PENDING_VERIFICATION_STATUSES,
  canTransitionMonetization,
  canTransitionVerification,
  checkTargetUser,
  monetizationDecisionsFrom,
  type MonetizationDecision,
} from '@/features/admin/policy';
import { writeAudit } from './audit';
import { messages } from './messages';
import { assertAllowed } from './permissions';
import type { Staff } from './types';

const ownerSelect = { id: true, role: true, displayName: true } as const;
const channelSelect = { id: true, name: true, handle: true, ownerId: true, isVerified: true, suspendedAt: true, owner: { select: ownerSelect } } as const;

// ===========================================================================
// Monetization (ADMIN)
// ===========================================================================

/** SUBMITTED → UNDER_REVIEW when an administrator opens the application. Idempotent; a workflow marker, not a decision. */
export async function startMonetizationReview(staff: Staff, id: string): Promise<{ changed: boolean }> {
  assertAllowed(checkTargetUser(staff, null, 'monetization.review'));
  const { count } = await db.monetizationApplication.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'UNDER_REVIEW' } });
  return { changed: count > 0 };
}

export async function decideMonetization(
  staff: Staff,
  input: { id: string; decision: MonetizationDecision; note: string | null },
): Promise<{ status: string }> {
  const application = await db.monetizationApplication.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, channel: { select: channelSelect } },
  });
  if (!application) throw Errors.notFound('درخواست پیدا نشد.');
  // The channel owner is the "target": nobody approves their own application, moderators never decide.
  assertAllowed(checkTargetUser(staff, application.channel.owner, 'monetization.review'));

  const to = MONETIZATION_DECISION_TARGET[input.decision];
  if (!monetizationDecisionsFrom(application.status).includes(input.decision) || !canTransitionMonetization(application.status, to)) {
    throw Errors.conflict('این درخواست در وضعیت فعلی خود قابل بررسی با این تصمیم نیست.');
  }
  if ((input.decision === 'REJECT' || input.decision === 'SUSPEND') && !input.note) {
    throw Errors.validation({ note: ['برای رد یا تعلیق، توضیح تصمیم الزامی است.'] });
  }

  await db.$transaction(async (tx) => {
    const { count } = await tx.monetizationApplication.updateMany({
      where: { id: application.id, status: application.status },
      data: { status: to, reviewedAt: new Date(), reviewedById: staff.id, decisionNote: input.note },
    });
    if (count === 0) throw Errors.conflict('وضعیت این درخواست تغییر کرده است. صفحه را تازه کنید.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: input.decision === 'APPROVE' || input.decision === 'REINSTATE' ? 'MONETIZATION_APPROVE' : 'MONETIZATION_REJECT',
      channelId: application.channel.id,
      targetUserId: application.channel.ownerId,
      reason: input.note,
      meta: { applicationId: application.id, action: input.decision, from: application.status, to, channelName: application.channel.name },
    });
  });

  await notify({
    userId: application.channel.ownerId,
    actorId: staff.id,
    channelId: application.channel.id,
    ...messages.monetization(input.decision, application.channel, input.note),
  });
  return { status: to };
}

export const isPendingMonetization = (status: string): boolean => (PENDING_MONETIZATION_STATUSES as readonly string[]).includes(status);

// ===========================================================================
// Verification requests (MODERATOR+)
// ===========================================================================

export async function startVerificationReview(staff: Staff, id: string): Promise<{ changed: boolean }> {
  assertAllowed(checkTargetUser(staff, null, 'verification.review'));
  const { count } = await db.verificationRequest.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'UNDER_REVIEW' } });
  return { changed: count > 0 };
}

export async function decideVerification(
  staff: Staff,
  input: { id: string; decision: 'APPROVE' | 'REJECT'; note: string | null },
): Promise<{ status: string }> {
  const request = await db.verificationRequest.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, channel: { select: channelSelect } },
  });
  if (!request) throw Errors.notFound('درخواست پیدا نشد.');
  assertAllowed(checkTargetUser(staff, request.channel.owner, 'verification.review'));

  const to = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (!canTransitionVerification(request.status, to)) throw Errors.conflict('این درخواست قبلاً بررسی شده است.');
  if (input.decision === 'REJECT' && !input.note) throw Errors.validation({ note: ['برای رد درخواست، دلیل آن را بنویسید.'] });
  if (input.decision === 'APPROVE' && request.channel.suspendedAt) throw Errors.conflict('کانال تعلیق‌شده را نمی‌توان تأیید کرد.');

  await db.$transaction(async (tx) => {
    const { count } = await tx.verificationRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: { status: to, reviewedAt: new Date(), reviewedById: staff.id, decisionNote: input.note },
    });
    if (count === 0) throw Errors.conflict('وضعیت این درخواست تغییر کرده است. صفحه را تازه کنید.');

    if (input.decision === 'APPROVE') {
      // Approval is the CHANNEL_VERIFY audit row; it is written even when the badge was already granted directly.
      const flip = await tx.channel.updateMany({
        where: { id: request.channel.id, isVerified: false },
        data: { isVerified: true, verifiedAt: new Date() },
      });
      await writeAudit(tx, {
        actorId: staff.id,
        type: 'CHANNEL_VERIFY',
        channelId: request.channel.id,
        targetUserId: request.channel.ownerId,
        reason: input.note,
        meta: { verificationRequestId: request.id, channelName: request.channel.name, alreadyVerified: flip.count === 0 },
      });
    } else {
      await writeAudit(tx, {
        actorId: staff.id,
        type: 'VERIFICATION_REJECT',
        channelId: request.channel.id,
        targetUserId: request.channel.ownerId,
        reason: input.note,
        meta: { verificationRequestId: request.id, channelName: request.channel.name },
      });
    }
  });

  await notify({
    userId: request.channel.ownerId,
    actorId: staff.id,
    channelId: request.channel.id,
    ...messages.verification(input.decision === 'APPROVE', request.channel, input.note),
  });
  return { status: to };
}

export const isPendingVerification = (status: string): boolean => (PENDING_VERIFICATION_STATUSES as readonly string[]).includes(status);
