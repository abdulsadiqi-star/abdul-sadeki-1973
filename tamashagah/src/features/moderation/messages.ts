/**
 * Persian texts of the notifications staff actions send to the affected users. Pure functions, unit-tested.
 * Titles are short sentences; the staff member's reason travels in `body` so the creator always learns WHY.
 */
import { toPersianDigits, truncate } from '@/lib/persian';
import { labels } from '@/lib/i18n/fa';
import type { MonetizationDecision } from '@/features/admin/policy';
import type { NotificationType, ReportTarget, UserRole } from '@/generated/prisma/enums';

export type StaffMessage = { type: NotificationType; title: string; body: string | null; href: string | null };

const q = (s: string) => `«${truncate(s, 60)}»`;
const because = (reason: string | null | undefined) => (reason ? `دلیل: ${reason}` : null);
const lines = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join('\n');
const APPEAL = 'اگر فکر می‌کنید اشتباهی رخ داده است، از بخش پشتیبانی پیگیری کنید.';

export const messages = {
  videoTakedown: (video: { id: string; title: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: `ویدیوی ${q(video.title)} از دسترس عمومی خارج شد`,
    body: lines(because(reason), APPEAL),
    href: `/studio/videos/${video.id}/edit`,
  }),
  videoRestore: (video: { id: string; title: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: `ویدیوی ${q(video.title)} دوباره در دسترس قرار گرفت`,
    body: reason ? `توضیح: ${reason}` : null,
    href: `/studio/videos/${video.id}/edit`,
  }),
  videoDelete: (video: { title: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: `ویدیوی ${q(video.title)} توسط مدیریت حذف شد`,
    body: lines(because(reason), APPEAL),
    href: '/studio/videos',
  }),
  commentDelete: (comment: { videoId: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: 'یکی از دیدگاه‌های شما توسط ناظران حذف شد',
    body: lines(because(reason), APPEAL),
    href: `/watch/${comment.videoId}`,
  }),
  commentRestore: (comment: { videoId: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: 'دیدگاه حذف‌شده‌ی شما بازگردانده شد',
    body: reason ? `توضیح: ${reason}` : null,
    href: `/watch/${comment.videoId}`,
  }),
  channelSuspend: (channel: { name: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: `کانال ${q(channel.name)} تعلیق شد`,
    body: lines(because(reason), `تا رفع تعلیق، کانال و ویدیوهای آن برای عموم نمایش داده نمی‌شود. ${APPEAL}`),
    href: '/help/tickets',
  }),
  channelRestore: (channel: { name: string; handle: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: `تعلیق کانال ${q(channel.name)} برداشته شد`,
    body: reason ? `توضیح: ${reason}` : null,
    href: `/channel/${channel.handle}`,
  }),
  channelVerified: (channel: { name: string; handle: string }, note: string | null): StaffMessage => ({
    type: 'VERIFICATION_UPDATE',
    title: `کانال ${q(channel.name)} تأیید شد و نشان تأیید گرفت`,
    body: note ? `توضیح: ${note}` : null,
    href: `/channel/${channel.handle}`,
  }),
  channelUnverified: (channel: { name: string }, reason: string): StaffMessage => ({
    type: 'VERIFICATION_UPDATE',
    title: `نشان تأیید کانال ${q(channel.name)} برداشته شد`,
    body: because(reason),
    href: '/verification',
  }),
  userSuspend: (reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: 'حساب کاربری شما تعلیق شد',
    body: lines(because(reason), APPEAL),
    href: '/help',
  }),
  userRestore: (reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: 'تعلیق حساب کاربری شما برداشته شد',
    body: reason ? `توضیح: ${reason}` : null,
    href: '/',
  }),
  roleChange: (role: UserRole, reason: string): StaffMessage => ({
    type: 'SYSTEM',
    title: `نقش حساب شما به «${labels.role[role]}» تغییر کرد`,
    body: reason ? `توضیح: ${reason}` : null,
    href: role === 'MODERATOR' || role === 'ADMIN' ? '/admin' : null,
  }),
  commenterBlocked: (channel: { name: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: `امکان ثبت دیدگاه شما در کانال ${q(channel.name)} محدود شد`,
    body: lines(because(reason), APPEAL),
    href: '/help/tickets',
  }),
  commenterUnblocked: (channel: { name: string }, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: `محدودیت ثبت دیدگاه شما در کانال ${q(channel.name)} برداشته شد`,
    body: reason ? `توضیح: ${reason}` : null,
    href: null,
  }),
  warning: (about: string, reason: string): StaffMessage => ({
    type: 'MODERATION',
    title: 'هشدار از تیم نظارت تماشاگاه',
    body: lines(`درباره‌ی ${about}`, because(reason), 'تکرار این مورد می‌تواند به محدودیت حساب یا کانال بینجامد.'),
    href: '/terms',
  }),
  monetization: (decision: MonetizationDecision, channel: { name: string }, note: string | null): StaffMessage => {
    const title: Record<MonetizationDecision, string> = {
      APPROVE: `درخواست درآمدزایی کانال ${q(channel.name)} تأیید شد`,
      REJECT: `درخواست درآمدزایی کانال ${q(channel.name)} پذیرفته نشد`,
      SUSPEND: `درآمدزایی کانال ${q(channel.name)} تعلیق شد`,
      REINSTATE: `تعلیق درآمدزایی کانال ${q(channel.name)} برداشته شد`,
    };
    return { type: 'MONETIZATION_UPDATE', title: title[decision], body: note ? `توضیح بررسی‌کننده: ${note}` : null, href: '/studio/monetization' };
  },
  verification: (approved: boolean, channel: { name: string }, note: string | null): StaffMessage => ({
    type: 'VERIFICATION_UPDATE',
    title: approved
      ? `درخواست تیک تأیید کانال ${q(channel.name)} پذیرفته شد`
      : `درخواست تیک تأیید کانال ${q(channel.name)} پذیرفته نشد`,
    body: note ? `توضیح بررسی‌کننده: ${note}` : null,
    href: '/verification',
  }),
  ticketReply: (ticket: { number: number }, reply: string): StaffMessage => ({
    type: 'TICKET_REPLY',
    title: `پاسخ جدید به تیکت شماره‌ی ${toPersianDigits(ticket.number)}`,
    body: truncate(reply, 200),
    href: '/help/tickets',
  }),
};

/** "این ویدیو" style phrase used in warnings and audit metadata. */
export function reportedThing(type: ReportTarget, label: string | null): string {
  switch (type) {
    case 'VIDEO':
      return label ? `ویدیوی ${q(label)}` : 'یکی از ویدیوهای شما';
    case 'CHANNEL':
      return label ? `کانال ${q(label)}` : 'کانال شما';
    case 'COMMENT':
      return 'یکی از دیدگاه‌های شما';
  }
}
