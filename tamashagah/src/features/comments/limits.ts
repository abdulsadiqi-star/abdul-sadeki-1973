/** Tunables for the comments feature (kept here so the shared rate-limit catalogue is not edited). */

export const COMMENT_MAX_LENGTH = 1000;
/** Raw input bound applied before normalization (invisible characters and whitespace runs shrink it). */
export const COMMENT_RAW_MAX_LENGTH = COMMENT_MAX_LENGTH * 4;

export const COMMENT_PAGE_SIZE = 20;
export const REPLY_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

/** More than this many links holds a comment for review. */
export const SPAM_MAX_LINKS = 2;
/** The same text posted again by the same author inside this window is treated as spam. */
export const SPAM_DUPLICATE_WINDOW_MS = 10 * 60_000;
/**
 * Duplicates are only judged for texts with at least this many characters after folding (so short praise such as
 * «عالی بود» or «ممنون» that people legitimately repeat on several videos is never flagged).
 */
export const SPAM_DUPLICATE_MIN_CHARS = 12;

/** Studio moderation table. */
export const STUDIO_PAGE_SIZE = 20;
export const BULK_MAX = 100;
export const SPAM_WRITERS_MAX = 50;
