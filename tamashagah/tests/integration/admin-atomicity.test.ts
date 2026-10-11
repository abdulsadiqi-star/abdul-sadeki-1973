/**
 * "Every mutation writes its audit row in the SAME transaction": prove it with a real fault.
 *
 * A trigger makes every INSERT into "ModerationAction" fail. A mutation that wrote its audit row outside of its own
 * transaction would leave its change behind; the real ones must roll everything back — state, counters, revoked
 * sessions — and must not notify anybody. The trigger is removed after each test (this project runs files serially).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { enqueueVideoCleanup } from '@/lib/queue';
import { sha256Hex } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { blockCommenterAction, deleteCommentAction, deleteVideoAction, restoreVideoAction, suspendChannelAction, takedownVideoAction, verifyChannelAction } from '@/features/admin/actions/content';
import { dismissReportAction, warnCreatorAction } from '@/features/admin/actions/reports';
import { decideMonetizationAction, decideVerificationAction } from '@/features/admin/actions/requests';
import { closeTicketAction, replyToTicketAction } from '@/features/admin/actions/support';
import { changeUserRoleAction, suspendUserAction } from '@/features/admin/actions/users';
import {
  actAs,
  administrator,
  auditRows,
  createComment,
  createMonetizationApplication,
  createReport,
  createTicket,
  createVerificationRequest,
  creatorWithVideo,
  expectFailure,
  logout,
  moderator,
  notificationsOf,
  plainUser,
} from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

const reason = 'دلیل ثبت‌شده برای آزمایش یکپارچگی';

async function breakAuditWrites() {
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION tg_test_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit store unavailable (test)'; END; $$ LANGUAGE plpgsql`,
  );
  await db.$executeRawUnsafe(`CREATE TRIGGER tg_test_fail_audit BEFORE INSERT ON "ModerationAction" FOR EACH ROW EXECUTE FUNCTION tg_test_fail_audit()`);
}

async function repairAuditWrites() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS tg_test_fail_audit ON "ModerationAction"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS tg_test_fail_audit()`);
}

/** `runAction` logs the unexpected error it turns into INTERNAL: that is how a test knows the injected fault was the cause. */
const loggedErrors = vi.spyOn(logger, 'error');

beforeEach(() => {
  logout();
  vi.mocked(enqueueVideoCleanup).mockClear();
  loggedErrors.mockClear();
});
afterEach(repairAuditWrites);

/** The mutation fails as an unexpected error, leaves no audit row and notifies nobody. */
async function expectRolledBack(run: Promise<{ ok: boolean; code?: string; message?: string }>, notified: string[] = []) {
  await expectFailure(run, 'INTERNAL');
  const cause = loggedErrors.mock.calls.at(-1)?.[0] as { err?: { message?: string } } | undefined;
  expect(String(cause?.err?.message)).toContain('audit store unavailable');
  expect(await auditRows()).toHaveLength(0);
  for (const userId of notified) expect(await notificationsOf(userId)).toHaveLength(0);
}

async function setupVideoCase() {
  const mod = await moderator();
  const { owner, channel, video } = await creatorWithVideo();
  const report = await createReport({ reporterId: (await plainUser()).id, video });
  return { mod, owner, channel, video, report };
}

describe('control: without the fault the same decision commits its change and exactly one audit row', () => {
  it('take-down', async () => {
    const { mod, video, report } = await setupVideoCase();
    await actAs(mod);
    expect((await takedownVideoAction({ videoId: video.id, reason, reportId: report.id })).ok).toBe(true);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).takedownAt).not.toBeNull();
    expect(await auditRows()).toHaveLength(1);
  });
});

describe('a failing audit write rolls the whole mutation back', () => {
  it('video take-down: video stays public, the report stays open', async () => {
    const { mod, owner, video, report } = await setupVideoCase();
    await actAs(mod);
    await breakAuditWrites();
    await expectRolledBack(takedownVideoAction({ videoId: video.id, reason, reportId: report.id }), [owner.id]);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).takedownAt).toBeNull();
    expect((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('OPEN');
  });

  it('video restore: the take-down stays', async () => {
    const { mod, owner, video } = await setupVideoCase();
    await db.video.update({ where: { id: video.id }, data: { takedownAt: new Date(), takedownReason: 'قبلی' } });
    await actAs(mod);
    await breakAuditWrites();
    await expectRolledBack(restoreVideoAction({ videoId: video.id, reason }), [owner.id]);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).takedownAt).not.toBeNull();
  });

  it('force delete: the video still exists and no file cleanup was queued', async () => {
    const { video } = await setupVideoCase();
    await actAs(await administrator());
    await breakAuditWrites();
    await expectRolledBack(deleteVideoAction({ videoId: video.id, reason }));
    expect(await db.video.count({ where: { id: video.id } })).toBe(1);
    expect(enqueueVideoCleanup).not.toHaveBeenCalled();
  });

  it('comment delete: status, counters and report are untouched', async () => {
    const mod = await moderator();
    const { video } = await creatorWithVideo();
    const author = await plainUser();
    const comment = await createComment({ videoId: video.id, authorId: author.id });
    const report = await createReport({ reporterId: (await plainUser()).id, comment });
    await actAs(mod);
    await breakAuditWrites();
    await expectRolledBack(deleteCommentAction({ commentId: comment.id, reason, reportId: report.id }), [author.id]);
    expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).status).toBe('APPROVED');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).commentCount).toBe(1);
    expect((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('OPEN');
  });

  it('commenter block: no block row', async () => {
    const mod = await moderator();
    const { owner, channel } = await creatorWithVideo();
    const author = await plainUser();
    await actAs(mod);
    await breakAuditWrites();
    await expectRolledBack(blockCommenterAction({ channelId: channel.id, userId: author.id, reason }), [author.id, owner.id]);
    expect(await db.channelBlock.count()).toBe(0);
  });

  it('channel suspension and verification: flags unchanged', async () => {
    const mod = await moderator();
    const { owner, channel } = await creatorWithVideo();
    await actAs(mod);
    await breakAuditWrites();
    await expectRolledBack(suspendChannelAction({ channelId: channel.id, reason }), [owner.id]);
    await expectRolledBack(verifyChannelAction({ channelId: channel.id, note: null }), [owner.id]);
    const after = await db.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(after.suspendedAt).toBeNull();
    expect(after.isVerified).toBe(false);
  });

  it('report dismissal and creator warning: the report stays open', async () => {
    const { mod, owner, report } = await setupVideoCase();
    await actAs(mod);
    await breakAuditWrites();
    await expectRolledBack(dismissReportAction({ reportId: report.id, reason }), [owner.id]);
    await expectRolledBack(warnCreatorAction({ reportId: report.id, reason }), [owner.id]);
    expect((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('OPEN');
  });

  it('role change: role unchanged', async () => {
    const admin = await administrator();
    const user = await plainUser();
    await actAs(admin);
    await breakAuditWrites();
    await expectRolledBack(changeUserRoleAction({ userId: user.id, role: 'MODERATOR', reason }), [user.id]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('USER');
  });

  it('account suspension: the account stays active and its sessions are NOT revoked', async () => {
    const admin = await administrator();
    const user = await plainUser();
    await db.session.create({ data: { userId: user.id, tokenHash: sha256Hex('victim-session'), expiresAt: new Date(Date.now() + 3_600_000) } });
    await actAs(admin);
    await breakAuditWrites();
    await expectRolledBack(suspendUserAction({ userId: user.id, reason }), [user.id]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('monetization and verification decisions: the requests stay as they were', async () => {
    const { owner, channel } = await creatorWithVideo();
    const monetization = await createMonetizationApplication(channel.id);
    const verification = await createVerificationRequest(channel.id);
    await actAs(await administrator());
    await breakAuditWrites();
    await expectRolledBack(decideMonetizationAction({ id: monetization.id, decision: 'APPROVE', note: null }), [owner.id]);
    await expectRolledBack(decideVerificationAction({ id: verification.id, decision: 'APPROVE', note: null }), [owner.id]);
    expect((await db.monetizationApplication.findUniqueOrThrow({ where: { id: monetization.id } })).status).toBe('SUBMITTED');
    expect((await db.verificationRequest.findUniqueOrThrow({ where: { id: verification.id } })).status).toBe('SUBMITTED');
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).isVerified).toBe(false);
  });

  it('support: the reply message and the status change roll back together; closing keeps the ticket open', async () => {
    const owner = await plainUser();
    const ticket = await createTicket({ userId: owner.id });
    await actAs(await moderator());
    await breakAuditWrites();
    await expectRolledBack(replyToTicketAction({ ticketId: ticket.id, body: 'پاسخ پشتیبانی که نباید ذخیره شود' }), [owner.id]);
    await expectRolledBack(closeTicketAction({ ticketId: ticket.id }), [owner.id]);
    expect(await db.ticketMessage.count({ where: { ticketId: ticket.id } })).toBe(1);
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('OPEN');
  });
});
