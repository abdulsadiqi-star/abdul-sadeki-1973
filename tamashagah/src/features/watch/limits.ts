import type { RateLimitRule } from '@/lib/rate-limit';

/**
 * Rate limits owned by the watch feature (the shared `limits` catalogue in src/lib/rate-limit.ts is not edited).
 *
 * Heartbeats are limited per VIEWER cookie rather than per IP: behind carrier-grade NAT thousands of real
 * viewers share one address, so the per-IP rule is only a flood guard.
 */
export const watchLimits = {
  /** Per viewer + video: a real player sends one view per 30 min. */
  viewPerViewer: { limit: 6, windowSeconds: 60 },
  /** Per viewer: one beat every ~15 s plus pause/unload beacons. */
  heartbeatPerViewer: { limit: 30, windowSeconds: 60 },
  /** Flood guard per client IP. */
  heartbeatPerIp: { limit: 1_200, windowSeconds: 60 },
  /** Processing-status polling by owners/moderators. */
  statusPoll: { limit: 60, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;
