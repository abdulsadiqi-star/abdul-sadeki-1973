import type { RateLimitRule } from '@/lib/rate-limit';

/**
 * Rate limits owned by the upload feature (kept here, not in `lib/rate-limit.ts`, to avoid merge conflicts).
 * Creating uploads additionally uses the shared `limits.uploadCreate` rule.
 */
export const uploadLimits = {
  /**
   * Every tus request (HEAD / PATCH / DELETE / POST) per user per minute. A 2 GiB file in 8 MiB chunks is ~256 PATCHes;
   * retries and several parallel files fit comfortably, floods do not.
   */
  tusRequest: { limit: 1_200, windowSeconds: 60 },
  /** Client-side "upload finished" confirmations. */
  confirm: { limit: 120, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

/** Upload chunk size used by the browser client (matches the S3 multipart part size of the tus store). */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/** Path of the tus endpoint. */
export const UPLOAD_ENDPOINT = '/api/upload';
