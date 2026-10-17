'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { enforceRateLimit, limits } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { discoveryLimits } from '@/features/discovery/limits';
import { MAX_MESSAGES_PER_TICKET, MAX_OPEN_TICKETS, createTicketSchema, replyTicketSchema } from './schemas';

/**
 * User side of the support tickets. The staff side (admin panel) shares the same rows:
 *   - a user ticket/reply  → `TicketMessage { isStaff: false }`, ticket status OPEN (a reply re-opens a closed ticket)
 *   - a staff reply        → `TicketMessage { isStaff: true }`, ticket status ANSWERED (written by the admin panel)
 * A ticket that is not yours is "not found" (404), never "forbidden".
 */

export async function createTicketAction(input: unknown): Promise<ActionResult<{ id: string; number: number }>> {
  return runAction(async () => {
    const user = await requireVerifiedUser(); // sybil accounts must not be able to flood support
    const data = parse(createTicketSchema, input);
    await enforceRateLimit('ticket:user', user.id, limits.ticket);
    const open = await db.supportTicket.count({ where: { userId: user.id, status: 'OPEN' } });
    if (open >= MAX_OPEN_TICKETS) {
      throw Errors.quotaExceeded('چند تیکت باز دارید که هنوز بررسی نشده‌اند. لطفاً تا پاسخ پشتیبانی صبر کنید یا یکی از تیکت‌ها را تکمیل کنید.');
    }
    const ticket = await db.supportTicket.create({
      data: {
        userId: user.id,
        email: user.email,
        subject: data.subject,
        category: data.category,
        status: 'OPEN',
        messages: { create: { authorId: user.id, isStaff: false, body: data.message } },
      },
      select: { id: true, number: true },
    });
    revalidatePath('/help/tickets');
    return ticket;
  });
}

export async function replyTicketAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireVerifiedUser(); // sybil accounts must not be able to flood support
    const { ticketId, body } = parse(replyTicketSchema, input);
    const ticket = await db.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, _count: { select: { messages: true } } },
    });
    if (!ticket || ticket.userId !== user.id) throw Errors.notFound('تیکت پیدا نشد.');
    await enforceRateLimit('ticket:reply', user.id, discoveryLimits.ticketReply);
    if (ticket._count.messages >= MAX_MESSAGES_PER_TICKET) {
      throw Errors.quotaExceeded('این گفتگو به سقف تعداد پیام‌ها رسیده است. لطفاً تیکت تازه‌ای ثبت کنید.');
    }
    await db.$transaction([
      db.ticketMessage.create({ data: { ticketId: ticket.id, authorId: user.id, isStaff: false, body } }),
      // a user reply always re-opens the ticket (also when it was answered or closed)
      db.supportTicket.update({ where: { id: ticket.id }, data: { status: 'OPEN' } }),
    ]);
    revalidatePath('/help/tickets');
    revalidatePath(`/help/tickets/${ticket.id}`);
  });
}
