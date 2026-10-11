import 'server-only';
import { redirect } from 'next/navigation';
import { Errors } from '@/lib/errors';
import { hasRole } from '@/lib/permissions';
import type { UserRole } from '@/generated/prisma/enums';
import { getCurrentUser, toActor, type CurrentUser } from './session';

/**
 * Guards come in two flavours:
 *
 *  - `require*()`      throw `AppError` → use in Server Actions and Route Handlers
 *  - `requirePage*()`  call `redirect()`  → use in layouts / pages (Server Components)
 *
 * Pages that only *hide* UI must still guard the underlying action: UI checks
 * are never a security boundary.
 */

export type ChannelUser = CurrentUser & { channel: NonNullable<CurrentUser['channel']> };

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw Errors.unauthenticated();
  return user;
}

/** Logged in + e-mail verified (needed to upload, comment, report, create a channel). */
export async function requireVerifiedUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.emailVerified) throw Errors.emailNotVerified();
  return user;
}

export async function requireChannelUser(): Promise<ChannelUser> {
  const user = await requireUser();
  if (!user.channel) throw Errors.forbidden('برای این کار ابتدا باید کانال بسازید.');
  return user as ChannelUser;
}

export async function requireRole(min: UserRole): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasRole(toActor(user), min)) throw Errors.forbidden();
  return user;
}

// --- Page variants ----------------------------------------------------------

const loginUrl = (returnTo?: string) => (returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');

export async function requirePageUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(returnTo));
  return user;
}

export async function requirePageChannelUser(returnTo?: string): Promise<ChannelUser> {
  const user = await requirePageUser(returnTo);
  if (!user.channel) redirect('/studio');
  return user as ChannelUser;
}

export async function requirePageRole(min: UserRole, returnTo?: string): Promise<CurrentUser> {
  const user = await requirePageUser(returnTo);
  if (!hasRole(toActor(user), min)) redirect('/');
  return user;
}
