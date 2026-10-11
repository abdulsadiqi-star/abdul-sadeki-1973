/**
 * Human-readable Persian sentences for audit-log rows (`ModerationAction`). Pure and runtime-agnostic.
 *
 *   describeModerationAction({ type: 'VIDEO_TAKEDOWN', actor: { name: 'ناظر محتوا' }, videoTitle: 'آموزش قورمه‌سبزی' }, f)
 *   → { actor: 'ناظر محتوا', predicate: 'ویدیوی «آموزش قورمه‌سبزی» را از دسترس عمومی خارج کرد', sentence: '...' }
 */
import { labels } from '@/lib/i18n/fa';
import { truncate } from '@/lib/persian';
import type { ModerationActionType, UserRole } from '@/generated/prisma/enums';

export type AuditSubject = {
  type: ModerationActionType;
  actor: { name: string } | null;
  /** The account affected (blocked commenter, suspended user, comment author, channel owner, ...). */
  targetUser: { name: string } | null;
  videoTitle: string | null;
  channelName: string | null;
  meta: unknown;
};

export type AuditDescription = { actor: string; predicate: string; sentence: string };

type NumberFormatter = { number: (n: number) => string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const metaOf = (meta: unknown): Record<string, unknown> =>
  meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
const quote = (s: string) => `«${truncate(s, 60)}»`;
const roleName = (role: unknown): string => (typeof role === 'string' && role in labels.role ? labels.role[role as UserRole] : 'نامشخص');

export function describeModerationAction(subject: AuditSubject, f: NumberFormatter): AuditDescription {
  const meta = metaOf(subject.meta);
  const actor = subject.actor?.name ?? 'سیستم';
  const user = subject.targetUser?.name ?? str(meta.targetUserName);
  const video = subject.videoTitle ?? str(meta.videoTitle);
  const channel = subject.channelName ?? str(meta.channelName);

  const videoRef = video ? `ویدیوی ${quote(video)}` : 'یک ویدیو';
  const channelRef = channel ? `کانال ${quote(channel)}` : 'یک کانال';
  const commentRef = `${user ? `دیدگاه ${quote(user)}` : 'یک دیدگاه'}${video ? ` در ${videoRef}` : ''}`;
  const userRef = user ? `حساب ${quote(user)}` : 'یک حساب کاربری';
  const ticketRef = `تیکت شماره‌ی ${f.number(num(meta.number) ?? 0)}`;

  /** What a report / warning was about. */
  const reportedRef = (): string => {
    switch (meta.targetType) {
      case 'VIDEO':
        return videoRef;
      case 'COMMENT':
        return commentRef;
      case 'CHANNEL':
        return channelRef;
      default:
        return 'یک مورد';
    }
  };

  const monetizationAction = str(meta.action);
  let predicate: string;
  switch (subject.type) {
    case 'COMMENT_APPROVE':
      predicate = `${commentRef} را تأیید کرد`;
      break;
    case 'COMMENT_REJECT':
      predicate = `${commentRef} را رد کرد`;
      break;
    case 'COMMENT_SPAM':
      predicate = `${commentRef} را هرزنامه علامت زد`;
      break;
    case 'COMMENT_DELETE':
      predicate = `${commentRef} را حذف کرد`;
      break;
    case 'COMMENT_RESTORE':
      predicate = `${commentRef} را بازگرداند`;
      break;
    case 'VIDEO_TAKEDOWN':
      predicate = `${videoRef} را از دسترس عمومی خارج کرد`;
      break;
    case 'VIDEO_RESTORE':
      predicate = `${videoRef} را دوباره در دسترس قرار داد`;
      break;
    case 'VIDEO_DELETE':
      predicate = `${videoRef} را برای همیشه حذف کرد`;
      break;
    case 'CHANNEL_SUSPEND':
      predicate = `${channelRef} را تعلیق کرد`;
      break;
    case 'CHANNEL_RESTORE':
      predicate = `تعلیق ${channelRef} را برداشت`;
      break;
    case 'CHANNEL_VERIFY':
      predicate = `به ${channelRef} تیک تأیید داد`;
      break;
    case 'CHANNEL_UNVERIFY':
      predicate = `تیک تأیید ${channelRef} را برداشت`;
      break;
    case 'USER_SUSPEND':
      predicate = `${userRef} را تعلیق کرد`;
      break;
    case 'USER_RESTORE':
      predicate = `تعلیق ${userRef} را برداشت`;
      break;
    case 'USER_ROLE_CHANGE':
      predicate = `نقش ${user ? quote(user) : 'یک کاربر'} را از ${quote(roleName(meta.from))} به ${quote(roleName(meta.to))} تغییر داد`;
      break;
    case 'CHANNEL_USER_BLOCK':
      predicate = `${user ? quote(user) : 'یک کاربر'} را از ثبت دیدگاه در ${channelRef} مسدود کرد`;
      break;
    case 'CHANNEL_USER_UNBLOCK':
      predicate = `مسدودیت ${user ? quote(user) : 'یک کاربر'} را در ${channelRef} برداشت`;
      break;
    case 'REPORT_DISMISS':
      predicate = `گزارش درباره‌ی ${reportedRef()} را رد کرد`;
      break;
    case 'CREATOR_WARN':
      predicate = `درباره‌ی ${reportedRef()} به ${user ? quote(user) : 'سازنده'} هشدار داد`;
      break;
    case 'MONETIZATION_APPROVE':
      predicate =
        monetizationAction === 'REINSTATE'
          ? `تعلیق درآمدزایی ${channelRef} را برداشت`
          : `درخواست درآمدزایی ${channelRef} را تأیید کرد`;
      break;
    case 'MONETIZATION_REJECT':
      predicate =
        monetizationAction === 'SUSPEND'
          ? `درآمدزایی ${channelRef} را تعلیق کرد`
          : `درخواست درآمدزایی ${channelRef} را رد کرد`;
      break;
    case 'VERIFICATION_REJECT':
      predicate = `درخواست تیک تأیید ${channelRef} را رد کرد`;
      break;
    case 'TICKET_REPLY':
      predicate = `به ${ticketRef} پاسخ داد`;
      break;
    case 'TICKET_CLOSE':
      predicate = `${ticketRef} را بست`;
      break;
    case 'TICKET_REOPEN':
      predicate = `${ticketRef} را دوباره باز کرد`;
      break;
    default: {
      // Exhaustiveness guard: a new enum value without a sentence must fail the type check.
      const _never: never = subject.type;
      predicate = `اقدامی ثبت کرد (${String(_never)})`;
    }
  }
  return { actor, predicate, sentence: `${actor} ${predicate}` };
}
