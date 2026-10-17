/**
 * Persian copy for every NotificationType (no server imports: used by the notifications center on the client).
 *
 * Notifications are created with their own (already Persian) `title`/`body` by whoever raises them. This table adds
 * what the center needs around that text: a short label for the kind of notification and a natural fallback
 * sentence for the rare row whose title is empty. `Record<NotificationType, …>` makes TypeScript fail the build
 * when a new type is added to the schema without copy.
 */
import type { NotificationType } from '@/generated/prisma/enums';

export type NotificationGroup = 'comments' | 'audience' | 'videos' | 'account';

export const notificationTypeMeta: Record<NotificationType, { label: string; group: NotificationGroup; fallbackTitle: string }> = {
  NEW_COMMENT: { label: 'دیدگاه جدید', group: 'comments', fallbackTitle: 'دیدگاه تازه‌ای زیر یکی از ویدیوهای شما ثبت شد' },
  COMMENT_PENDING: { label: 'در انتظار تأیید', group: 'comments', fallbackTitle: 'دیدگاهی منتظر تأیید شماست' },
  COMMENT_REPLY: { label: 'پاسخ به دیدگاه', group: 'comments', fallbackTitle: 'کسی به دیدگاه شما پاسخ داد' },
  COMMENT_APPROVED: { label: 'دیدگاه تأیید شد', group: 'comments', fallbackTitle: 'دیدگاه شما تأیید و منتشر شد' },
  VIDEO_LIKED: { label: 'پسندیده شدن', group: 'audience', fallbackTitle: 'ویدیوی شما پسندیده شد' },
  NEW_FOLLOWER: { label: 'دنبال‌کننده‌ی جدید', group: 'audience', fallbackTitle: 'کسی کانال شما را دنبال کرد' },
  VIDEO_READY: { label: 'ویدیو آماده شد', group: 'videos', fallbackTitle: 'پردازش ویدیوی شما تمام شد و آماده‌ی پخش است' },
  VIDEO_FAILED: { label: 'پردازش ناموفق', group: 'videos', fallbackTitle: 'پردازش ویدیوی شما با خطا روبه‌رو شد' },
  VIDEO_PUBLISHED: { label: 'ویدیو منتشر شد', group: 'videos', fallbackTitle: 'ویدیوی شما منتشر شد' },
  NEW_VIDEO: { label: 'ویدیوی جدید', group: 'videos', fallbackTitle: 'کانالی که دنبال می‌کنید ویدیوی تازه‌ای منتشر کرد' },
  MODERATION: { label: 'اطلاعیه‌ی نظارت', group: 'account', fallbackTitle: 'درباره‌ی محتوای شما اطلاعیه‌ای از تیم نظارت رسیده است' },
  MONETIZATION_UPDATE: { label: 'درآمدزایی', group: 'account', fallbackTitle: 'وضعیت درخواست درآمدزایی شما تغییر کرد' },
  VERIFICATION_UPDATE: { label: 'تأیید کانال', group: 'account', fallbackTitle: 'وضعیت درخواست تأیید کانال شما تغییر کرد' },
  TICKET_REPLY: { label: 'پاسخ پشتیبانی', group: 'account', fallbackTitle: 'پشتیبانی به درخواست شما پاسخ داد' },
  SYSTEM: { label: 'اطلاعیه‌ی تماشاگاه', group: 'account', fallbackTitle: 'اطلاعیه‌ی تازه‌ای از تماشاگاه' },
};

/** The text to show for a notification: its own title, or the natural fallback for its type. */
export function notificationTitle(n: { type: NotificationType; title: string }): string {
  return n.title.trim() || notificationTypeMeta[n.type].fallbackTitle;
}
