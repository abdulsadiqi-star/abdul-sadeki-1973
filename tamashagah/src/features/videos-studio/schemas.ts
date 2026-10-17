import { z } from 'zod';
import '@/lib/zod-fa';
import { normalizeTags, normalizeUserText } from '@/lib/persian';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { languageCodes, studioSorts, studioTabs } from './labels';

export const videoIdSchema = z.string().regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.');

const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'تاریخ نامعتبر است.')
  .transform((v) => new Date(v));

/** The metadata form shared by the upload cards and the edit page (all text is normalized before it is stored). */
export const videoMetadataSchema = z
  .object({
    title: z
      .string()
      .transform((s) => normalizeUserText(s))
      .pipe(z.string().min(1, 'عنوان ویدیو را وارد کنید.').max(100, 'عنوان نباید بیش از ۱۰۰ نویسه باشد.')),
    description: z
      .string()
      .transform((s) => normalizeUserText(s, { multiline: true }))
      .pipe(z.string().max(5000, 'توضیحات نباید بیش از ۵۰۰۰ نویسه باشد.'))
      .default(''),
    tags: z
      .array(z.string().max(80))
      .max(40, 'حداکثر ۱۵ برچسب مجاز است.')
      .default([])
      .transform((tags) => normalizeTags(tags)),
    categoryId: z
      .string()
      .max(40)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE'], 'سطح دسترسی را انتخاب کنید.'),
    publishMode: z.enum(['PUBLISH', 'SCHEDULE', 'DRAFT']).default('PUBLISH'),
    /** ISO instant; required when `publishMode` is SCHEDULE. */
    scheduledFor: isoDate.nullable().optional(),
    commentsEnabled: z.boolean().default(true),
    /** Only sent by the edit page; `undefined` leaves the stored value untouched. */
    ageRestricted: z.boolean().optional(),
    language: z.enum(languageCodes, 'زبان انتخاب‌شده معتبر نیست.').optional(),
    kindChoice: z.enum(['auto', 'VIDEO', 'SHORT']).default('auto'),
  })
  .superRefine((value, ctx) => {
    if (value.publishMode === 'SCHEDULE' && !value.scheduledFor) {
      ctx.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'برای زمان‌بندی، تاریخ و ساعت انتشار را انتخاب کنید.' });
    }
  });

export type VideoMetadataInput = z.input<typeof videoMetadataSchema>;
export type VideoMetadata = z.output<typeof videoMetadataSchema>;

export const updateVideoSchema = z.object({ id: videoIdSchema, metadata: videoMetadataSchema });

export const videoRefSchema = z.object({ id: videoIdSchema });

export const BULK_MAX = 50;

export const bulkVideosSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), ids: z.array(videoIdSchema).min(1).max(BULK_MAX) }),
  z.object({
    action: z.literal('visibility'),
    ids: z.array(videoIdSchema).min(1).max(BULK_MAX),
    visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']),
  }),
  z.object({ action: z.literal('delete'), ids: z.array(videoIdSchema).min(1).max(BULK_MAX) }),
]);

export const selectThumbnailSchema = z.object({ id: videoIdSchema, index: z.number().int().min(1).max(3) });

export const subtitleLanguageSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Za-z]{2,8})?$/, 'کد زبان معتبر نیست (مثلاً fa یا en).');

export const subtitleUploadSchema = z.object({
  language: subtitleLanguageSchema,
  label: z
    .string()
    .transform((s) => normalizeUserText(s))
    .pipe(z.string().min(1, 'نام زیرنویس را وارد کنید.').max(40, 'نام زیرنویس نباید بیش از ۴۰ نویسه باشد.')),
});

export const deleteSubtitleSchema = z.object({ id: videoIdSchema, assetId: z.string().min(10).max(40) });

/** `/studio/videos?...` — every value is optional and falls back to a default (bad input never errors the page). */
export const studioListParamsSchema = z.object({
  tab: z.enum(studioTabs.map((t) => t.value) as [string, ...string[]]).catch('all'),
  q: z
    .string()
    .max(100)
    .catch('')
    .transform((s) => normalizeUserText(s)),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional().catch(undefined),
  category: z.string().min(10).max(40).optional().catch(undefined),
  sort: z.enum(studioSorts.map((s) => s.value) as [string, ...string[]]).catch('newest'),
  view: z.enum(['grid', 'list']).catch('grid'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type StudioListParams = z.output<typeof studioListParamsSchema>;
