'use server';

import { revalidatePath } from 'next/cache';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireChannelUser, type ChannelUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { monetizationLimits } from './limits';
import { applicationInputSchema } from './schemas';
import { saveDraft, submitApplication, withdrawApplication } from './service';

/**
 * Creator-side monetization actions. The channel is taken from the session (never from the input) and the
 * authorization is re-derived on every call. NOTHING here can approve an application: the input has no status field
 * (and unknown fields are rejected), and the service only ever writes DRAFT or SUBMITTED.
 */

async function channelOwner(): Promise<ChannelUser> {
  const user = await requireChannelUser();
  if (!user.emailVerified) throw Errors.emailNotVerified('برای درخواست درآمدزایی ابتدا ایمیل خود را تأیید کنید.');
  await enforceRateLimit('monetization-write:user', user.id, monetizationLimits.write);
  return user;
}

/** Save contact e-mail and terms acceptance without submitting (allowed even before the channel is eligible). */
export async function saveApplicationDraftAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await channelOwner();
    const data = parse(applicationInputSchema, input);
    await saveDraft({ channelId: user.channel.id, ...data });
    revalidatePath('/studio/monetization');
  });
}

/** Submit for review — only when every requirement is met right now and the terms are accepted. */
export async function submitApplicationAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await channelOwner();
    const data = parse(applicationInputSchema, input);
    await submitApplication({ channelId: user.channel.id, ...data });
    revalidatePath('/studio/monetization');
  });
}

/** Withdraw a submitted application that no reviewer has picked up yet (it becomes a draft again). */
export async function withdrawApplicationAction(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await channelOwner();
    await withdrawApplication(user.channel.id);
    revalidatePath('/studio/monetization');
  });
}
