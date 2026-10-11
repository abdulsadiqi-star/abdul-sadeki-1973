import type { RateLimitRule } from '@/lib/rate-limit';

/**
 * Rate limits of staff mutations (per staff member). They are generous — they only exist to stop a
 * compromised or buggy session from mass-editing the platform in seconds.
 * (Kept here instead of `@/lib/rate-limit` `limits` to avoid touching the shared catalogue.)
 */
export const adminLimits = {
  /** Everyday moderation: report decisions, takedowns, comment actions, verification, ... */
  write: { limit: 120, windowSeconds: 60 },
  /** Irreversible or high-impact operations: force delete, role changes, user suspension, monetization decisions. */
  sensitive: { limit: 30, windowSeconds: 10 * 60 },
  /** Support replies. */
  reply: { limit: 60, windowSeconds: 10 * 60 },
} satisfies Record<string, RateLimitRule>;
