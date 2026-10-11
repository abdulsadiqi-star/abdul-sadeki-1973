import type { RateLimitRule } from '@/lib/rate-limit';

/** Rate limits owned by the settings feature (kept out of the shared `lib/rate-limit.ts` catalogue). */
export const settingsLimits = {
  /** Avatar / banner uploads (each one decodes and re-encodes an image). */
  imageUpload: { limit: 10, windowSeconds: 10 * 60 },
  /** Profile, channel and notification-preference saves, session revocation. */
  write: { limit: 30, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;
