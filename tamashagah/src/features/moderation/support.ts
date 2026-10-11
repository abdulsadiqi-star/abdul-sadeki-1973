/**
 * Support tickets — the staff side. (Users create tickets and reply on the public site; a user reply re-opens the ticket.)
 *
 *   reply  : OPEN | ANSWERED → ANSWERED, adds a TicketMessage(isStaff) and notifies the user (TICKET_REPLY)
 *   close  : OPEN | ANSWERED → CLOSED
 *   reopen : CLOSED → OPEN
 * Runtime-agnostic (no next/* imports).
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { notify } from '@/features/notifications/service';
import { canTransitionTicket, checkTargetUser } from '@/features/admin/policy';
import type { TicketStatus } from '@/generated/prisma/enums';
import { writeAudit } from './audit';
import { messages } from './messages';
import { assertAllowed } from './permissions';
import type { Staff } from './types';

async function loadTicket(ticketId: string) {
  const ticket = await db.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, number: true, status: true, userId: true, user: { select: { id: true, role: true, displayName: true } } },
  });
  if (!ticket) throw Errors.notFound('تیکت پیدا نشد.');
  return ticket;
}

export async function replyToTicket(staff: Staff, input: { ticketId: string; body: string }): Promise<{ messageId: string }> {
  const ticket = await loadTicket(input.ticketId);
  assertAllowed(checkTargetUser(staff, ticket.user, 'ticket.handle'));
  if (!canTransitionTicket(ticket.status, 'ANSWERED')) throw Errors.conflict('این تیکت بسته است؛ برای پاسخ‌دادن ابتدا آن را دوباره باز کنید.');

  const messageId = await db.$transaction(async (tx) => {
    const { count } = await tx.supportTicket.updateMany({
      where: { id: ticket.id, status: { in: ['OPEN', 'ANSWERED'] } },
      data: { status: 'ANSWERED' },
    });
    if (count === 0) throw Errors.conflict('وضعیت این تیکت تغییر کرده است. صفحه را تازه کنید.');
    const message = await tx.ticketMessage.create({
      data: { ticketId: ticket.id, authorId: staff.id, isStaff: true, body: input.body },
      select: { id: true },
    });
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'TICKET_REPLY',
      targetUserId: ticket.userId,
      meta: { ticketId: ticket.id, number: ticket.number, messageId: message.id },
    });
    return message.id;
  });

  if (ticket.userId) await notify({ userId: ticket.userId, actorId: staff.id, ...messages.ticketReply(ticket, input.body) });
  return { messageId };
}

async function moveTicket(
  staff: Staff,
  ticketId: string,
  opts: { from: TicketStatus[]; to: TicketStatus; type: 'TICKET_CLOSE' | 'TICKET_REOPEN'; conflict: string },
): Promise<void> {
  const ticket = await loadTicket(ticketId);
  assertAllowed(checkTargetUser(staff, ticket.user, 'ticket.handle'));
  if (!canTransitionTicket(ticket.status, opts.to) || !opts.from.includes(ticket.status)) throw Errors.conflict(opts.conflict);

  await db.$transaction(async (tx) => {
    const { count } = await tx.supportTicket.updateMany({ where: { id: ticket.id, status: ticket.status }, data: { status: opts.to } });
    if (count === 0) throw Errors.conflict('وضعیت این تیکت تغییر کرده است. صفحه را تازه کنید.');
    await writeAudit(tx, {
      actorId: staff.id,
      type: opts.type,
      targetUserId: ticket.userId,
      meta: { ticketId: ticket.id, number: ticket.number, from: ticket.status, to: opts.to },
    });
  });
}

export const closeTicket = (staff: Staff, ticketId: string) =>
  moveTicket(staff, ticketId, { from: ['OPEN', 'ANSWERED'], to: 'CLOSED', type: 'TICKET_CLOSE', conflict: 'این تیکت از قبل بسته شده است.' });

export const reopenTicket = (staff: Staff, ticketId: string) =>
  moveTicket(staff, ticketId, { from: ['CLOSED'], to: 'OPEN', type: 'TICKET_REOPEN', conflict: 'این تیکت بسته نیست.' });
