import { describe, expect, it } from 'vitest';
import { createFormatter } from '@/lib/format';
import { actionTypeGroups, actionTypeLabels } from '@/features/admin/labels';
import { describeModerationAction, type AuditSubject } from '@/features/moderation/describe';
import { messages, reportedThing } from '@/features/moderation/messages';
import {
  activityListSchema,
  changeUserRoleSchema,
  decideMonetizationSchema,
  decideVerificationSchema,
  flattenSearchParams,
  optionalNoteSchema,
  reasonSchema,
  reportListSchema,
  replyTicketSchema,
  takedownVideoSchema,
  tehranDayEnd,
  tehranDayStart,
  userListSchema,
  videoListSchema,
} from '@/features/admin/schemas';
import { ModerationActionType } from '@/generated/prisma/enums';

const f = createFormatter('fa');
const base: AuditSubject = { type: 'VIDEO_TAKEDOWN', actor: { name: 'ناظر محتوا' }, targetUser: { name: 'سارا احمدی' }, videoTitle: 'آموزش قورمه‌سبزی', channelName: 'آشپزی با سارا', meta: null };

describe('describeModerationAction', () => {
  it('has a non-empty Persian sentence and a label for every action type', () => {
    for (const type of Object.values(ModerationActionType)) {
      const d = describeModerationAction({ ...base, type, meta: { number: 12, targetType: 'VIDEO' } }, f);
      expect(d.sentence, type).toContain('ناظر محتوا');
      expect(d.predicate.length, type).toBeGreaterThan(5);
      expect(d.sentence, type).not.toMatch(/undefined|null|\[object/);
      expect(actionTypeLabels[type], type).toBeTruthy();
    }
    // every type is offered by the audit-log filter exactly once
    expect(actionTypeGroups.flatMap((g) => g.types).sort()).toEqual(Object.values(ModerationActionType).sort());
  });

  it('names the actor, the subject and what happened', () => {
    expect(describeModerationAction(base, f).sentence).toBe('ناظر محتوا ویدیوی «آموزش قورمه‌سبزی» را از دسترس عمومی خارج کرد');
    expect(describeModerationAction({ ...base, type: 'CHANNEL_SUSPEND' }, f).sentence).toBe('ناظر محتوا کانال «آشپزی با سارا» را تعلیق کرد');
    expect(describeModerationAction({ ...base, type: 'COMMENT_DELETE' }, f).sentence).toContain('دیدگاه «سارا احمدی»');
  });

  it('describes role changes with both roles', () => {
    const d = describeModerationAction({ ...base, type: 'USER_ROLE_CHANGE', meta: { from: 'USER', to: 'MODERATOR' } }, f);
    expect(d.predicate).toBe('نقش «سارا احمدی» را از «کاربر» به «ناظر» تغییر داد');
  });

  it('uses the metadata when the video is gone (force delete) and for monetization variants', () => {
    const gone = describeModerationAction({ ...base, type: 'VIDEO_DELETE', videoTitle: null, meta: { videoTitle: 'ویدیوی قدیمی' } }, f);
    expect(gone.predicate).toBe('ویدیوی «ویدیوی قدیمی» را برای همیشه حذف کرد');
    expect(describeModerationAction({ ...base, type: 'MONETIZATION_REJECT', meta: { action: 'SUSPEND' } }, f).predicate).toContain('تعلیق کرد');
    expect(describeModerationAction({ ...base, type: 'MONETIZATION_REJECT', meta: { action: 'REJECT' } }, f).predicate).toContain('رد کرد');
    expect(describeModerationAction({ ...base, type: 'MONETIZATION_APPROVE', meta: { action: 'REINSTATE' } }, f).predicate).toContain('تعلیق درآمدزایی');
  });

  it('formats ticket numbers with the numeral style and falls back gracefully without an actor', () => {
    const d = describeModerationAction({ ...base, type: 'TICKET_REPLY', actor: null, meta: { number: 128 } }, f);
    expect(d.sentence).toBe('سیستم به تیکت شماره‌ی ۱۲۸ پاسخ داد');
    expect(describeModerationAction({ ...base, type: 'TICKET_CLOSE', meta: { number: 5 } }, createFormatter('en')).predicate).toBe('تیکت شماره‌ی 5 را بست');
  });

  it('tolerates missing relations and malformed metadata', () => {
    const d = describeModerationAction({ type: 'CHANNEL_USER_BLOCK', actor: { name: 'مدیر' }, targetUser: null, videoTitle: null, channelName: null, meta: 'garbage' }, f);
    expect(d.sentence).toBe('مدیر یک کاربر را از ثبت دیدگاه در یک کانال مسدود کرد');
  });
});

describe('notification texts', () => {
  it('always carry the reason for the affected user', () => {
    const reason = 'محتوای خشونت‌آمیز';
    const video = { id: 'aB3dE5gH7jK', title: 'ویدیو' };
    for (const m of [
      messages.videoTakedown(video, reason),
      messages.videoDelete(video, reason),
      messages.commentDelete({ videoId: video.id }, reason),
      messages.channelSuspend({ name: 'کانال' }, reason),
      messages.userSuspend(reason),
      messages.commenterBlocked({ name: 'کانال' }, reason),
      messages.warning('ویدیوی «ویدیو»', reason),
      messages.channelUnverified({ name: 'کانال' }, reason),
    ]) {
      expect(m.body).toContain(reason);
    }
  });

  it('uses the right notification types', () => {
    expect(messages.monetization('APPROVE', { name: 'ک' }, null).type).toBe('MONETIZATION_UPDATE');
    expect(messages.verification(true, { name: 'ک' }, null).type).toBe('VERIFICATION_UPDATE');
    expect(messages.ticketReply({ number: 3 }, 'سلام').type).toBe('TICKET_REPLY');
    expect(messages.videoTakedown({ id: 'x', title: 'ت' }, 'دلیل').type).toBe('MODERATION');
    expect(messages.roleChange('MODERATOR', 'دلیل').type).toBe('SYSTEM');
  });

  it('keeps titles short, quotes names and points to internal paths', () => {
    const long = 'ن'.repeat(300);
    const m = messages.videoTakedown({ id: 'aB3dE5gH7jK', title: long }, 'دلیل');
    expect(m.title.length).toBeLessThan(120);
    expect(m.href).toBe('/studio/videos/aB3dE5gH7jK/edit');
    expect(messages.channelRestore({ name: 'کانال', handle: 'my-ch' }, 'ok').href).toBe('/channel/my-ch');
    expect(messages.ticketReply({ number: 12 }, 'پاسخ').title).toBe('پاسخ جدید به تیکت شماره‌ی ۱۲');
  });

  it('describes each monetization decision', () => {
    expect(messages.monetization('REJECT', { name: 'ک' }, 'کم‌بازدید').title).toContain('پذیرفته نشد');
    expect(messages.monetization('SUSPEND', { name: 'ک' }, null).title).toContain('تعلیق شد');
    expect(messages.monetization('REINSTATE', { name: 'ک' }, null).title).toContain('تعلیق درآمدزایی');
    expect(messages.monetization('APPROVE', { name: 'ک' }, 'عالی').body).toContain('عالی');
  });

  it('phrases the warned subject', () => {
    expect(reportedThing('VIDEO', 'سفر')).toBe('ویدیوی «سفر»');
    expect(reportedThing('CHANNEL', null)).toBe('کانال شما');
    expect(reportedThing('COMMENT', null)).toBe('یکی از دیدگاه‌های شما');
  });
});

describe('input schemas', () => {
  it('reasons are required, normalized and bounded to 500 characters', () => {
    expect(reasonSchema.safeParse('').success).toBe(false);
    expect(reasonSchema.safeParse('  ').success).toBe(false);
    expect(reasonSchema.safeParse('ab').success).toBe(false);
    expect(reasonSchema.safeParse(undefined).success).toBe(false);
    expect(reasonSchema.parse('  محتوای   نامناسب  ')).toBe('محتوای نامناسب');
    expect(reasonSchema.parse('كتاب')).toBe('کتاب'); // Arabic kaf folded
    expect(reasonSchema.safeParse('ا'.repeat(500)).success).toBe(true);
    const tooLong = reasonSchema.safeParse('ا'.repeat(501));
    expect(tooLong.success).toBe(false);
    expect(!tooLong.success && tooLong.error.issues[0]?.message).toContain('۵۰۰');
  });

  it('optional notes become null when empty and are bounded too', () => {
    expect(optionalNoteSchema.parse(undefined)).toBeNull();
    expect(optionalNoteSchema.parse('')).toBeNull();
    expect(optionalNoteSchema.parse('  تأیید شد ')).toBe('تأیید شد');
    expect(optionalNoteSchema.safeParse('ا'.repeat(501)).success).toBe(false);
  });

  it('take-down input defaults to resolving every open report and validates ids', () => {
    const ok = takedownVideoSchema.parse({ videoId: 'aB3dE5gH7jK', reason: 'نقض قوانین' });
    expect(ok.resolveAll).toBe(true);
    expect(takedownVideoSchema.safeParse({ videoId: 'short', reason: 'نقض قوانین' }).success).toBe(false);
    expect(takedownVideoSchema.safeParse({ videoId: 'aB3dE5gH7jK', reason: '' }).success).toBe(false);
  });

  it('monetization rejection / suspension need a note, approval does not', () => {
    const id = 'ckxyz0123456789abcdefghij';
    expect(decideMonetizationSchema.safeParse({ id, decision: 'APPROVE' }).success).toBe(true);
    expect(decideMonetizationSchema.safeParse({ id, decision: 'REINSTATE' }).success).toBe(true);
    expect(decideMonetizationSchema.safeParse({ id, decision: 'REJECT' }).success).toBe(false);
    expect(decideMonetizationSchema.safeParse({ id, decision: 'SUSPEND', note: ' ' }).success).toBe(false);
    expect(decideMonetizationSchema.safeParse({ id, decision: 'REJECT', note: 'آمار کافی نیست' }).success).toBe(true);
    expect(decideMonetizationSchema.safeParse({ id, decision: 'DELETE' }).success).toBe(false);
  });

  it('verification rejection needs a note', () => {
    const id = 'ckxyz0123456789abcdefghij';
    expect(decideVerificationSchema.safeParse({ id, decision: 'APPROVE' }).success).toBe(true);
    expect(decideVerificationSchema.safeParse({ id, decision: 'REJECT' }).success).toBe(false);
    expect(decideVerificationSchema.safeParse({ id, decision: 'REJECT', note: 'مدارک ناکافی' }).success).toBe(true);
  });

  it('role changes validate the role and require a reason', () => {
    const userId = 'ckxyz0123456789abcdefghij';
    expect(changeUserRoleSchema.safeParse({ userId, role: 'MODERATOR', reason: 'اب' }).success).toBe(false); // < 3 chars
    expect(changeUserRoleSchema.safeParse({ userId, role: 'MODERATOR', reason: 'ارتقای نقش' }).success).toBe(true);
    expect(changeUserRoleSchema.safeParse({ userId, role: 'SUPERUSER', reason: 'ارتقای نقش' }).success).toBe(false);
  });

  it('ticket replies are bounded', () => {
    const ticketId = 'ckxyz0123456789abcdefghij';
    expect(replyTicketSchema.safeParse({ ticketId, body: 'x' }).success).toBe(false);
    expect(replyTicketSchema.safeParse({ ticketId, body: 'سلام، مشکل شما بررسی شد.' }).success).toBe(true);
    expect(replyTicketSchema.safeParse({ ticketId, body: 'ا'.repeat(5001) }).success).toBe(false);
  });
});

describe('list filter parsing never throws', () => {
  it('falls back to defaults for garbage', () => {
    const garbage = flattenSearchParams({ status: 'DROP TABLE', target: ['VIDEO', 'x'], reason: '<script>', age: '', sort: 'zzz', page: '-5' });
    expect(reportListSchema.parse(garbage)).toEqual({ status: 'PENDING', target: 'VIDEO', reason: 'ALL', age: 'ALL', sort: 'oldest', page: 1 });
    expect(reportListSchema.parse({ page: 'abc' }).page).toBe(1);
    expect(reportListSchema.parse({ page: '3' }).page).toBe(3);
  });

  it('keeps valid values and trims free text', () => {
    expect(videoListSchema.parse({ q: '  قورمه  ', processing: 'FAILED', takedown: 'YES' })).toMatchObject({ q: 'قورمه', processing: 'FAILED', takedown: 'YES', publish: 'ALL' });
    expect(videoListSchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(userListSchema.parse({ role: 'ADMIN', status: 'SUSPENDED' })).toMatchObject({ role: 'ADMIN', status: 'SUSPENDED' });
    expect(userListSchema.parse({ role: 'ROOT' }).role).toBe('ALL');
  });

  it('activity filters accept only real calendar days', () => {
    expect(activityListSchema.parse({ from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(activityListSchema.parse({ from: '2026-13-45' }).from).toBeUndefined();
    expect(activityListSchema.parse({ from: 'yesterday' }).from).toBeUndefined();
    expect(activityListSchema.parse({ type: 'NOPE' }).type).toBe('ALL');
    expect(activityListSchema.parse({ type: 'VIDEO_TAKEDOWN' }).type).toBe('VIDEO_TAKEDOWN');
  });

  it('Tehran day bounds are 24 hours apart and start at 00:00 +03:30', () => {
    const start = tehranDayStart('2026-10-11');
    expect(start.toISOString()).toBe('2026-10-10T20:30:00.000Z');
    expect(tehranDayEnd('2026-10-11').toISOString()).toBe('2026-10-11T20:30:00.000Z');
  });
});
