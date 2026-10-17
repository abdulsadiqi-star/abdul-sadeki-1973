/**
 * Who may call which staff action. Every action is called with ids that do not exist: the authorization gate
 * runs BEFORE any lookup, so "FORBIDDEN / UNAUTHENTICATED" vs. "anything else" is exactly the permission matrix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';
import { requestContext } from '../helpers/request-context';
import {
  blockCommenterAction,
  deleteCommentAction,
  deleteVideoAction,
  restoreChannelAction,
  restoreCommentAction,
  restoreVideoAction,
  suspendChannelAction,
  takedownVideoAction,
  unblockCommenterAction,
  unverifyChannelAction,
  verifyChannelAction,
} from '@/features/admin/actions/content';
import { dismissReportAction, startReportReviewAction, warnCreatorAction } from '@/features/admin/actions/reports';
import { decideMonetizationAction, decideVerificationAction, startMonetizationReviewAction, startVerificationReviewAction } from '@/features/admin/actions/requests';
import { closeTicketAction, reopenTicketAction, replyToTicketAction } from '@/features/admin/actions/support';
import { changeUserRoleAction, restoreUserAction, suspendUserAction } from '@/features/admin/actions/users';
import { adminLimits } from '@/features/admin/limits';
import { actAs, administrator, creator, logout, moderator, plainUser } from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

const id = 'c'.repeat(25);
const id2 = 'd'.repeat(25);
const videoId = 'aB3dE5gH7jK';
const reason = 'دلیل آزمایشی برای اقدام';

type Action = (input: unknown) => Promise<{ ok: boolean; code?: string }>;
const matrix: { name: string; run: Action; input: unknown; min: 'MODERATOR' | 'ADMIN' }[] = [
  { name: 'startReportReview', run: startReportReviewAction, input: { id }, min: 'MODERATOR' },
  { name: 'dismissReport', run: dismissReportAction, input: { reportId: id, reason }, min: 'MODERATOR' },
  { name: 'warnCreator', run: warnCreatorAction, input: { reportId: id, reason }, min: 'MODERATOR' },
  { name: 'takedownVideo', run: takedownVideoAction, input: { videoId, reason }, min: 'MODERATOR' },
  { name: 'restoreVideo', run: restoreVideoAction, input: { videoId, reason }, min: 'MODERATOR' },
  { name: 'deleteVideo (force)', run: deleteVideoAction, input: { videoId, reason }, min: 'ADMIN' },
  { name: 'deleteComment', run: deleteCommentAction, input: { commentId: id, reason }, min: 'MODERATOR' },
  { name: 'restoreComment', run: restoreCommentAction, input: { commentId: id, reason }, min: 'MODERATOR' },
  { name: 'blockCommenter', run: blockCommenterAction, input: { channelId: id, userId: id2, reason }, min: 'MODERATOR' },
  { name: 'unblockCommenter', run: unblockCommenterAction, input: { channelId: id, userId: id2, reason }, min: 'MODERATOR' },
  { name: 'suspendChannel', run: suspendChannelAction, input: { channelId: id, reason }, min: 'MODERATOR' },
  { name: 'restoreChannel', run: restoreChannelAction, input: { channelId: id, reason }, min: 'MODERATOR' },
  { name: 'verifyChannel', run: verifyChannelAction, input: { channelId: id }, min: 'MODERATOR' },
  { name: 'unverifyChannel', run: unverifyChannelAction, input: { channelId: id, reason }, min: 'MODERATOR' },
  { name: 'changeUserRole', run: changeUserRoleAction, input: { userId: id, role: 'MODERATOR', reason }, min: 'ADMIN' },
  { name: 'suspendUser', run: suspendUserAction, input: { userId: id, reason }, min: 'ADMIN' },
  { name: 'restoreUser', run: restoreUserAction, input: { userId: id, reason }, min: 'ADMIN' },
  { name: 'startMonetizationReview', run: startMonetizationReviewAction, input: { id }, min: 'ADMIN' },
  { name: 'decideMonetization', run: decideMonetizationAction, input: { id, decision: 'APPROVE' }, min: 'ADMIN' },
  { name: 'startVerificationReview', run: startVerificationReviewAction, input: { id }, min: 'MODERATOR' },
  { name: 'decideVerification', run: decideVerificationAction, input: { id, decision: 'APPROVE' }, min: 'MODERATOR' },
  { name: 'replyToTicket', run: replyToTicketAction, input: { ticketId: id, body: 'پاسخ پشتیبانی' }, min: 'MODERATOR' },
  { name: 'closeTicket', run: closeTicketAction, input: { ticketId: id }, min: 'MODERATOR' },
  { name: 'reopenTicket', run: reopenTicketAction, input: { ticketId: id }, min: 'MODERATOR' },
];

describe('staff actions: who can call what', () => {
  beforeEach(() => logout());

  it.each(matrix)('$name — a visitor is told to sign in', async ({ run, input }) => {
    expect(await run(input)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it.each(matrix)('$name — a signed-in user is FORBIDDEN', async ({ run, input }) => {
    await actAs(await plainUser());
    expect(await run(input)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it.each(matrix)('$name — a creator is FORBIDDEN', async ({ run, input }) => {
    await actAs(await creator());
    expect(await run(input)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it.each(matrix)('$name — a moderator is $min-gated', async ({ run, input, min }) => {
    await actAs(await moderator());
    const res = await run(input);
    if (min === 'ADMIN') expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    else expect(res.code).not.toBe('FORBIDDEN'); // passes the gate: fails later (unknown ids) or succeeds
  });

  it.each(matrix)('$name — an administrator passes the gate', async ({ run, input }) => {
    await actAs(await administrator());
    const res = await run(input);
    expect(res.code).not.toBe('FORBIDDEN');
    expect(res.code).not.toBe('UNAUTHENTICATED');
  });

  it('writes nothing when the gate refuses', async () => {
    await actAs(await creator());
    for (const { run, input } of matrix) await run(input);
    expect(await db.moderationAction.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
  });

  it('the role is re-read from the database on every call: a demoted moderator loses access with the same session', async () => {
    const mod = await moderator();
    await actAs(mod);
    expect(await dismissReportAction({ reportId: id, reason })).toMatchObject({ ok: false, code: 'NOT_FOUND' }); // allowed (the report does not exist)
    await db.user.update({ where: { id: mod.id }, data: { role: 'CREATOR' } });
    expect(await dismissReportAction({ reportId: id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('a suspended staff member is signed out immediately (UNAUTHENTICATED)', async () => {
    const mod = await moderator();
    await actAs(mod);
    expect(await getCurrentUser()).not.toBeNull();
    await db.user.update({ where: { id: mod.id }, data: { status: 'SUSPENDED' } });
    expect(await getCurrentUser()).toBeNull();
    expect(await dismissReportAction({ reportId: id, reason })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('an expired / unknown session cookie is no session', async () => {
    requestContext.reset();
    requestContext.cookiesApi().set('tg_session', 'x'.repeat(43));
    expect(await dismissReportAction({ reportId: id, reason })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('is rate limited per staff member (sensitive operations first)', async () => {
    await actAs(await administrator());
    const attempts = adminLimits.sensitive.limit + 1;
    const results: string[] = [];
    for (let i = 0; i < attempts; i++) {
      const res = await deleteVideoAction({ videoId: 'not-a-video-id', reason });
      results.push(res.ok ? 'ok' : (res.code ?? '?'));
    }
    expect(results.slice(0, adminLimits.sensitive.limit).every((c) => c === 'VALIDATION')).toBe(true);
    expect(results.at(-1)).toBe('RATE_LIMITED');
  });
});
