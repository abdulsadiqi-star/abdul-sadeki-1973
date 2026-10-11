/**
 * Persian copy that belongs to the staff panel (shared enum labels live in `@/lib/i18n/fa`).
 * Kept next to the feature on purpose: it must not touch the shared label catalogue.
 */
import type { ModerationActionType, ReportTarget, UserStatus } from '@/generated/prisma/enums';
import type { MonetizationDecision } from './policy';

export const adminLabels = {
  reportTarget: { VIDEO: 'ویدیو', COMMENT: 'دیدگاه', CHANNEL: 'کانال' } satisfies Record<ReportTarget, string>,
  userStatus: { ACTIVE: 'فعال', SUSPENDED: 'تعلیق‌شده' } satisfies Record<UserStatus, string>,
  monetizationDecision: {
    APPROVE: 'تأیید',
    REJECT: 'رد',
    SUSPEND: 'تعلیق',
    REINSTATE: 'رفع تعلیق',
  } satisfies Record<MonetizationDecision, string>,
  /** Which part of the pipeline a video is in (processing + publish combined for lists). */
  videoState: {
    takenDown: 'خارج‌شده از دسترس',
    channelSuspended: 'کانال تعلیق‌شده',
  },
} as const;

/** Short names of audit actions (filters, badges). Full sentences come from `describeModerationAction`. */
export const actionTypeLabels: Record<ModerationActionType, string> = {
  COMMENT_APPROVE: 'تأیید دیدگاه',
  COMMENT_REJECT: 'رد دیدگاه',
  COMMENT_SPAM: 'هرزنامه‌کردن دیدگاه',
  COMMENT_DELETE: 'حذف دیدگاه',
  COMMENT_RESTORE: 'بازگرداندن دیدگاه',
  VIDEO_TAKEDOWN: 'خارج‌کردن ویدیو از دسترس',
  VIDEO_RESTORE: 'بازگرداندن ویدیو',
  VIDEO_DELETE: 'حذف قطعی ویدیو',
  CHANNEL_SUSPEND: 'تعلیق کانال',
  CHANNEL_RESTORE: 'رفع تعلیق کانال',
  CHANNEL_VERIFY: 'تیک تأیید کانال',
  CHANNEL_UNVERIFY: 'برداشتن تیک تأیید',
  USER_SUSPEND: 'تعلیق حساب',
  USER_RESTORE: 'رفع تعلیق حساب',
  USER_ROLE_CHANGE: 'تغییر نقش',
  CHANNEL_USER_BLOCK: 'مسدودکردن دیدگاه‌نویس',
  CHANNEL_USER_UNBLOCK: 'رفع مسدودیت دیدگاه‌نویس',
  REPORT_DISMISS: 'رد گزارش',
  MONETIZATION_APPROVE: 'تأیید درآمدزایی',
  MONETIZATION_REJECT: 'رد یا تعلیق درآمدزایی',
  CREATOR_WARN: 'هشدار به سازنده',
  VERIFICATION_REJECT: 'رد درخواست تیک تأیید',
  TICKET_REPLY: 'پاسخ به تیکت',
  TICKET_CLOSE: 'بستن تیکت',
  TICKET_REOPEN: 'بازگشایی تیکت',
};

/** Groups for the audit-log type filter. */
export const actionTypeGroups: { label: string; types: ModerationActionType[] }[] = [
  {
    label: 'دیدگاه‌ها',
    types: ['COMMENT_APPROVE', 'COMMENT_REJECT', 'COMMENT_SPAM', 'COMMENT_DELETE', 'COMMENT_RESTORE', 'CHANNEL_USER_BLOCK', 'CHANNEL_USER_UNBLOCK'],
  },
  { label: 'ویدیوها', types: ['VIDEO_TAKEDOWN', 'VIDEO_RESTORE', 'VIDEO_DELETE'] },
  { label: 'کانال‌ها', types: ['CHANNEL_SUSPEND', 'CHANNEL_RESTORE', 'CHANNEL_VERIFY', 'CHANNEL_UNVERIFY'] },
  { label: 'کاربران', types: ['USER_SUSPEND', 'USER_RESTORE', 'USER_ROLE_CHANGE'] },
  { label: 'گزارش‌ها', types: ['REPORT_DISMISS', 'CREATOR_WARN'] },
  { label: 'درخواست‌ها', types: ['MONETIZATION_APPROVE', 'MONETIZATION_REJECT', 'VERIFICATION_REJECT'] },
  { label: 'پشتیبانی', types: ['TICKET_REPLY', 'TICKET_CLOSE', 'TICKET_REOPEN'] },
];

/** Age buckets of the report queue. */
export const reportAgeLabels = {
  ALL: 'هر زمان',
  DAY: 'کمتر از ۱ روز',
  WEEK: 'کمتر از ۷ روز',
  OLDER: 'قدیمی‌تر از ۷ روز',
} as const;

/** Statuses offered by the report queue filter (`PENDING` = open + reviewing, the working queue). */
export const reportQueueStatusLabels = {
  PENDING: 'در انتظار بررسی',
  OPEN: 'باز',
  REVIEWING: 'در حال بررسی',
  ACTIONED: 'اقدام شد',
  DISMISSED: 'رد شد',
  ALL: 'همه',
} as const;
