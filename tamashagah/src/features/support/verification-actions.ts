'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireChannelUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { discoveryLimits } from '@/features/discovery/limits';
import { publicVideoWhere } from '@/features/videos/visibility';
import { OPEN_VERIFICATION_STATUSES, evaluateVerificationRequirements } from './rules';
import { verificationRequestSchema } from './schemas';

/**
 * Ask for the verified badge. Rules, all enforced here from database state (never from the client):
 *  - the caller owns a channel and has a verified e-mail address;
 *  - the channel is not suspended and not already verified;
 *  - the measurable requirements are met (see `verificationRequirements`);
 *  - at most ONE open request (SUBMITTED / UNDER_REVIEW) per channel — checked under a row lock so two simultaneous
 *    submissions cannot both succeed.
 * The admin panel reviews `VerificationRequest` rows and writes status / decisionNote / reviewedBy.
 */
export async function requestVerificationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireChannelUser();
    if (!user.emailVerified) throw Errors.emailNotVerified('برای درخواست تیک تأیید ابتدا ایمیل خود را تأیید کنید.');
    const data = parse(verificationRequestSchema, input);
    await enforceRateLimit('verification:user', user.id, discoveryLimits.verificationRequest);

    const request = await db.$transaction(async (tx) => {
      // serialize concurrent submissions of the same channel
      await tx.$queryRaw`SELECT id FROM "Channel" WHERE id = ${user.channel.id} FOR UPDATE`;
      const channel = await tx.channel.findUnique({
        where: { id: user.channel.id },
        select: { id: true, isVerified: true, suspendedAt: true, avatarKey: true, description: true, createdAt: true },
      });
      if (!channel || channel.suspendedAt) throw Errors.forbidden('کانال شما در حال حاضر امکان ثبت درخواست ندارد.');
      if (channel.isVerified) throw Errors.conflict('کانال شما از قبل تیک تأیید دارد.');

      const open = await tx.verificationRequest.findFirst({
        where: { channelId: channel.id, status: { in: [...OPEN_VERIFICATION_STATUSES] } },
        select: { id: true },
      });
      if (open) throw Errors.conflict('درخواست قبلی شما هنوز در حال بررسی است. پس از اعلام نتیجه می‌توانید درخواست تازه‌ای ثبت کنید.');

      const publicVideoCount = await tx.video.count({ where: { ...publicVideoWhere, channelId: channel.id } });
      const { allMet } = evaluateVerificationRequirements({
        emailVerified: user.emailVerified,
        hasAvatar: !!channel.avatarKey,
        descriptionLength: channel.description.trim().length,
        channelCreatedAt: channel.createdAt,
        publicVideoCount,
        now: new Date(),
      });
      if (!allMet) throw Errors.badRequest('هنوز همه‌ی شرایط لازم برای درخواست تیک تأیید را ندارید.');

      return tx.verificationRequest.create({
        data: { channelId: channel.id, status: 'SUBMITTED', message: data.message, evidenceLinks: data.evidenceLinks },
        select: { id: true },
      });
    });
    revalidatePath('/verification');
    return request;
  });
}
