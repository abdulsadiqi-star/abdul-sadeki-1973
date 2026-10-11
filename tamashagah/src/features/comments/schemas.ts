import { z } from 'zod';
import '@/lib/zod-fa';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { BULK_MAX, COMMENT_RAW_MAX_LENGTH, MAX_PAGE_SIZE } from './limits';

const cuid = z.string().min(10, 'شناسه‌ی نامعتبر است.').max(40, 'شناسه‌ی نامعتبر است.');
export const videoIdSchema = z.string().regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.');

/** Raw text bound only; the 1000-character rule is applied after normalization in the service. */
const rawBody = z.string().max(COMMENT_RAW_MAX_LENGTH, 'دیدگاه بیش از حد طولانی است.');

export const postCommentSchema = z.object({
  videoId: videoIdSchema,
  body: rawBody,
  /** Comment being replied to (flattened under its root on the server). */
  parentId: cuid.nullish(),
});

export const commentIdSchema = z.object({ commentId: cuid });

/** GET /api/comments */
export const listCommentsQuerySchema = z.object({
  videoId: videoIdSchema,
  cursor: cuid.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

/** GET /api/comments/[id]/replies */
export const listRepliesQuerySchema = z.object({
  cursor: cuid.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

// --- studio ------------------------------------------------------------------------------------------------

export const STUDIO_TABS = ['all', 'spam', 'pending', 'replies'] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];

export const MODERATION_STATUSES = ['APPROVED', 'REJECTED', 'SPAM', 'DELETED'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const moderateCommentSchema = z.object({
  commentId: cuid,
  status: z.enum(MODERATION_STATUSES, { error: 'وضعیت نامعتبر است.' }),
});

export const bulkModerateSchema = z.object({
  commentIds: z.array(cuid).min(1, 'دست‌کم یک دیدگاه را انتخاب کنید.').max(BULK_MAX, `حداکثر ${BULK_MAX} دیدگاه را می‌توان یکجا بررسی کرد.`),
  status: z.enum(MODERATION_STATUSES, { error: 'وضعیت نامعتبر است.' }),
});

export const creatorReplySchema = z.object({ commentId: cuid, body: rawBody });

export const blockCommenterSchema = z.object({
  userId: cuid,
  reason: z.string().max(200, 'توضیح بیش از حد طولانی است.').optional(),
});

export const unblockCommenterSchema = z.object({ userId: cuid });
