import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePageUser, requireRole } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/rate-limit';
import { toActor, type CurrentUser } from '@/lib/auth/session';
import { hasRole } from '@/lib/permissions';
import type { UserRole } from '@/generated/prisma/enums';
import type { Staff } from '@/features/moderation/types';
import { CAPABILITY_MIN_ROLE, type Capability } from './policy';
import { adminLimits } from './limits';

/**
 * Entry gate of every staff Server Action: signed in (401) → role from the DATABASE (403) → rate limit (429).
 * The capability decides the minimum role (`policy.ts`), so the matrix exists in exactly one place.
 */
export async function requireStaff(capability: Capability, limit: keyof typeof adminLimits = 'write'): Promise<Staff> {
  const user = await requireRole(CAPABILITY_MIN_ROLE[capability]);
  await enforceRateLimit(`admin:${limit}`, user.id, adminLimits[limit]);
  return { id: user.id, role: user.role, displayName: user.displayName };
}

/**
 * Page gate: visitors → login (the proxy already forwards them), signed-in non-staff → home,
 * staff without enough rights for this section → the admin overview. Call it in EVERY admin page
 * (layouts are not re-rendered on client navigations, so the layout alone is not a guard).
 */
export async function requireStaffPage(min: Extract<UserRole, 'MODERATOR' | 'ADMIN'> = 'MODERATOR', returnTo = '/admin'): Promise<CurrentUser> {
  const user = await requirePageUser(returnTo);
  const actor = toActor(user);
  if (!hasRole(actor, 'MODERATOR')) redirect('/');
  if (!hasRole(actor, min)) redirect('/admin');
  return user;
}

/** Public pages (feeds, search, channel and watch pages) must stop showing hidden content immediately. */
export function revalidatePublicSite(): void {
  revalidatePath('/', 'layout');
}
