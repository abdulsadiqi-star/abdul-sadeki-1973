import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  decideMonetizationAction,
  decideVerificationAction,
  startMonetizationReviewAction,
  startVerificationReviewAction,
} from '@/features/admin/actions/requests';
import { decideMonetization } from '@/features/moderation/requests';
import {
  actAs,
  administrator,
  auditRows,
  createMonetizationApplication,
  createVerificationRequest,
  creator,
  expectFailure,
  logout,
  moderator,
  notificationsOf,
} from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

beforeEach(() => logout());

const statusOf = async (id: string) => (await db.monetizationApplication.findUniqueOrThrow({ where: { id } })).status;

describe('monetization applications (administrators only)', () => {
  async function setup(status: Parameters<typeof createMonetizationApplication>[1] = 'SUBMITTED') {
    const admin = await administrator();
    const owner = await creator('سازنده‌ی متقاضی');
    const application = await createMonetizationApplication(owner.channel!.id, status);
    await actAs(admin);
    return { admin, owner, channel: owner.channel!, application };
  }

  it('marks SUBMITTED as UNDER_REVIEW once, without an audit row, and never changes other states', async () => {
    const { application } = await setup();
    expect(await startMonetizationReviewAction({ id: application.id })).toEqual({ ok: true, data: { changed: true } });
    expect(await statusOf(application.id)).toBe('UNDER_REVIEW');
    expect(await startMonetizationReviewAction({ id: application.id })).toEqual({ ok: true, data: { changed: false } });
    await db.monetizationApplication.update({ where: { id: application.id }, data: { status: 'APPROVED' } });
    await startMonetizationReviewAction({ id: application.id });
    expect(await statusOf(application.id)).toBe('APPROVED');
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('approves: status + reviewer + note, MONETIZATION_APPROVE audit row, MONETIZATION_UPDATE notification', async () => {
    const { admin, owner, channel, application } = await setup();
    await startMonetizationReviewAction({ id: application.id });
    const res = await decideMonetizationAction({ id: application.id, decision: 'APPROVE', note: 'شرایط برقرار است' });
    expect(res).toEqual({ ok: true, data: { status: 'APPROVED' } });

    expect(await db.monetizationApplication.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({
      status: 'APPROVED',
      reviewedById: admin.id,
      decisionNote: 'شرایط برقرار است',
      reviewedAt: expect.any(Date),
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'MONETIZATION_APPROVE', actorId: admin.id, channelId: channel.id, targetUserId: owner.id, reason: 'شرایط برقرار است' });
    expect(rows[0]!.meta).toMatchObject({ applicationId: application.id, action: 'APPROVE', from: 'UNDER_REVIEW', to: 'APPROVED' });
    const [note] = await notificationsOf(owner.id);
    expect(note).toMatchObject({ type: 'MONETIZATION_UPDATE', actorId: admin.id, href: '/studio/monetization' });
    expect(note!.title).toContain('تأیید شد');
    expect(note!.body).toContain('شرایط برقرار است');
  });

  it('can decide straight from SUBMITTED', async () => {
    const { application } = await setup();
    expect((await decideMonetizationAction({ id: application.id, decision: 'REJECT', note: 'ساعت تماشا کافی نیست' })).ok).toBe(true);
    expect(await statusOf(application.id)).toBe('REJECTED');
  });

  it('rejection and suspension need a note; approval does not', async () => {
    const { application } = await setup();
    await expectFailure(decideMonetizationAction({ id: application.id, decision: 'REJECT' }), 'VALIDATION');
    await expectFailure(decideMonetizationAction({ id: application.id, decision: 'REJECT', note: '   ' }), 'VALIDATION');
    await expectFailure(decideMonetizationAction({ id: application.id, decision: 'REJECT', note: 'ا'.repeat(501) }), 'VALIDATION');
    expect(await statusOf(application.id)).toBe('SUBMITTED');
    expect((await decideMonetizationAction({ id: application.id, decision: 'APPROVE' })).ok).toBe(true);
    expect(await db.monetizationApplication.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ decisionNote: null });
  });

  it('enforces the state machine on the server: only SUBMITTED / UNDER_REVIEW can be decided', async () => {
    const { owner } = await setup();
    for (const status of ['DRAFT', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const) {
      const other = await creator();
      const application = await createMonetizationApplication(other.channel!.id, status);
      for (const decision of ['APPROVE', 'REJECT'] as const) {
        const res = await decideMonetizationAction({ id: application.id, decision, note: 'توضیح' });
        expect(res, `${status} + ${decision}`).toMatchObject({ ok: false, code: 'CONFLICT' });
      }
      expect(await statusOf(application.id)).toBe(status);
    }
    expect(await db.moderationAction.count()).toBe(0);
    expect(await notificationsOf(owner.id)).toHaveLength(0);
  });

  it('suspends an approved program and reinstates a suspended one (and nothing else)', async () => {
    const { application, owner } = await setup('APPROVED');
    await expectFailure(decideMonetizationAction({ id: application.id, decision: 'REINSTATE' }), 'CONFLICT');
    await expectFailure(decideMonetizationAction({ id: application.id, decision: 'SUSPEND' }), 'VALIDATION'); // note required
    expect((await decideMonetizationAction({ id: application.id, decision: 'SUSPEND', note: 'نقض قوانین تبلیغات' })).ok).toBe(true);
    expect(await statusOf(application.id)).toBe('SUSPENDED');
    await expectFailure(decideMonetizationAction({ id: application.id, decision: 'SUSPEND', note: 'دوباره' }), 'CONFLICT');
    expect((await decideMonetizationAction({ id: application.id, decision: 'REINSTATE', note: 'رفع مشکل' })).ok).toBe(true);
    expect(await statusOf(application.id)).toBe('APPROVED');

    const rows = await auditRows();
    expect(rows.map((r) => [r.type, (r.meta as { action: string }).action])).toEqual([
      ['MONETIZATION_REJECT', 'SUSPEND'],
      ['MONETIZATION_APPROVE', 'REINSTATE'],
    ]);
    expect((await notificationsOf(owner.id)).map((n) => n.title)).toEqual([expect.stringContaining('تعلیق شد'), expect.stringContaining('تعلیق درآمدزایی')]);
  });

  it('a moderator can neither decide nor open applications', async () => {
    const { application } = await setup();
    await actAs(await moderator());
    await expectFailure(decideMonetizationAction({ id: application.id, decision: 'APPROVE' }), 'FORBIDDEN');
    await expectFailure(startMonetizationReviewAction({ id: application.id }), 'FORBIDDEN');
    expect(await statusOf(application.id)).toBe('SUBMITTED');
  });

  it('creators cannot approve themselves: an administrator who owns the channel is refused', async () => {
    const admin = await administrator();
    const channel = await db.channel.create({ data: { ownerId: admin.id, handle: 'admin-own', name: 'کانال مدیر', searchName: 'a' } });
    const application = await createMonetizationApplication(channel.id);
    await actAs(admin);
    const res = await expectFailure(decideMonetizationAction({ id: application.id, decision: 'APPROVE' }), 'FORBIDDEN');
    expect(res.message).toContain('خودتان');
    expect(await statusOf(application.id)).toBe('SUBMITTED');
    // another administrator can
    await actAs(await administrator());
    expect((await decideMonetizationAction({ id: application.id, decision: 'APPROVE' })).ok).toBe(true);
  });

  it('two administrators deciding at once: one decision, one audit row, one notification', async () => {
    const { application, owner } = await setup();
    const second = await administrator();
    const results = await Promise.allSettled([
      decideMonetization({ id: (await db.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } })).id, role: 'ADMIN', displayName: 'الف' }, { id: application.id, decision: 'APPROVE', note: null }),
      decideMonetization({ id: second.id, role: 'ADMIN', displayName: 'ب' }, { id: application.id, decision: 'REJECT', note: 'رد شد' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.moderationAction.count()).toBe(1);
    expect(await notificationsOf(owner.id)).toHaveLength(1);
    expect(['APPROVED', 'REJECTED']).toContain(await statusOf(application.id));
  });

  it('404 for unknown applications', async () => {
    await setup();
    await expectFailure(decideMonetizationAction({ id: 'n'.repeat(25), decision: 'APPROVE' }), 'NOT_FOUND');
  });
});

describe('verification requests (moderators and administrators)', () => {
  async function setup() {
    const mod = await moderator();
    const owner = await creator('درخواست‌دهنده');
    const request = await createVerificationRequest(owner.channel!.id);
    await actAs(mod);
    return { mod, owner, channel: owner.channel!, request };
  }

  it('approves: the channel gets the badge, the request is closed, CHANNEL_VERIFY is audited, the owner is notified', async () => {
    const { mod, owner, channel, request } = await setup();
    expect(await startVerificationReviewAction({ id: request.id })).toEqual({ ok: true, data: { changed: true } });
    expect((await db.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('UNDER_REVIEW');

    const res = await decideVerificationAction({ id: request.id, decision: 'APPROVE', note: 'مدارک کافی است' });
    expect(res).toEqual({ ok: true, data: { status: 'APPROVED' } });

    expect(await db.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
      status: 'APPROVED',
      reviewedById: mod.id,
      decisionNote: 'مدارک کافی است',
    });
    expect(await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({ isVerified: true, verifiedAt: expect.any(Date) });

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'CHANNEL_VERIFY', actorId: mod.id, channelId: channel.id, targetUserId: owner.id });
    expect(rows[0]!.meta).toMatchObject({ verificationRequestId: request.id, alreadyVerified: false });
    const [note] = await notificationsOf(owner.id);
    expect(note).toMatchObject({ type: 'VERIFICATION_UPDATE' });
    expect(note!.title).toContain('پذیرفته شد');
  });

  it('rejects with a mandatory note: VERIFICATION_REJECT audit row, the badge is not granted', async () => {
    const { mod, channel, owner, request } = await setup();
    await expectFailure(decideVerificationAction({ id: request.id, decision: 'REJECT' }), 'VALIDATION');
    expect((await db.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('SUBMITTED');

    expect((await decideVerificationAction({ id: request.id, decision: 'REJECT', note: 'هویت قابل راستی‌آزمایی نیست' })).ok).toBe(true);
    expect((await db.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('REJECTED');
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).isVerified).toBe(false);
    const [row] = await auditRows();
    expect(row).toMatchObject({ type: 'VERIFICATION_REJECT', actorId: mod.id, channelId: channel.id, reason: 'هویت قابل راستی‌آزمایی نیست' });
    const [note] = await notificationsOf(owner.id);
    expect(note!.title).toContain('پذیرفته نشد');
    expect(note!.body).toContain('هویت قابل راستی‌آزمایی نیست');
  });

  it('decisions are final (state machine) and idempotent markers do not touch decided requests', async () => {
    const { request } = await setup();
    await decideVerificationAction({ id: request.id, decision: 'APPROVE' });
    await expectFailure(decideVerificationAction({ id: request.id, decision: 'APPROVE' }), 'CONFLICT');
    await expectFailure(decideVerificationAction({ id: request.id, decision: 'REJECT', note: 'بعداً' }), 'CONFLICT');
    expect(await startVerificationReviewAction({ id: request.id })).toEqual({ ok: true, data: { changed: false } });
    expect((await db.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('APPROVED');
    expect(await db.moderationAction.count()).toBe(1);
  });

  it('records when the badge had already been granted directly', async () => {
    const { channel, request } = await setup();
    await db.channel.update({ where: { id: channel.id }, data: { isVerified: true, verifiedAt: new Date() } });
    expect((await decideVerificationAction({ id: request.id, decision: 'APPROVE' })).ok).toBe(true);
    expect((await auditRows())[0]!.meta).toMatchObject({ alreadyVerified: true });
  });

  it('cannot approve a suspended channel', async () => {
    const { channel, request } = await setup();
    await db.channel.update({ where: { id: channel.id }, data: { suspendedAt: new Date() } });
    await expectFailure(decideVerificationAction({ id: request.id, decision: 'APPROVE' }), 'CONFLICT');
    expect((await db.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('SUBMITTED');
    expect((await decideVerificationAction({ id: request.id, decision: 'REJECT', note: 'کانال تعلیق است' })).ok).toBe(true);
  });

  it('nobody reviews their own request, and a moderator cannot review an administrator’s', async () => {
    const mod = await moderator();
    const admin = await administrator();
    const modChannel = await db.channel.create({ data: { ownerId: mod.id, handle: 'm', name: 'کانال ناظر', searchName: 'm' } });
    const adminChannel = await db.channel.create({ data: { ownerId: admin.id, handle: 'a', name: 'کانال مدیر', searchName: 'a' } });
    const own = await createVerificationRequest(modChannel.id);
    const adminsRequest = await createVerificationRequest(adminChannel.id);
    await actAs(mod);
    await expectFailure(decideVerificationAction({ id: own.id, decision: 'APPROVE' }), 'FORBIDDEN');
    await expectFailure(decideVerificationAction({ id: adminsRequest.id, decision: 'APPROVE' }), 'FORBIDDEN');
    await actAs(admin);
    expect((await decideVerificationAction({ id: own.id, decision: 'APPROVE' })).ok).toBe(true);
    await expectFailure(decideVerificationAction({ id: adminsRequest.id, decision: 'APPROVE' }), 'FORBIDDEN');
  });

  it('creators and users cannot reach it', async () => {
    const { request } = await setup();
    await actAs(await creator());
    await expectFailure(decideVerificationAction({ id: request.id, decision: 'APPROVE' }), 'FORBIDDEN');
    expect((await db.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('SUBMITTED');
  });
});
