import type { RateLimitRule } from '@/lib/rate-limit';

/** Rate limits owned by the monetization feature (kept out of the shared `lib/rate-limit.ts` catalogue). */
export const monetizationLimits = {
  /** Draft saves, submissions and withdrawals. */
  write: { limit: 30, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;
