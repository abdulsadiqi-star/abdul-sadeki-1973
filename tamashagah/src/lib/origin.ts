/**
 * CSRF defence for mutating Route Handlers.
 *
 * Authentication uses SameSite=Lax session cookies, which already blocks the
 * classic cross-site POST. We add defence in depth: every non-safe request must
 * come from a trusted origin. Server Actions get an equivalent check from Next.js
 * itself (Origin vs Host), so this helper is for `route.ts` files only.
 *
 * Accepted when ANY of these hold:
 *  1. `Origin` host equals the request `Host` (same-origin browser request)
 *  2. `Origin` equals APP_URL's origin or one of TRUSTED_ORIGINS
 *  3. No `Origin` header, but `Sec-Fetch-Site` is "same-origin" / "none"
 *     (non-browser clients that send neither header are rejected)
 */
import { env } from './env';
import { Errors } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function trustedOrigins(): Set<string> {
  const list = new Set<string>();
  try {
    list.add(new URL(env.APP_URL).origin);
  } catch {
    /* validated by env */
  }
  for (const raw of (env.TRUSTED_ORIGINS ?? '').split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      list.add(new URL(trimmed).origin);
    } catch {
      /* ignore malformed entries */
    }
  }
  return list;
}

export function isTrustedRequest(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const host = req.headers.get('host');
      if (host && originUrl.host === host) return true;
      return trustedOrigins().has(originUrl.origin);
    } catch {
      return false;
    }
  }
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin' || site === 'none';
}

export function assertTrustedRequest(req: Request): void {
  if (!isTrustedRequest(req)) throw Errors.forbidden('درخواست از مبدأ نامعتبر ارسال شده است.');
}
