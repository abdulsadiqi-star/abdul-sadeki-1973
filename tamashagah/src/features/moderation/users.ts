/**
 * Account administration (administrators only): role changes and suspension.
 *
 * Race-safety: the "last administrator" rule is only meaningful if two concurrent requests cannot both pass it
 * (A demotes B while B demotes A). Every operation therefore starts by taking row locks — all ACTIVE administrators
 * plus the target, in id order — and then re-reads the actor and the target under those locks.
 *
 * Runtime-agnostic (no next/* imports).
 */
import { db } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { notify } from '@/features/notifications/service';
import { evaluateRoleChange, evaluateUserRestore, evaluateUserSuspension } from '@/features/admin/policy';
import type { UserRole } from '@/generated/prisma/enums';
import { writeAudit } from './audit';
import { messages } from './messages';
import { assertAllowed } from './permissions';
import type { Staff, Tx } from './types';

/** Lock active admins + target (id order → no deadlocks), then load fresh actor / target / admin count. */
async function lockAndLoad(tx: Tx, staff: Staff, targetId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User"
    WHERE ("role" = 'ADMIN' AND "status" = 'ACTIVE') OR "id" = ${targetId} OR "id" = ${staff.id}
    ORDER BY "id"
    FOR UPDATE`;
  // Sequential on purpose: a transaction owns one connection, concurrent queries on it are deprecated in pg.
  const actor = await tx.user.findUnique({ where: { id: staff.id }, select: { id: true, role: true, status: true } });
  const target = await tx.user.findUnique({
    where: { id: targetId },
    select: { id: true, role: true, status: true, displayName: true, channel: { select: { id: true } } },
  });
  // The session was valid when the request started; the lock gives us the state right now.
  if (!actor || actor.status !== 'ACTIVE') throw Errors.forbidden();
  if (!target) throw Errors.notFound('کاربر پیدا نشد.');
  const activeAdmins = await tx.user.findMany({ where: { id: { in: locked.map((l) => l.id) }, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
  const activeAdminsExcludingTarget = activeAdmins.filter((a) => a.id !== target.id).length;
  return { actor: { id: actor.id, role: actor.role }, target, activeAdminsExcludingTarget };
}

export async function changeUserRole(
  staff: Staff,
  input: { userId: string; role: UserRole; reason: string },
): Promise<{ from: UserRole; to: UserRole }> {
  const result = await db.$transaction(async (tx) => {
    const { actor, target, activeAdminsExcludingTarget } = await lockAndLoad(tx, staff, input.userId);
    const verdict = evaluateRoleChange({
      actor,
      target: { id: target.id, role: target.role, status: target.status, hasChannel: !!target.channel },
      requestedRole: input.role,
      activeAdminsExcludingTarget,
    });
    assertAllowed(verdict);
    const to = verdict.role as UserRole;
    await tx.user.update({ where: { id: target.id }, data: { role: to } });
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'USER_ROLE_CHANGE',
      targetUserId: target.id,
      reason: input.reason,
      meta: { from: target.role, to, targetUserName: target.displayName },
    });
    return { from: target.role, to };
  });

  await notify({ userId: input.userId, actorId: staff.id, ...messages.roleChange(result.to, input.reason) });
  return result;
}

export async function suspendUser(staff: Staff, input: { userId: string; reason: string }): Promise<{ revokedSessions: number }> {
  const revokedSessions = await db.$transaction(async (tx) => {
    const { actor, target, activeAdminsExcludingTarget } = await lockAndLoad(tx, staff, input.userId);
    assertAllowed(
      evaluateUserSuspension({
        actor,
        target: { id: target.id, role: target.role, status: target.status },
        activeAdminsExcludingTarget,
      }),
    );
    await tx.user.update({ where: { id: target.id }, data: { status: 'SUSPENDED' } });
    // Same operation as `revokeUserSessions`, inside the transaction: the suspension and the revocation commit together.
    const { count } = await tx.session.deleteMany({ where: { userId: target.id } });
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'USER_SUSPEND',
      targetUserId: target.id,
      reason: input.reason,
      meta: { revokedSessions: count, targetUserName: target.displayName },
    });
    return count;
  });

  await notify({ userId: input.userId, actorId: staff.id, ...messages.userSuspend(input.reason) });
  return { revokedSessions };
}

export async function restoreUser(staff: Staff, input: { userId: string; reason: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const { actor, target } = await lockAndLoad(tx, staff, input.userId);
    assertAllowed(evaluateUserRestore({ actor, target: { id: target.id, role: target.role, status: target.status } }));
    await tx.user.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
    await writeAudit(tx, {
      actorId: staff.id,
      type: 'USER_RESTORE',
      targetUserId: target.id,
      reason: input.reason,
      meta: { targetUserName: target.displayName },
    });
  });

  await notify({ userId: input.userId, actorId: staff.id, ...messages.userRestore(input.reason) });
}
