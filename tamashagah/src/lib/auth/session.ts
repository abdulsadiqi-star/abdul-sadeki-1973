import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { hmacHex, randomToken, sha256Hex } from '@/lib/ids';
import { mediaUrl } from '@/lib/media-url';
import { getClientIp, getUserAgent } from '@/lib/request';
import type { Actor } from '@/lib/permissions';
import type { CommentsMode, DigitStyle, UserRole, Visibility } from '@/generated/prisma/enums';
import { siteConfig } from '@/config/site';

/**
 * Session design
 *  - Opaque 256-bit random token in an HttpOnly, SameSite=Lax cookie.
 *  - Only SHA-256(token) is stored, so a database leak cannot be replayed.
 *  - `__Host-` prefix + Secure in production (https APP_URL).
 *  - Server-side revocation: logout, password change/reset and "log out everywhere"
 *    delete rows; expired or revoked rows are never accepted.
 *  - Lifetime: SESSION_TTL_DAYS from login, hard cap SESSION_ABSOLUTE_TTL_DAYS.
 */
const DAY = 86_400_000;

export const secureCookies = () => env.APP_URL.startsWith('https://');
export const sessionCookieName = () => (secureCookies() ? '__Host-tg_session' : 'tg_session');

export type CurrentUser = {
  id: string;
  sessionId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  emailVerified: boolean;
  digitStyle: DigitStyle;
  channel: {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string | null;
    isVerified: boolean;
    commentsMode: CommentsMode;
    defaultVisibility: Visibility;
  } | null;
};

export const toActor = (user: CurrentUser | null): Actor =>
  user ? { id: user.id, role: user.role, channelId: user.channel?.id ?? null, emailVerified: user.emailVerified } : null;

async function setSessionCookie(token: string, maxAgeSeconds: number): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

/** Create a session for `userId` and set the cookie. Call from Server Actions / Route Handlers. */
export async function startSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const h = await headers();
  const ip = getClientIp(h);
  const ttlMs = env.SESSION_TTL_DAYS * DAY;
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      userAgent: getUserAgent(h),
      ipHash: ip ? hmacHex(env.SESSION_SECRET, `ip:${ip}`).slice(0, 32) : null,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await setSessionCookie(token, Math.floor(ttlMs / 1000));
}

/** Revoke the current session (logout) and clear the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  jar.set(sessionCookieName(), '', { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Revoke every session of a user (optionally keeping one). Used on password change/reset. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
  return count;
}

/**
 * The logged-in user for this request (or null). Memoized per request via
 * React `cache`, so layouts, pages and actions can all call it freely.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token || token.length < 20 || token.length > 128) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: {
      user: {
        include: {
          channel: {
            select: {
              id: true,
              handle: true,
              name: true,
              avatarKey: true,
              isVerified: true,
              commentsMode: true,
              defaultVisibility: true,
              suspendedAt: true,
            },
          },
        },
      },
    },
  });

  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;
  if (now - session.createdAt.getTime() > env.SESSION_ABSOLUTE_TTL_DAYS * DAY) return null;
  const { user } = session;
  if (user.status !== 'ACTIVE') return null;

  // Cheap activity tracking: at most one write per session per 10 minutes.
  if (now - session.lastUsedAt.getTime() > 10 * 60_000) {
    void db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }

  const channel = user.channel;
  return {
    id: user.id,
    sessionId: session.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: mediaUrl(channel?.avatarKey ?? user.avatarKey),
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    digitStyle: user.digitStyle,
    channel: channel
      ? {
          id: channel.id,
          handle: channel.handle,
          name: channel.name,
          avatarUrl: mediaUrl(channel.avatarKey),
          isVerified: channel.isVerified,
          commentsMode: channel.commentsMode,
          defaultVisibility: channel.defaultVisibility,
        }
      : null,
  };
});

/** Persist the numeral preference for visitors (and mirror it on the user row separately). */
export async function setDigitsCookie(style: DigitStyle): Promise<void> {
  (await cookies()).set(siteConfig.digitsCookie, style.toLowerCase(), {
    path: '/',
    maxAge: 365 * 24 * 3600,
    sameSite: 'lax',
    secure: secureCookies(),
  });
}
