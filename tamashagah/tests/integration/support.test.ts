import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createCopyrightNoticeAction } from '@/features/support/copyright-actions';
import { getMyTicket, getVerificationOverview, listMyTickets } from '@/features/support/queries';
import { requestVerificationAction } from '@/features/support/verification-actions';
import { createTicketAction, replyTicketAction } from '@/features/support/actions';
import { MAX_MESSAGES_PER_TICKET, MAX_OPEN_TICKETS } from '@/features/support/schemas';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';

const ticketInput = { category: 'UPLOAD', subject: 'ویدیو پردازش نمی‌شود', message: 'ویدیویی را دیروز بارگذاری کردم و هنوز در صف پردازش است.' };

describe('tickets', () => {
  it('creates a real ticket with its first message (user side of the shared contract)', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const res = await createTicketAction(ticketInput);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.number).toBeGreaterThan(0);
    const row = await db.supportTicket.findUniqueOrThrow({ where: { id: res.data.id }, include: { messages: true } });
    expect(row).toMatchObject({ userId: user.id, email: user.email, category: 'UPLOAD', status: 'OPEN', subject: 'ویدیو پردازش نمی‌شود' });
    expect(row.messages).toHaveLength(1);
    expect(row.messages[0]).toMatchObject({ authorId: user.id, isStaff: false });
  });

  it('requires a login and validates input', async () => {
    logout();
    expect(await createTicketAction(ticketInput)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    const user = await createUser();
    await loginAs(user.id);
    for (const bad of [
      { ...ticketInput, subject: 'abc' },
      { ...ticketInput, subject: 'ا'.repeat(121) },
      { ...ticketInput, message: 'کوتاه' },
      { ...ticketInput, message: 'ا'.repeat(5001) },
      { ...ticketInput, category: 'HACKING' },
      {},
    ]) {
      expect(await createTicketAction(bad)).toMatchObject({ ok: false, code: 'VALIDATION' });
    }
    expect(await db.supportTicket.count()).toBe(0);
  });

  it('is rate limited (5 per hour) and capped at 10 open tickets', async () => {
    const user = await createUser();
    await loginAs(user.id);
    for (let i = 0; i < 5; i++) expect((await createTicketAction(ticketInput)).ok).toBe(true);
    expect(await createTicketAction(ticketInput)).toMatchObject({ ok: false, code: 'RATE_LIMITED' });

    const other = await createUser();
    await loginAs(other.id);
    await db.supportTicket.createMany({ data: Array.from({ length: MAX_OPEN_TICKETS }, (_, i) => ({ userId: other.id, email: other.email, subject: `تیکت ${i}`, category: 'OTHER' as const })) });
    expect(await createTicketAction(ticketInput)).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
  });

  it('lists and opens only MY tickets; somebody else’s ticket is not found', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await loginAs(alice.id);
    const a = await createTicketAction(ticketInput);
    await loginAs(bob.id);
    const b = await createTicketAction({ ...ticketInput, subject: 'تیکت باب' });
    if (!a.ok || !b.ok) throw new Error('setup failed');

    expect((await listMyTickets(alice.id, 1)).tickets.map((t) => t.id)).toEqual([a.data.id]);
    expect((await listMyTickets(bob.id, 1)).total).toBe(1);
    expect(await getMyTicket(alice.id, a.data.id)).not.toBeNull();
    expect(await getMyTicket(alice.id, b.data.id)).toBeNull();
    expect(await getMyTicket(bob.id, 'doesNotExist00')).toBeNull();
  });

  it('shows staff replies without staff identities and flags tickets waiting for the user', async () => {
    const user = await createUser();
    const staff = await createUser({ role: 'MODERATOR', displayName: 'ناظر محرمانه' });
    await loginAs(user.id);
    const created = await createTicketAction(ticketInput);
    if (!created.ok) throw new Error('setup failed');
    await db.ticketMessage.create({ data: { ticketId: created.data.id, authorId: staff.id, isStaff: true, body: 'سلام، بررسی شد.' } });
    await db.supportTicket.update({ where: { id: created.data.id }, data: { status: 'ANSWERED' } });

    const list = await listMyTickets(user.id, 1);
    expect(list.tickets[0]).toMatchObject({ status: 'ANSWERED', awaitingUser: true, messageCount: 2 });
    const thread = await getMyTicket(user.id, created.data.id);
    expect(thread!.messages.map((m) => m.isStaff)).toEqual([false, true]);
    expect(JSON.stringify(thread)).not.toContain('ناظر محرمانه');
    expect(JSON.stringify(thread)).not.toContain(staff.id);
  });

  it('a user reply re-opens an answered or closed ticket; replies to other people’s tickets are 404', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await loginAs(alice.id);
    const created = await createTicketAction(ticketInput);
    if (!created.ok) throw new Error('setup failed');
    const id = created.data.id;

    for (const status of ['ANSWERED', 'CLOSED'] as const) {
      await db.supportTicket.update({ where: { id }, data: { status } });
      expect((await replyTicketAction({ ticketId: id, body: 'ممنون، هنوز مشکل دارم.' })).ok).toBe(true);
      expect((await db.supportTicket.findUniqueOrThrow({ where: { id } })).status).toBe('OPEN');
    }
    expect(await db.ticketMessage.count({ where: { ticketId: id, isStaff: false } })).toBe(3);

    await loginAs(bob.id);
    expect(await replyTicketAction({ ticketId: id, body: 'نفوذ' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await db.ticketMessage.count({ where: { ticketId: id } })).toBe(3);

    logout();
    expect(await replyTicketAction({ ticketId: id, body: 'ناشناس' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    await loginAs(alice.id);
    expect(await replyTicketAction({ ticketId: id, body: ' ' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('stops accepting messages after the per-ticket cap', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const created = await createTicketAction(ticketInput);
    if (!created.ok) throw new Error('setup failed');
    await db.ticketMessage.createMany({ data: Array.from({ length: MAX_MESSAGES_PER_TICKET - 1 }, () => ({ ticketId: created.data.id, authorId: user.id, body: 'پیام' })) });
    expect(await replyTicketAction({ ticketId: created.data.id, body: 'یکی بیشتر' })).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
  });
});

describe('copyright notices', () => {
  const notice = (videoRef: string, over: Record<string, unknown> = {}) => ({
    videoRef,
    claimantName: 'علی رضایی',
    contactEmail: 'ali@example.test',
    workDescription: 'این فیلم اثر من است و بدون اجازه‌ی من بارگذاری شده است.',
    originalUrl: '',
    goodFaith: true,
    accuracy: true,
    signature: 'علی رضایی',
    ...over,
  });

  async function setup() {
    const owner = await createUser({ withChannel: true });
    const claimant = await createUser({ displayName: 'شاکی' });
    const video = await createVideo(owner.channel!.id, { title: 'ویدیوی مورد شکایت' });
    return { owner, claimant, video };
  }

  it('creates a COPYRIGHT ticket and a COPYRIGHT video report in one go', async () => {
    const { claimant, video } = await setup();
    await loginAs(claimant.id);
    const res = await createCopyrightNoticeAction(notice(`https://tamashagah.example/watch/${video.id}`));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ticket = await db.supportTicket.findUniqueOrThrow({ where: { id: res.data.ticketId }, include: { messages: true } });
    expect(ticket).toMatchObject({ userId: claimant.id, email: 'ali@example.test', category: 'COPYRIGHT', status: 'OPEN' });
    expect(ticket.subject).toContain(video.id);
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0]!.body).toContain(`/watch/${video.id}`);
    expect(ticket.messages[0]!.body).toContain('امضای الکترونیک: علی رضایی');
    const report = await db.report.findFirstOrThrow({ where: { videoId: video.id } });
    expect(report).toMatchObject({ reporterId: claimant.id, targetType: 'VIDEO', reason: 'COPYRIGHT', status: 'OPEN' });
    expect(report.details).toContain(String(res.data.number));
    // the claimant can follow the ticket on the site
    expect((await listMyTickets(claimant.id, 1)).tickets[0]).toMatchObject({ id: res.data.ticketId, category: 'COPYRIGHT' });
  });

  it('a repeated notice for the same video adds a ticket but not a second report', async () => {
    const { claimant, video } = await setup();
    await loginAs(claimant.id);
    expect((await createCopyrightNoticeAction(notice(video.id))).ok).toBe(true);
    expect((await createCopyrightNoticeAction(notice(video.id))).ok).toBe(true);
    expect(await db.supportTicket.count({ where: { category: 'COPYRIGHT' } })).toBe(2);
    expect(await db.report.count({ where: { videoId: video.id } })).toBe(1);
  });

  it('hidden and unknown videos look exactly the same: "not found" (no existence leak)', async () => {
    const { owner } = await setup();
    const hidden = await Promise.all((['private', 'draft', 'takedown', 'processing'] as const).map((state) => createVideo(owner.channel!.id, { state })));
    for (const ref of [...hidden.map((v) => v.id), 'zZzZzZzZzZz', '/watch/zZzZzZzZzZz']) {
      // a fresh claimant per probe: every attempt (even a failing one) counts against the per-user limit
      const claimant = await createUser();
      await loginAs(claimant.id);
      const res = await createCopyrightNoticeAction(notice(ref));
      expect(res, ref).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(JSON.stringify(res)).toContain('پیدا نشد');
    }
    expect(await db.supportTicket.count()).toBe(0);
    expect(await db.report.count()).toBe(0);
    // unlisted videos are reachable by link, so they may be reported
    const unlisted = await createVideo(owner.channel!.id, { state: 'unlisted' });
    await loginAs((await createUser()).id);
    expect((await createCopyrightNoticeAction(notice(unlisted.id))).ok).toBe(true);
  });

  it('probing ids is rate limited too: failed attempts count', async () => {
    const claimant = await createUser();
    await loginAs(claimant.id);
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await createCopyrightNoticeAction(notice('zZzZzZzZzZz'));
      codes.push(r.ok ? 'ok' : r.code);
    }
    expect(codes).toEqual(['VALIDATION', 'VALIDATION', 'VALIDATION', 'VALIDATION', 'VALIDATION', 'RATE_LIMITED']);
  });

  it('rejects notices against your own video, bad references and missing statements', async () => {
    const { owner, claimant, video } = await setup();
    await loginAs(owner.id);
    expect(await createCopyrightNoticeAction(notice(video.id))).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    await loginAs(claimant.id);
    expect(await createCopyrightNoticeAction(notice('not a video link at all'))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createCopyrightNoticeAction(notice(video.id, { goodFaith: false }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createCopyrightNoticeAction(notice(video.id, { accuracy: false }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createCopyrightNoticeAction(notice(video.id, { contactEmail: 'nope' }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await createCopyrightNoticeAction(notice(video.id, { workDescription: 'کوتاه' }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await db.supportTicket.count()).toBe(0);
  });

  it('requires a login and is rate limited (5 per day)', async () => {
    const { claimant, video } = await setup();
    logout();
    expect(await createCopyrightNoticeAction(notice(video.id))).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    await loginAs(claimant.id);
    for (let i = 0; i < 5; i++) expect((await createCopyrightNoticeAction(notice(video.id))).ok).toBe(true);
    expect(await createCopyrightNoticeAction(notice(video.id))).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('verification requests', () => {
  const message = 'من سازنده‌ی این کانال هستم و می‌خواهم هویت کانالم تأیید شود؛ مدارک در پیوندهای زیر است.';

  /** A channel that satisfies every measurable requirement. */
  async function eligible(over: { verified?: boolean } = {}) {
    const owner = await createUser({ withChannel: true, verified: over.verified });
    await db.channel.update({
      where: { id: owner.channel!.id },
      data: { createdAt: new Date(Date.now() - 45 * 86_400_000), avatarKey: `images/avatars/${owner.id}/abc.webp`, description: 'کانالی درباره‌ی آموزش برنامه‌نویسی و فناوری.' },
    });
    for (let i = 0; i < 3; i++) await createVideo(owner.channel!.id, { title: `ویدیو ${i}` });
    return owner;
  }

  it('creates a SUBMITTED request with evidence links for an eligible channel', async () => {
    const owner = await eligible();
    await loginAs(owner.id);
    const res = await requestVerificationAction({ message, evidenceLinks: [{ title: 'وب‌سایت رسمی', url: 'https://example.org/about' }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await db.verificationRequest.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row).toMatchObject({ channelId: owner.channel!.id, status: 'SUBMITTED', message });
    expect(row.evidenceLinks).toEqual([{ title: 'وب‌سایت رسمی', url: 'https://example.org/about' }]);
    const overview = await getVerificationOverview({ channelId: owner.channel!.id, emailVerified: true });
    expect(overview!.open).toMatchObject({ id: res.data.id, status: 'SUBMITTED' });
    expect(overview!.requirements.allMet).toBe(true);
  });

  it('only one open request at a time — also under concurrent submissions', async () => {
    const owner = await eligible();
    await loginAs(owner.id);
    const results = await Promise.all([requestVerificationAction({ message }), requestVerificationAction({ message }), requestVerificationAction({ message })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'CONFLICT')).toBe(true);
    expect(await db.verificationRequest.count({ where: { channelId: owner.channel!.id } })).toBe(1);
  });

  it('stays blocked while the team is reviewing, and is possible again after a decision', async () => {
    const owner = await eligible();
    await loginAs(owner.id);
    expect((await requestVerificationAction({ message })).ok).toBe(true);
    await db.verificationRequest.updateMany({ where: { channelId: owner.channel!.id }, data: { status: 'UNDER_REVIEW' } });
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'CONFLICT' });
    // …but possible again once the team has decided (rejected, with a note)
    await db.verificationRequest.updateMany({ where: { channelId: owner.channel!.id }, data: { status: 'REJECTED', decisionNote: 'مدارک کافی نیست.', reviewedAt: new Date() } });
    expect((await requestVerificationAction({ message })).ok).toBe(true);
    const overview = await getVerificationOverview({ channelId: owner.channel!.id, emailVerified: true });
    expect(overview!.open).not.toBeNull();
    expect(overview!.lastDecided).toMatchObject({ status: 'REJECTED', decisionNote: 'مدارک کافی نیست.' });
  });

  it('refuses channels that are already verified or suspended', async () => {
    const verified = await eligible();
    await db.channel.update({ where: { id: verified.channel!.id }, data: { isVerified: true } });
    await loginAs(verified.id);
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'CONFLICT' });

    const suspended = await eligible();
    await db.channel.update({ where: { id: suspended.channel!.id }, data: { suspendedAt: new Date() } });
    await loginAs(suspended.id);
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('enforces the measurable requirements on the server', async () => {
    const fresh = await createUser({ withChannel: true });
    await loginAs(fresh.id);
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    // meet all but one: too few public videos
    const almost = await eligible();
    await db.video.updateMany({ where: { channelId: almost.channel!.id }, data: { visibility: 'PRIVATE' } });
    await loginAs(almost.id);
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(await db.verificationRequest.count()).toBe(0);
  });

  it('needs a channel, a verified e-mail and a login', async () => {
    logout();
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    const noChannel = await createUser();
    await loginAs(noChannel.id);
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const unverified = await eligible({ verified: false });
    await loginAs(unverified.id);
    expect(await requestVerificationAction({ message })).toMatchObject({ ok: false, code: 'EMAIL_NOT_VERIFIED' });
  });

  it('validates the message and evidence links (https only, max 5) and is rate limited', async () => {
    const owner = await eligible();
    await loginAs(owner.id);
    expect(await requestVerificationAction({ message: 'کوتاه' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await requestVerificationAction({ message, evidenceLinks: [{ title: 'بد', url: 'javascript:alert(1)' }] })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await requestVerificationAction({ message, evidenceLinks: [{ title: 'ناامن', url: 'http://example.org' }] })).toMatchObject({ ok: false, code: 'VALIDATION' });
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `پیوند ${i}`, url: `https://example.org/${i}` }));
    expect(await requestVerificationAction({ message, evidenceLinks: six })).toMatchObject({ ok: false, code: 'VALIDATION' });

    // rate limit: 3 per day (validation failures above did not count — they fail before the limiter)
    const limited = await eligible();
    await loginAs(limited.id);
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await requestVerificationAction({ message });
      codes.push(r.ok ? 'ok' : r.code);
      if (r.ok) await db.verificationRequest.updateMany({ where: { channelId: limited.channel!.id }, data: { status: 'REJECTED' } });
    }
    expect(codes).toEqual(['ok', 'ok', 'ok', 'RATE_LIMITED']);
  });
});
