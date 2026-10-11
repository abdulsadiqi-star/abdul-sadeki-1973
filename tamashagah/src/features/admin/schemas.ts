import { z } from 'zod';
import '@/lib/zod-fa';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { TEHRAN_OFFSET_MINUTES } from '@/lib/jalali';
import { normalizeUserText, toPersianDigits } from '@/lib/persian';
import { ModerationActionType, ReportReason, TicketCategory, UserRole } from '@/generated/prisma/enums';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const TICKET_REPLY_MAX = 5000;

/** Prisma cuid (25 chars) — loose bounds on purpose, existence is always re-checked against the database. */
export const idSchema = z.string({ error: 'شناسه نامعتبر است.' }).min(10, 'شناسه نامعتبر است.').max(40, 'شناسه نامعتبر است.');
export const videoIdSchema = z.string({ error: 'شناسه‌ی ویدیو نامعتبر است.' }).regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.');

/** A mandatory explanation, normalized and bounded (it is stored, audited and shown to the affected user). */
export const reasonSchema = z
  .string({ error: 'دلیل را بنویسید.' })
  .transform((s) => normalizeUserText(s, { multiline: true }))
  .pipe(
    z
      .string()
      .min(REASON_MIN, `دلیل باید دست‌کم ${toPersianDigits(REASON_MIN)} نویسه باشد.`)
      .max(REASON_MAX, `دلیل نباید بیش از ${toPersianDigits(REASON_MAX)} نویسه باشد.`),
  );

/** An optional note: empty / missing → null. */
export const optionalNoteSchema = z
  .string()
  .optional()
  .nullable()
  .transform((s) => (s ? normalizeUserText(s, { multiline: true }) : ''))
  .pipe(z.string().max(REASON_MAX, `توضیح نباید بیش از ${toPersianDigits(REASON_MAX)} نویسه باشد.`))
  .transform((s) => (s ? s : null));

const resolveAll = z.boolean().default(true);

// ---------------------------------------------------------------------------
// Action inputs
// ---------------------------------------------------------------------------

export const startReviewSchema = z.object({ id: idSchema });

export const dismissReportSchema = z.object({ reportId: idSchema, reason: reasonSchema, resolveAll });
export const warnCreatorSchema = z.object({ reportId: idSchema, reason: reasonSchema, resolveAll });

export const takedownVideoSchema = z.object({ videoId: videoIdSchema, reason: reasonSchema, reportId: idSchema.optional(), resolveAll });
export const restoreVideoSchema = z.object({ videoId: videoIdSchema, reason: reasonSchema, reportId: idSchema.optional() });
export const deleteVideoSchema = z.object({ videoId: videoIdSchema, reason: reasonSchema });

export const deleteCommentSchema = z.object({ commentId: idSchema, reason: reasonSchema, reportId: idSchema.optional(), resolveAll });
export const restoreCommentSchema = z.object({ commentId: idSchema, reason: reasonSchema, reportId: idSchema.optional() });
export const blockCommenterSchema = z.object({ channelId: idSchema, userId: idSchema, reason: reasonSchema, reportId: idSchema.optional() });
export const unblockCommenterSchema = blockCommenterSchema;

export const suspendChannelSchema = z.object({ channelId: idSchema, reason: reasonSchema, reportId: idSchema.optional(), resolveAll });
export const restoreChannelSchema = z.object({ channelId: idSchema, reason: reasonSchema, reportId: idSchema.optional() });
export const verifyChannelSchema = z.object({ channelId: idSchema, note: optionalNoteSchema });
export const unverifyChannelSchema = z.object({ channelId: idSchema, reason: reasonSchema });

export const changeUserRoleSchema = z.object({ userId: idSchema, role: z.enum(UserRole, { error: 'نقش انتخاب‌شده معتبر نیست.' }), reason: reasonSchema });
export const suspendUserSchema = z.object({ userId: idSchema, reason: reasonSchema });
export const restoreUserSchema = z.object({ userId: idSchema, reason: reasonSchema });

export const MONETIZATION_DECISIONS = ['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE'] as const;
export const decideMonetizationSchema = z
  .object({ id: idSchema, decision: z.enum(MONETIZATION_DECISIONS, { error: 'تصمیم نامعتبر است.' }), note: optionalNoteSchema })
  .superRefine((v, ctx) => {
    if ((v.decision === 'REJECT' || v.decision === 'SUSPEND') && !v.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'برای رد یا تعلیق، توضیح تصمیم الزامی است.' });
    }
  });

export const VERIFICATION_DECISIONS = ['APPROVE', 'REJECT'] as const;
export const decideVerificationSchema = z
  .object({ id: idSchema, decision: z.enum(VERIFICATION_DECISIONS, { error: 'تصمیم نامعتبر است.' }), note: optionalNoteSchema })
  .superRefine((v, ctx) => {
    if (v.decision === 'REJECT' && !v.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'برای رد درخواست، دلیل آن را بنویسید.' });
    }
  });

export const replyTicketSchema = z.object({
  ticketId: idSchema,
  body: z
    .string({ error: 'متن پاسخ را بنویسید.' })
    .transform((s) => normalizeUserText(s, { multiline: true }))
    .pipe(z.string().min(2, 'متن پاسخ را بنویسید.').max(TICKET_REPLY_MAX, `پاسخ نباید بیش از ${toPersianDigits(TICKET_REPLY_MAX)} نویسه باشد.`)),
});
export const ticketIdSchema = z.object({ ticketId: idSchema });

// ---------------------------------------------------------------------------
// List / filter parameters (URL search params). They NEVER throw: garbage falls back to defaults.
// ---------------------------------------------------------------------------

const page = z.coerce.number().int().min(1).max(100_000).catch(1);
const text = (max: number) =>
  z
    .string()
    .optional()
    .catch(undefined)
    .transform((s) => {
      const v = s ? normalizeUserText(s).slice(0, max) : '';
      return v || undefined;
    });
const oneOf = <const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).catch(fallback);

export const PAGE_SIZE = 20;

export const reportListSchema = z.object({
  status: oneOf(['PENDING', 'OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED', 'ALL'], 'PENDING'),
  target: oneOf(['ALL', 'VIDEO', 'COMMENT', 'CHANNEL'], 'ALL'),
  reason: z.union([z.enum(ReportReason), z.literal('ALL')]).catch('ALL'),
  age: oneOf(['ALL', 'DAY', 'WEEK', 'OLDER'], 'ALL'),
  sort: oneOf(['oldest', 'newest'], 'oldest'),
  page,
});
export type ReportListParams = z.output<typeof reportListSchema>;

export const videoListSchema = z.object({
  q: text(100),
  /** `PENDING` = queued or being processed (the overview links to it). */
  processing: oneOf(['ALL', 'AWAITING_UPLOAD', 'QUEUED', 'PROCESSING', 'PENDING', 'READY', 'FAILED'], 'ALL'),
  publish: oneOf(['ALL', 'DRAFT', 'SCHEDULED', 'PUBLISHED'], 'ALL'),
  visibility: oneOf(['ALL', 'PUBLIC', 'UNLISTED', 'PRIVATE'], 'ALL'),
  takedown: oneOf(['ALL', 'YES', 'NO'], 'ALL'),
  channel: text(60),
  page,
});
export type VideoListParams = z.output<typeof videoListSchema>;

export const channelListSchema = z.object({
  q: text(100),
  verified: oneOf(['ALL', 'YES', 'NO'], 'ALL'),
  suspended: oneOf(['ALL', 'YES', 'NO'], 'ALL'),
  sort: oneOf(['newest', 'followers'], 'newest'),
  page,
});
export type ChannelListParams = z.output<typeof channelListSchema>;

export const userListSchema = z.object({
  q: text(100),
  role: z.union([z.enum(UserRole), z.literal('ALL')]).catch('ALL'),
  status: oneOf(['ALL', 'ACTIVE', 'SUSPENDED'], 'ALL'),
  page,
});
export type UserListParams = z.output<typeof userListSchema>;

export const monetizationListSchema = z.object({
  status: oneOf(['PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL'], 'PENDING'),
  q: text(100),
  page,
});
export type MonetizationListParams = z.output<typeof monetizationListSchema>;

export const verificationListSchema = z.object({
  status: oneOf(['PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ALL'], 'PENDING'),
  q: text(100),
  page,
});
export type VerificationListParams = z.output<typeof verificationListSchema>;

export const supportListSchema = z.object({
  status: oneOf(['ACTIVE', 'OPEN', 'ANSWERED', 'CLOSED', 'ALL'], 'ACTIVE'),
  category: z.union([z.enum(TicketCategory), z.literal('ALL')]).catch('ALL'),
  q: text(100),
  page,
});
export type SupportListParams = z.output<typeof supportListSchema>;

const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
  .optional()
  .catch(undefined);

export const activityListSchema = z.object({
  actor: text(80),
  type: z.union([z.enum(ModerationActionType), z.literal('ALL')]).catch('ALL'),
  target: text(120),
  /** Gregorian `YYYY-MM-DD` of a Tehran calendar day (the Jalali pickers convert to it). */
  from: dayKey,
  to: dayKey,
  page,
});
export type ActivityListParams = z.output<typeof activityListSchema>;

/** First instant of the Tehran calendar day `YYYY-MM-DD`. */
export function tehranDayStart(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) - TEHRAN_OFFSET_MINUTES * 60_000);
}

/** First instant AFTER the Tehran calendar day `YYYY-MM-DD` (exclusive upper bound). */
export function tehranDayEnd(key: string): Date {
  return new Date(tehranDayStart(key).getTime() + 86_400_000);
}

/** Next.js `searchParams` → plain record (first value wins) ready for the list schemas. */
export function flattenSearchParams(raw: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}
