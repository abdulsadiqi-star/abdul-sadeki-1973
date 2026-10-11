import type { RateLimitRule } from '@/lib/rate-limit';

/** Rate limits owned by the studio video features (see the note in features/uploads/limits.ts). */
export const studioLimits = {
  /** Metadata edits, deletes, publish toggles (shares the spirit of `limits.generalWrite`). */
  write: { limit: 90, windowSeconds: 60 },
  retry: { limit: 10, windowSeconds: 10 * 60 },
  bulk: { limit: 20, windowSeconds: 60 },
  /** Thumbnail / subtitle uploads decode and store files: keep them modest. */
  media: { limit: 30, windowSeconds: 10 * 60 },
  /** Status polling: one request every ~2 s per processing video (batched by the list page). */
  status: { limit: 300, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;
