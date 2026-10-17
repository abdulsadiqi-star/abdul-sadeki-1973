import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUser, sessionCookieName, startSession } from '@/lib/auth/session';
import { sha256Hex } from '@/lib/ids';
import { changeUserRoleAction, restoreUserAction, suspendUserAction } from '@/features/admin/actions/users';
import { changeUserRole, suspendUser } from '@/features/moderation/users';
import { requestContext } from '../helpers/request-context';
import { actAs, administrator, auditRows, creator, expectFailure, logout, moderator, notificationsOf, plainUser } from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

const reason = 'تصمیم مدیریت پس از بررسی';

beforeEach(() => logout());

describe('changing roles', () => {
  it('promotes a user to moderator: role stored, one audit row with from/to, the user is told', async () => {
    const admin = await administrator();
    const user = await plainUser('کاربر عادی');
    await actAs(admin);

    expect(await changeUserRoleAction({ userId: user.id, role: 'MODERATOR', reason })).toEqual({ ok: true, data: { from: 'USER', to: 'MODERATOR' } });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('MODERATOR');

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'USER_ROLE_CHANGE', actorId: admin.id, targetUserId: user.id, reason });
    expect(rows[0]!.meta).toMatchObject({ from: 'USER', to: 'MODERATOR', targetUserName: 'کاربر عادی' });
    const [note] = await notificationsOf(user.id);
    expect(note).toMatchObject({ type: 'SYSTEM', actorId: admin.id });
    expect(note!.title).toContain('ناظر');
  });

  it('a freshly promoted moderator can use the panel, a demoted one loses it', async () => {
    const admin = await administrator();
    const user = await plainUser();
    await actAs(admin);
    await changeUserRoleAction({ userId: user.id, role: 'MODERATOR', reason });
    await actAs(user);
    expect(await suspendUserAction({ userId: admin.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' }); // moderators still cannot suspend users
    await actAs(admin);
    await changeUserRoleAction({ userId: user.id, role: 'USER', reason });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('USER');
  });

  it('USER and CREATOR follow channel ownership when an administrator is demoted', async () => {
    const admin = await administrator();
    const other = await administrator();
    await db.channel.create({ data: { ownerId: other.id, handle: 'other-admin', name: 'کانال', searchName: 'x' } });
    await actAs(admin);
    expect(await changeUserRoleAction({ userId: other.id, role: 'USER', reason })).toEqual({ ok: true, data: { from: 'ADMIN', to: 'CREATOR' } });
  });

  it('is a no-op error when the role does not change', async () => {
    const admin = await administrator();
    const user = await plainUser();
    await actAs(admin);
    await expectFailure(changeUserRoleAction({ userId: user.id, role: 'CREATOR', reason }), 'CONFLICT'); // no channel → still USER
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('a moderator cannot grant roles — not to others, not to themselves', async () => {
    const mod = await moderator();
    const user = await plainUser();
    await actAs(mod);
    await expectFailure(changeUserRoleAction({ userId: user.id, role: 'MODERATOR', reason }), 'FORBIDDEN');
    await expectFailure(changeUserRoleAction({ userId: mod.id, role: 'ADMIN', reason }), 'FORBIDDEN');
    expect((await db.user.findUniqueOrThrow({ where: { id: mod.id } })).role).toBe('MODERATOR');
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('nobody changes their own role', async () => {
    const admin = await administrator();
    await administrator(); // a second admin exists, so this is not (only) the last-admin rule
    await actAs(admin);
    const res = await expectFailure(changeUserRoleAction({ userId: admin.id, role: 'MODERATOR', reason }), 'FORBIDDEN');
    expect(res.message).toContain('خودتان');
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN');
  });

  it('the last administrator cannot be demoted — with a precise message', async () => {
    const admin = await administrator();
    await actAs(admin);
    const res = await expectFailure(changeUserRoleAction({ userId: admin.id, role: 'USER', reason }), 'FORBIDDEN');
    expect(res.message).toContain('آخرین مدیر');
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN');
  });

  it('one administrator can demote another while someone remains', async () => {
    const a = await administrator();
    const b = await administrator();
    await actAs(a);
    expect((await changeUserRoleAction({ userId: b.id, role: 'MODERATOR', reason })).ok).toBe(true);
    // now `a` is the last one standing and cannot be touched by anyone
    expect(await db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
  });

  it('two administrators demoting each other at the same time can never leave the platform without an administrator', async () => {
    const a = await administrator();
    const b = await administrator();
    const staffA = { id: a.id, role: a.role, displayName: a.displayName };
    const staffB = { id: b.id, role: b.role, displayName: b.displayName };
    for (let round = 0; round < 3; round++) {
      await db.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { role: 'ADMIN', status: 'ACTIVE' } });
      const results = await Promise.allSettled([
        changeUserRole(staffA, { userId: b.id, role: 'MODERATOR', reason }),
        changeUserRole(staffB, { userId: a.id, role: 'MODERATOR', reason }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
    }
  });

  it('mutual suspension races are serialized the same way', async () => {
    const a = await administrator();
    const b = await administrator();
    const results = await Promise.allSettled([
      suspendUser({ id: a.id, role: 'ADMIN', displayName: 'a' }, { userId: b.id, reason }),
      suspendUser({ id: b.id, role: 'ADMIN', displayName: 'b' }, { userId: a.id, reason }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
  });

  it('validates the role value and the reason', async () => {
    const admin = await administrator();
    const user = await plainUser();
    await actAs(admin);
    await expectFailure(changeUserRoleAction({ userId: user.id, role: 'SUPERUSER', reason }), 'VALIDATION');
    await expectFailure(changeUserRoleAction({ userId: user.id, role: 'MODERATOR', reason: ' ' }), 'VALIDATION');
    await expectFailure(changeUserRoleAction({ userId: 'u'.repeat(25), role: 'MODERATOR', reason }), 'NOT_FOUND');
  });
});

describe('suspending and restoring accounts', () => {
  it('suspends: status stored, sessions revoked immediately, one audit row, user notified', async () => {
    const admin = await administrator();
    const user = await creator('سازنده‌ی متخلف');
    // two devices
    await actAs(user);
    const token = requestContext.cookie(sessionCookieName())!;
    await startSession(user.id);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(2);
    expect(await getCurrentUser()).toMatchObject({ id: user.id });

    await actAs(admin);
    const res = await suspendUserAction({ userId: user.id, reason });
    expect(res).toEqual({ ok: true, data: { revokedSessions: 2 } });

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('SUSPENDED');
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: admin.id } })).toBe(1); // only the target's sessions

    const [row] = await auditRows();
    expect(row).toMatchObject({ type: 'USER_SUSPEND', actorId: admin.id, targetUserId: user.id, reason });
    expect(row!.meta).toMatchObject({ revokedSessions: 2 });
    const [note] = await notificationsOf(user.id);
    expect(note).toMatchObject({ type: 'MODERATION' });
    expect(note!.body).toContain(reason);

    // the old browser keeps sending its cookie: it is simply no session any more
    requestContext.reset();
    requestContext.cookiesApi().set(sessionCookieName(), token);
    expect(await getCurrentUser()).toBeNull();
  });

  it('a suspended user is rejected on the NEXT request even if a session row somehow survived', async () => {
    const admin = await administrator();
    const user = await plainUser();
    await actAs(user);
    const token = requestContext.cookie(sessionCookieName())!;
    await actAs(admin);
    await suspendUserAction({ userId: user.id, reason });
    // simulate a login that raced the suspension and created a fresh session row afterwards
    await db.session.create({ data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 3_600_000) } });
    requestContext.reset();
    requestContext.cookiesApi().set(sessionCookieName(), token);
    expect(await getCurrentUser()).toBeNull();
    // ...and none of the staff actions can be reached with it either
    expect(await changeUserRoleAction({ userId: admin.id, role: 'USER', reason })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('restores the account: sessions can be created again, audit row + notification', async () => {
    const admin = await administrator();
    const user = await plainUser();
    await actAs(admin);
    await suspendUserAction({ userId: user.id, reason });
    await expectFailure(suspendUserAction({ userId: user.id, reason }), 'CONFLICT');

    expect((await restoreUserAction({ userId: user.id, reason: 'استیناف پذیرفته شد' })).ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
    await actAs(user);
    expect(await getCurrentUser()).toMatchObject({ id: user.id });

    expect((await auditRows()).map((r) => r.type)).toEqual(['USER_SUSPEND', 'USER_RESTORE']);
    expect((await notificationsOf(user.id)).map((n) => n.title)).toEqual([expect.stringContaining('تعلیق شد'), expect.stringContaining('برداشته شد')]);
    await actAs(admin);
    await expectFailure(restoreUserAction({ userId: user.id, reason }), 'CONFLICT'); // already active
  });

  it('moderators cannot suspend or restore anybody', async () => {
    const mod = await moderator();
    const user = await plainUser();
    await actAs(mod);
    await expectFailure(suspendUserAction({ userId: user.id, reason }), 'FORBIDDEN');
    await db.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await expectFailure(restoreUserAction({ userId: user.id, reason }), 'FORBIDDEN');
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('nobody suspends themselves; the last administrator is protected', async () => {
    const admin = await administrator();
    await actAs(admin);
    const alone = await expectFailure(suspendUserAction({ userId: admin.id, reason }), 'FORBIDDEN');
    expect(alone.message).toContain('آخرین مدیر');

    const second = await administrator();
    const self = await expectFailure(suspendUserAction({ userId: admin.id, reason }), 'FORBIDDEN');
    expect(self.message).toContain('خودتان');

    // an administrator may suspend another one; the survivor is then untouchable
    expect((await suspendUserAction({ userId: second.id, reason })).ok).toBe(true);
    await expectFailure(suspendUserAction({ userId: admin.id, reason }), 'FORBIDDEN').then((r) => expect(r.message).toContain('آخرین مدیر'));
    expect(await db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
  });

  it('writes nothing when it fails', async () => {
    const admin = await administrator();
    await actAs(admin);
    await expectFailure(suspendUserAction({ userId: 'x'.repeat(25), reason }), 'NOT_FOUND');
    await expectFailure(suspendUserAction({ userId: 'x'.repeat(25), reason: '' }), 'VALIDATION');
    expect(await db.moderationAction.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
  });
});
