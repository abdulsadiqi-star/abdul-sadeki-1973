import type { RateLimitRule } from '@/lib/rate-limit';

/** Rate limits owned by the studio dashboard (kept out of the shared `lib/rate-limit.ts` catalogue). */
export const studioLimits = {
  /** Quick comment approvals from the dashboard. */
  moderate: { limit: 60, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;
