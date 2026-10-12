'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { discoveryLimits } from '@/features/discovery/limits';
import { linkableVideoWhere } from '@/features/videos/visibility';
import { copyrightNoticeSchema } from './schemas';
import { formatCopyrightNotice, parseVideoReference } from './rules';

/**
 * File a copyright takedown notice. It creates, in one transaction, the two rows the admin panel works with:
 *   - a `SupportTicket(category = COPYRIGHT)` with the structured notice as its first message (the thread the claimant
 *     and the team continue in), and
 *   - a `Report(targetType = VIDEO, reason = COPYRIGHT)` so moderators see it in the reports queue
 *     (a user can report a video only once, so a second notice for the same video adds a ticket but no second report).
 * The video must be one anyone can open (public or unlisted): a private/hidden id looks exactly like a mistyped one.
 */
export async function createCopyrightNoticeAction(input: unknown): Promise<ActionResult<{ ticketId: string; number: number }>> {
  return runAction(async () => {
    const user = await requireVerifiedUser(); // sybil accounts must not be able to flood support
    const data = parse(copyrightNoticeSchema, input);
    await enforceRateLimit('copyright:user', user.id, discoveryLimits.copyrightNotice);

    const videoId = parseVideoReference(data.videoRef);
    if (!videoId) throw Errors.validation({ videoRef: ['نشانی ویدیو را به شکل «/watch/…» یا با شناسه‌ی ۱۱ نویسه‌ای وارد کنید.'] });
    const video = await db.video.findFirst({
      where: { ...linkableVideoWhere, id: videoId },
      select: { id: true, channel: { select: { ownerId: true } } },
    });
    if (!video) throw Errors.validation({ videoRef: ['ویدیویی با این نشانی پیدا نشد.'] });
    if (video.channel.ownerId === user.id) throw Errors.badRequest('نمی‌توانید برای ویدیوی کانال خودتان شکایت حق تکثیر ثبت کنید.');

    const ticket = await db.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          userId: user.id,
          email: data.contactEmail,
          subject: `شکایت حق تکثیر — ویدیوی ${video.id}`,
          category: 'COPYRIGHT',
          status: 'OPEN',
          messages: {
            create: {
              authorId: user.id,
              isStaff: false,
              body: formatCopyrightNotice({
                videoId: video.id,
                claimantName: data.claimantName,
                contactEmail: data.contactEmail,
                workDescription: data.workDescription,
                originalUrl: data.originalUrl,
                signature: data.signature,
              }),
            },
          },
        },
        select: { id: true, number: true },
      });
      const already = await tx.report.findFirst({ where: { reporterId: user.id, videoId: video.id }, select: { id: true } });
      if (!already) {
        await tx.report.create({
          data: {
            reporterId: user.id,
            targetType: 'VIDEO',
            videoId: video.id,
            reason: 'COPYRIGHT',
            details: `شکایت حق تکثیر از «${data.claimantName}»؛ جزئیات در تیکت شماره‌ی ${created.number}.`,
          },
        });
      }
      return created;
    });
    revalidatePath('/help/tickets');
    return { ticketId: ticket.id, number: ticket.number };
  });
}
