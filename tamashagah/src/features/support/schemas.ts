import '@/lib/zod-fa';
import { z } from 'zod';
import { normalizeUserText } from '@/lib/persian';

export const TICKET_SUBJECT_MIN = 5;
export const TICKET_SUBJECT_MAX = 120;
export const TICKET_MESSAGE_MIN = 10;
export const TICKET_MESSAGE_MAX = 5000;
/** A user may have at most this many unresolved (OPEN) tickets at once. */
export const MAX_OPEN_TICKETS = 10;
/** A single thread stops accepting messages after this many (the support team can open a new one). */
export const MAX_MESSAGES_PER_TICKET = 200;

export const TICKET_CATEGORIES = ['ACCOUNT', 'UPLOAD', 'PLAYBACK', 'COPYRIGHT', 'MONETIZATION', 'REPORT_ABUSE', 'OTHER'] as const;

const text = (label: string, min: number, max: number, multiline = false) =>
  z
    .string(`${label} را وارد کنید.`)
    .transform((v) => normalizeUserText(v, { multiline }))
    .pipe(
      z
        .string()
        .min(min, `${label} باید دست‌کم ${min} نویسه باشد.`)
        .max(max, `${label} نباید بیشتر از ${max} نویسه باشد.`),
    );

export const createTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES, { error: 'دسته‌بندی را انتخاب کنید.' }),
  subject: text('موضوع', TICKET_SUBJECT_MIN, TICKET_SUBJECT_MAX),
  message: text('متن پیام', TICKET_MESSAGE_MIN, TICKET_MESSAGE_MAX, true),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const ticketIdSchema = z.string().min(10).max(40).regex(/^[A-Za-z0-9_-]+$/, 'شناسه‌ی تیکت نامعتبر است.');

export const replyTicketSchema = z.object({
  ticketId: ticketIdSchema,
  body: text('متن پاسخ', 2, TICKET_MESSAGE_MAX, true),
});
export type ReplyTicketInput = z.input<typeof replyTicketSchema>;

// ---------------------------------------------------------------------------
// Verification request
// ---------------------------------------------------------------------------

export const VERIFICATION_MESSAGE_MIN = 30;
export const VERIFICATION_MESSAGE_MAX = 2000;
export const MAX_EVIDENCE_LINKS = 5;

const httpsUrl = z
  .string()
  .trim()
  .max(500, 'نشانی بیش از حد طولانی است.')
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'نشانی باید معتبر باشد و با https:// شروع شود.');

export const evidenceLinkSchema = z.object({
  title: text('عنوان پیوند', 2, 80),
  url: httpsUrl,
});

export const verificationRequestSchema = z.object({
  message: text('توضیح', VERIFICATION_MESSAGE_MIN, VERIFICATION_MESSAGE_MAX, true),
  evidenceLinks: z.array(evidenceLinkSchema).max(MAX_EVIDENCE_LINKS, `حداکثر ${MAX_EVIDENCE_LINKS} پیوند مجاز است.`).default([]),
});
export type VerificationRequestInput = z.input<typeof verificationRequestSchema>;

// ---------------------------------------------------------------------------
// Copyright notice
// ---------------------------------------------------------------------------

export const copyrightNoticeSchema = z.object({
  /** A watch/shorts URL of this site, or the 11-character video id. */
  videoRef: z.string('نشانی یا شناسه‌ی ویدیو را وارد کنید.').trim().min(11, 'نشانی یا شناسه‌ی ویدیو را وارد کنید.').max(300, 'نشانی بیش از حد طولانی است.'),
  claimantName: text('نام و نام خانوادگی', 3, 100),
  contactEmail: z.string().trim().toLowerCase().max(254).pipe(z.email('ایمیل واردشده معتبر نیست.')),
  workDescription: text('توضیح اثر', 20, 2000, true),
  originalUrl: z.union([z.literal(''), httpsUrl]).default(''),
  goodFaith: z.boolean().refine((v) => v === true, 'برای ثبت شکایت باید این بیانیه را تأیید کنید.'),
  accuracy: z.boolean().refine((v) => v === true, 'برای ثبت شکایت باید این بیانیه را تأیید کنید.'),
  signature: text('امضای الکترونیک', 3, 100),
});
export type CopyrightNoticeInput = z.input<typeof copyrightNoticeSchema>;
