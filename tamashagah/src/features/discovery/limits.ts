import type { RateLimitRule } from '@/lib/rate-limit';

/** Rate limits owned by the discovery feature (kept here so `lib/rate-limit.ts` stays conflict-free). */
export const discoveryLimits = {
  /** Loading the next page of the shorts feed. */
  shortsPage: { limit: 60, windowSeconds: 60 },
  /** Playlist create / rename / delete / remove-item and library clean-ups. */
  libraryWrite: { limit: 60, windowSeconds: 60 },
  /** Creating playlists is rarer and cheaper to abuse. */
  playlistCreate: { limit: 20, windowSeconds: 60 * 60 },
  /** Replies on an existing support ticket. */
  ticketReply: { limit: 20, windowSeconds: 60 * 60 },
  /** Copyright takedown notices (each creates a ticket and a report). */
  copyrightNotice: { limit: 5, windowSeconds: 24 * 60 * 60 },
  /** Verified-badge requests (also limited by "one open request at a time"). */
  verificationRequest: { limit: 3, windowSeconds: 24 * 60 * 60 },
} satisfies Record<string, RateLimitRule>;
