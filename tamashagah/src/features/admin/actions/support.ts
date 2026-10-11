'use server';

import { runAction, type ActionResult } from '@/lib/errors';
import { parse } from '@/lib/validation';
import { closeTicket, reopenTicket, replyToTicket } from '@/features/moderation/support';
import { replyTicketSchema, ticketIdSchema } from '../schemas';
import { requireStaff } from '../guard';

export async function replyToTicketAction(input: unknown): Promise<ActionResult<{ messageId: string }>> {
  return runAction(async () => {
    const staff = await requireStaff('ticket.handle', 'reply');
    return replyToTicket(staff, parse(replyTicketSchema, input));
  });
}

export async function closeTicketAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('ticket.handle');
    await closeTicket(staff, parse(ticketIdSchema, input).ticketId);
  });
}

export async function reopenTicketAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('ticket.handle');
    await reopenTicket(staff, parse(ticketIdSchema, input).ticketId);
  });
}
