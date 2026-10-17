'use server';

import { runAction, type ActionResult } from '@/lib/errors';
import { parse } from '@/lib/validation';
import { changeUserRole, restoreUser, suspendUser } from '@/features/moderation/users';
import type { UserRole } from '@/generated/prisma/enums';
import { changeUserRoleSchema, restoreUserSchema, suspendUserSchema } from '../schemas';
import { requireStaff } from '../guard';

export async function changeUserRoleAction(input: unknown): Promise<ActionResult<{ from: UserRole; to: UserRole }>> {
  return runAction(async () => {
    const staff = await requireStaff('user.role.change', 'sensitive');
    return changeUserRole(staff, parse(changeUserRoleSchema, input));
  });
}

export async function suspendUserAction(input: unknown): Promise<ActionResult<{ revokedSessions: number }>> {
  return runAction(async () => {
    const staff = await requireStaff('user.suspend', 'sensitive');
    return suspendUser(staff, parse(suspendUserSchema, input));
  });
}

export async function restoreUserAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const staff = await requireStaff('user.restore', 'sensitive');
    await restoreUser(staff, parse(restoreUserSchema, input));
  });
}
