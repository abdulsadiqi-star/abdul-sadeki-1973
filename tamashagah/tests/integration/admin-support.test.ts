import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { closeTicketAction, reopenTicketAction, replyToTicketAction } from '@/features/admin/actions/support';
import { actAs, administrator, auditRows, createTicket, creator, expectFailure, logout, moderator, notificationsOf, plainUser } from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

beforeEach(() => logout());

const ticketOf = (id: string) => db.supportTicket.findUniqueOrThrow({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });

describe('support tickets: staff reply', () => {
  it('adds a staff message, answers the ticket, audits it and notifies the user', async () => {
    const mod = await moderator();
    const user = await plainUser('کاربر پشتیبانی‌خواه');
    const ticket = await createTicket({ userId: user.id });
    await actAs(mod);

    const res = await replyToTicketAction({ ticketId: ticket.id, body: 'سلام، مشکل از صف پردازش بود و برطرف شد.' });
    expect(res.ok).toBe(true);

    const row = await ticketOf(ticket.id);
    expect(row.status).toBe('ANSWERED');
    expect(row.messages).toHaveLength(2);
    expect(row.messages[1]).toMatchObject({ isStaff: true, authorId: mod.id, body: 'سلام، مشکل از صف پردازش بود و برطرف شد.' });
    expect(row.messages[0]).toMatchObject({ isStaff: false, authorId: user.id });

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'TICKET_REPLY', actorId: mod.id, targetUserId: user.id });
    expect(rows[0]!.meta).toMatchObject({ ticketId: ticket.id, number: ticket.number });
    const [note] = await notificationsOf(user.id);
    expect(note).toMatchObject({ type: 'TICKET_REPLY', actorId: mod.id });
    expect(note!.body).toContain('مشکل از صف پردازش');
    expect(note!.title).toContain('پاسخ جدید');
  });

  it('a second reply keeps the ticket ANSWERED; the status of a CLOSED ticket cannot be bypassed', async () => {
    const mod = await moderator();
    const ticket = await createTicket({ userId: (await plainUser()).id });
    await actAs(mod);
    await replyToTicketAction({ ticketId: ticket.id, body: 'پاسخ اول' });
    expect((await replyToTicketAction({ ticketId: ticket.id, body: 'پاسخ دوم' })).ok).toBe(true);
    expect((await ticketOf(ticket.id)).status).toBe('ANSWERED');

    await closeTicketAction({ ticketId: ticket.id });
    await expectFailure(replyToTicketAction({ ticketId: ticket.id, body: 'پاسخ به تیکت بسته' }), 'CONFLICT');
    expect((await ticketOf(ticket.id)).messages).toHaveLength(3); // user message + 2 replies, nothing added
    expect((await auditRows()).map((r) => r.type)).toEqual(['TICKET_REPLY', 'TICKET_REPLY', 'TICKET_CLOSE']);
  });

  it('validates the body (required, ≤ 5000 characters) and the ticket', async () => {
    const mod = await moderator();
    const ticket = await createTicket({ userId: (await plainUser()).id });
    await actAs(mod);
    await expectFailure(replyToTicketAction({ ticketId: ticket.id, body: '' }), 'VALIDATION');
    await expectFailure(replyToTicketAction({ ticketId: ticket.id, body: 'ا'.repeat(5001) }), 'VALIDATION');
    await expectFailure(replyToTicketAction({ ticketId: 't'.repeat(25), body: 'سلام' }), 'NOT_FOUND');
    expect((await ticketOf(ticket.id)).status).toBe('OPEN');
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('still works for tickets whose user is gone (nobody to notify)', async () => {
    const mod = await moderator();
    const ticket = await createTicket({ userId: null, email: 'guest@example.test' });
    await actAs(mod);
    expect((await replyToTicketAction({ ticketId: ticket.id, body: 'پاسخ برای مهمان' })).ok).toBe(true);
    expect(await db.notification.count()).toBe(0);
    expect((await auditRows())[0]).toMatchObject({ type: 'TICKET_REPLY', targetUserId: null });
  });

  it('staff cannot answer their own tickets; a moderator cannot answer an administrator’s', async () => {
    const mod = await moderator();
    const admin = await administrator();
    const own = await createTicket({ userId: mod.id });
    const adminsTicket = await createTicket({ userId: admin.id });
    await actAs(mod);
    await expectFailure(replyToTicketAction({ ticketId: own.id, body: 'پاسخ به خودم' }), 'FORBIDDEN');
    await expectFailure(replyToTicketAction({ ticketId: adminsTicket.id, body: 'پاسخ به مدیر' }), 'FORBIDDEN');
    await actAs(admin);
    expect((await replyToTicketAction({ ticketId: own.id, body: 'پاسخ مدیر به ناظر' })).ok).toBe(true);
    await expectFailure(replyToTicketAction({ ticketId: adminsTicket.id, body: 'پاسخ به خودم' }), 'FORBIDDEN');
  });

  it('creators cannot reply', async () => {
    const ticket = await createTicket({ userId: (await plainUser()).id });
    await actAs(await creator());
    await expectFailure(replyToTicketAction({ ticketId: ticket.id, body: 'من هم می‌خواهم پاسخ بدهم' }), 'FORBIDDEN');
    expect((await ticketOf(ticket.id)).messages).toHaveLength(1);
  });
});

describe('support tickets: close and reopen', () => {
  it('walks OPEN → CLOSED → OPEN with one audit row each and rejects invalid moves', async () => {
    const mod = await moderator();
    const user = await plainUser();
    const ticket = await createTicket({ userId: user.id });
    await actAs(mod);

    await expectFailure(reopenTicketAction({ ticketId: ticket.id }), 'CONFLICT'); // not closed
    expect((await closeTicketAction({ ticketId: ticket.id })).ok).toBe(true);
    expect((await ticketOf(ticket.id)).status).toBe('CLOSED');
    await expectFailure(closeTicketAction({ ticketId: ticket.id }), 'CONFLICT');
    expect((await reopenTicketAction({ ticketId: ticket.id })).ok).toBe(true);
    expect((await ticketOf(ticket.id)).status).toBe('OPEN');

    const rows = await auditRows();
    expect(rows.map((r) => r.type)).toEqual(['TICKET_CLOSE', 'TICKET_REOPEN']);
    expect(rows[0]!.meta).toMatchObject({ number: ticket.number, from: 'OPEN', to: 'CLOSED' });
    expect(rows[1]).toMatchObject({ actorId: mod.id, targetUserId: user.id });
  });

  it('an answered ticket can be closed', async () => {
    const mod = await moderator();
    const ticket = await createTicket({ userId: (await plainUser()).id, status: 'ANSWERED' });
    await actAs(mod);
    expect((await closeTicketAction({ ticketId: ticket.id })).ok).toBe(true);
    expect((await ticketOf(ticket.id)).status).toBe('CLOSED');
  });

  it('validates ids and hides nothing from staff', async () => {
    await actAs(await moderator());
    await expectFailure(closeTicketAction({ ticketId: 'x' }), 'VALIDATION');
    await expectFailure(closeTicketAction({ ticketId: 'x'.repeat(25) }), 'NOT_FOUND');
    expect(await notificationsOf('none')).toHaveLength(0);
  });
});
