import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { secureCookies } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { hmacHex, randomToken } from '@/lib/ids';

/**
 * Anonymous viewer identity for view de-duplication.
 *
 * A random id lives in an HttpOnly first-party cookie; only its HMAC (`viewerKey`) is ever stored, so database
 * rows cannot be linked back to a browser without the server secret. The id carries no personal data and is
 * used for nothing but de-duplicating views and rate limiting.
 */
const COOKIE = 'tg_viewer';
const VALID_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_AGE_SECONDS = 180 * 24 * 3600;

export const viewerCookieName = () => (secureCookies() ? `__Host-${COOKIE}` : COOKIE);

export type ViewerIdentity = {
  /** HMAC(secret, cookie id) — what is persisted and compared. */
  key: string;
  cookieId: string;
  /** True when the request carried no (valid) cookie, so the response must set one. */
  isNew: boolean;
};

export function viewerKeyFor(cookieId: string): string {
  return hmacHex(env.SESSION_SECRET, `viewer:${cookieId}`);
}

export function resolveViewer(req: NextRequest): ViewerIdentity {
  const existing = req.cookies.get(viewerCookieName())?.value;
  const valid = existing && VALID_ID.test(existing) ? existing : null;
  const cookieId = valid ?? randomToken(16);
  return { cookieId, isNew: !valid, key: viewerKeyFor(cookieId) };
}

/** Attach the viewer cookie to a response when the viewer is new. */
export function setViewerCookie(res: NextResponse, viewer: ViewerIdentity): void {
  if (!viewer.isNew) return;
  res.cookies.set(viewerCookieName(), viewer.cookieId, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}
