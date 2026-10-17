import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic gate for areas that always need a session: unauthenticated visitors are sent to
 * /login with the FULL target path (`next=/studio/videos`), so they land where they intended.
 *
 * This only checks that a session cookie EXISTS (cheap, no DB). The real verification happens in the
 * layouts/pages/actions (`requirePage*`, `require*`) — never rely on this file for security.
 *
 * Keep the matcher narrow: upload/media routes must not pass through the proxy (body size limits).
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('__Host-tg_session') || request.cookies.has('tg_session');
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/studio/:path*', '/admin/:path*'] };
