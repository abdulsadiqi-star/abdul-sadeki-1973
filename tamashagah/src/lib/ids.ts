/**
 * Identifier + token helpers (runtime-agnostic, Node crypto only).
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random base62 string using rejection-free `randomInt` (uniform). */
export function randomBase62(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(BASE62.length)];
  return out;
}

/** 11-char public video id (62^11 ≈ 5e19 possibilities). Collisions are handled by the PK. */
export function newVideoId(): string {
  return randomBase62(11);
}

export const VIDEO_ID_REGEX = /^[0-9A-Za-z]{11}$/;
export const isVideoId = (value: string): boolean => VIDEO_ID_REGEX.test(value);

/** URL-safe random secret (default 32 bytes = 256 bit). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Deterministic id of a user's "Watch later" playlist. */
export const watchLaterPlaylistId = (userId: string) => `wl_${userId}`;
