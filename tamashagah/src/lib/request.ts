/**
 * Request metadata helpers (runtime-agnostic: only needs a `Headers` object).
 *
 * The App Router exposes no socket, so the client IP can only come from
 * X-Forwarded-For. It is trusted ONLY when TRUSTED_PROXY_HOPS > 0 (the number
 * of reverse proxies you control in front of the app); otherwise the header is
 * attacker-controlled and ignored.
 */
import { env } from './env';
import { hmacHex } from './ids';

export function getClientIp(headers: Headers): string | null {
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops <= 0) return null;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const idx = parts.length - hops;
    return (idx >= 0 ? parts[idx] : parts[0]) ?? null;
  }
  return headers.get('x-real-ip');
}

/** HMAC of the IP — what we persist/log instead of the raw address. */
export function hashIp(ip: string | null): string | null {
  return ip ? hmacHex(env.SESSION_SECRET, `ip:${ip}`).slice(0, 32) : null;
}

export function getUserAgent(headers: Headers): string | null {
  return headers.get('user-agent')?.slice(0, 255) ?? null;
}

export type DeviceKind = 'DESKTOP' | 'MOBILE' | 'TABLET' | 'TV' | 'OTHER';

/** Very small UA classifier for analytics (no fingerprinting). */
export function detectDevice(userAgent: string | null | undefined): DeviceKind {
  if (!userAgent) return 'OTHER';
  const ua = userAgent.toLowerCase();
  if (/smart-?tv|hbbtv|appletv|tizen|webos|crkey|roku/.test(ua)) return 'TV';
  if (/ipad|tablet|(android(?!.*mobile))/.test(ua)) return 'TABLET';
  if (/mobi|iphone|ipod|android/.test(ua)) return 'MOBILE';
  if (/windows|macintosh|x11|linux|cros/.test(ua)) return 'DESKTOP';
  return 'OTHER';
}

/** Hostname of a referrer URL, or 'direct'. */
export function referrerHost(referrer: string | null | undefined, selfHost?: string): string {
  if (!referrer) return 'direct';
  try {
    const host = new URL(referrer).hostname;
    return selfHost && host === selfHost ? 'internal' : host.slice(0, 100);
  } catch {
    return 'direct';
  }
}

/** Only allow same-site relative redirect targets ("/studio", never "//evil.com" or "https://..."). */
export function safeRedirectPath(input: string | null | undefined, fallback = '/'): string {
  if (!input) return fallback;
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\') || /[\r\n]/.test(input)) {
    return fallback;
  }
  return input;
}
