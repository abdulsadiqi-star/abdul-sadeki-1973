'use server';

import { runAction, type ActionResult } from '@/lib/errors';
import { parse } from '@/lib/validation';
import { decideMonetization, decideVerification, startMonetizationReview, startVerificationReview } from '@/features/moderation/requests';
import { decideMonetizationSchema, decideVerificationSchema, startReviewSchema } from '../schemas';
import { requireStaff, revalidatePublicSite } from '../guard';

/** Administrators only: opening an application moves SUBMITTED → UNDER_REVIEW (idempotent marker). */
export async function startMonetizationReviewAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  return runAction(async () => {
    const staff = await requireStaff('monetization.review');
    const { id } = parse(startReviewSchema, input);
    return startMonetizationReview(staff, id);
  });
}

export async function decideMonetizationAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const staff = await requireStaff('monetization.review', 'sensitive');
    return decideMonetization(staff, parse(decideMonetizationSchema, input));
  });
}

export async function startVerificationReviewAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  return runAction(async () => {
    const staff = await requireStaff('verification.review');
    const { id } = parse(startReviewSchema, input);
    return startVerificationReview(staff, id);
  });
}

export async function decideVerificationAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const staff = await requireStaff('verification.review');
    const result = await decideVerification(staff, parse(decideVerificationSchema, input));
    revalidatePublicSite();
    return result;
  });
}
