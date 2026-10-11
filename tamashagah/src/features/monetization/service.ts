import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { ACTIVE_STATUSES } from './rules';
import { computeEligibility } from './eligibility';
import { getMonetizationStats } from './queries';

/**
 * The creator side of the application flow. Every operation runs in a transaction that first takes a per-channel
 * advisory lock, so "one active application per channel" holds even when requests race (double clicks, two tabs, a
 * script) — no partial unique index (a schema change) is needed. The creator can only ever produce DRAFT and
 * SUBMITTED rows here; APPROVED / REJECTED / UNDER_REVIEW / SUSPENDED are set by reviewers in the admin panel.
 *
 * Reviewer code must update conditionally (e.g. `where: { id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }`) so a
 * decision can never overwrite a withdrawal that happened a moment earlier.
 */

type Tx = Prisma.TransactionClient;

async function lockChannel(tx: Tx, channelId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`monetization:${channelId}`}))`;
}

const findActive = (tx: Tx, channelId: string) =>
  tx.monetizationApplication.findFirst({
    where: { channelId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

export type ApplicationInput = { channelId: string; contactEmail: string; acceptTerms: boolean };

const ALREADY_ACTIVE = 'برای این کانال یک درخواست درآمدزایی فعال وجود دارد.';

/** Create the draft, or update it (contact e-mail and terms acceptance). Not allowed once submitted. */
export async function saveDraft(input: ApplicationInput, now: Date = new Date()) {
  return db.$transaction(async (tx) => {
    await lockChannel(tx, input.channelId);
    const active = await findActive(tx, input.channelId);
    if (active && active.status !== 'DRAFT') throw Errors.conflict(ALREADY_ACTIVE);
    const data = { contactEmail: input.contactEmail, acceptedTermsAt: input.acceptTerms ? (active?.acceptedTermsAt ?? now) : null };
    return active
      ? tx.monetizationApplication.update({ where: { id: active.id }, data })
      : tx.monetizationApplication.create({ data: { channelId: input.channelId, status: 'DRAFT', ...data } });
  });
}

/**
 * Submit for review. Re-verifies, ON THE SERVER AND AT THIS MOMENT, that the terms are accepted, the channel is not
 * suspended and every requirement is met — and stores the figures it decided on as `statsSnapshot` for the reviewer.
 */
export async function submitApplication(input: ApplicationInput, now: Date = new Date()) {
  if (!input.acceptTerms) {
    throw Errors.validation({ acceptTerms: ['برای ارسال درخواست باید شرایط برنامه‌ی درآمدزایی را بپذیرید.'] });
  }
  return db.$transaction(async (tx) => {
    await lockChannel(tx, input.channelId);

    const active = await findActive(tx, input.channelId);
    if (active && active.status !== 'DRAFT') throw Errors.conflict(ALREADY_ACTIVE);

    const stats = await getMonetizationStats(input.channelId, now);
    if (stats.channelSuspended) throw Errors.blocked('کانال شما مسدود شده است و نمی‌تواند درخواست درآمدزایی ثبت کند.');
    const eligibility = computeEligibility({ followers: stats.followers, watchHours: stats.watchHours, publicVideos: stats.publicVideos });
    if (!eligibility.eligible) throw Errors.conflict('هنوز شرایط لازم برای ارسال درخواست کامل نیست.');

    const data = {
      status: 'SUBMITTED' as const,
      contactEmail: input.contactEmail,
      acceptedTermsAt: now,
      submittedAt: now,
      reviewedAt: null,
      reviewedById: null,
      decisionNote: null,
      statsSnapshot: {
        followers: stats.followers,
        totalViews: stats.totalViews,
        watchHours: Math.round(stats.watchHours * 100) / 100,
        videoCount: stats.publicVideos,
        capturedAt: now.toISOString(),
      },
    };
    return active
      ? tx.monetizationApplication.update({ where: { id: active.id }, data })
      : tx.monetizationApplication.create({ data: { channelId: input.channelId, ...data } });
  });
}

/**
 * Take a SUBMITTED application back: it returns to DRAFT (no review happened, nothing is lost, the creator can edit
 * and send it again). Once a reviewer has picked it up (UNDER_REVIEW) or decided, it cannot be withdrawn.
 */
export async function withdrawApplication(channelId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockChannel(tx, channelId);
    const { count } = await tx.monetizationApplication.updateMany({
      where: { channelId, status: 'SUBMITTED' },
      // a draft carries no figures: they are recomputed at the next submission
      data: { status: 'DRAFT', submittedAt: null, statsSnapshot: Prisma.DbNull },
    });
    if (count === 0) throw Errors.conflict('درخواستی برای انصراف وجود ندارد؛ فقط درخواست‌های ارسال‌شده‌ی بررسی‌نشده قابل انصراف هستند.');
  });
}
