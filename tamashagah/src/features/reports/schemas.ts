import { z } from 'zod';
import '@/lib/zod-fa';
import { VIDEO_ID_REGEX } from '@/lib/ids';

export const REPORT_DETAILS_MAX = 500;

export const REPORT_REASONS = ['SPAM', 'ABUSE', 'HATE', 'VIOLENCE', 'ADULT', 'COPYRIGHT', 'MISINFORMATION', 'OTHER'] as const;
export type ReportReasonValue = (typeof REPORT_REASONS)[number];

const reason = z.enum(REPORT_REASONS, { error: 'دلیل گزارش را انتخاب کنید.' });
// Raw bound only; the 500-character rule is applied to the NORMALIZED text in the service.
const details = z.string().max(REPORT_DETAILS_MAX * 4, 'توضیحات بیش از حد طولانی است.').optional();

export const reportVideoSchema = z.object({
  videoId: z.string().regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.'),
  reason,
  details,
});

export const reportCommentSchema = z.object({
  commentId: z.string().min(10).max(40),
  reason,
  details,
});

export type ReportVideoInput = z.infer<typeof reportVideoSchema>;
export type ReportCommentInput = z.infer<typeof reportCommentSchema>;
