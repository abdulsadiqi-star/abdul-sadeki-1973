import type { RateLimitRule } from '@/lib/rate-limit';

/** Rate limits owned by the analytics feature (kept out of the shared `lib/rate-limit.ts` catalogue). */
export const analyticsLimits = {
  /** CSV export: each call runs several aggregations, so keep it modest. */
  export: { limit: 20, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;
