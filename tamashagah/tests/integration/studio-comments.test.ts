import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { postComment } from '@/features/comments/service';
import { blockCommenter, moderateComment, moderateComments, replyAsCreator, unblockCommenter } from '@/features/comments/moderation-service';
import { getStudioCommentCounts, listSpamWriters, listStudioComments } from '@/features/comments/studio-queries';
import {
  blockCommenterAction,
  bulkModerateCommentsAction,
  creatorReplyAction,
  moderateCommentAction,
  unblockCommenterAction,
} from '@/features/comments/studio-actions';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import type { Viewer } from '@/features/engagement/service';

type U = Awaited<ReturnType<typeof createUser>>;
const viewerOf = (u: U): Viewer => ({
  id: u.id,
  displayName: u.displayName,
  role: u.role,
  channelId: u.channel?.id ?? null,
  emailVerified: u.emailVerifiedAt !== null,
});

async function setup() {
  const owner = await createUser({ withChannel: true, displayName: 'سازنده' });
  const rival = await createUser({ withChannel: true, displayName: 'رقیب' });
  const fan = await createUser({ displayName: 'علاقه‌مند' });
  const other = await createUser({ displayName: 'دیگری' });
  const video = await createVideo(owner.channel!.id, { title: 'ویدیوی من' });
  const rivalVideo = await createVideo(rival.channel!.id, { title: 'ویدیوی رقیب' });
  return { owner, rival, fan, other, video, rivalVideo };
}

/** Insert a comment row directly (status is explicit) and keep the counters the way the feature maintains them. */
async function seed(videoId: string, authorId: string, body: string, status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'SPAM' | 'DELETED', parentId?: string) {
  const parent = parentId ? await db.comment.findUniqueOrThrow({ where: { id: parentId } }) : null;
  const rootId = parent ? (parent.rootId ?? parent.id) : null;
  const row = await db.comment.create({
    data: { videoId, authorId, body, status, parentId: parent?.id ?? null, rootId, replyToUserId: parent?.authorId ?? null },
  });
  if (status === 'APPROVED') {
    await db.video.update({ where: { id: videoId }, data: { commentCount: { increment: 1 } } });
    if (rootId) await db.comment.update({ where: { id: rootId }, data: { replyCount: { increment: 1 } } });
  }
  return row;
}

const commentCount = async (videoId: string) => (await db.video.findUniqueOrThrow({ where: { id: videoId } })).commentCount;
const statusOf = async (id: string) => (await db.comment.findUniqueOrThrow({ where: { id } })).status;

describe('moderateComment', () => {
  it('approves a held comment: counters, audit trail and a COMMENT_APPROVED notification', async () => {
    const { owner, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'منتظر تأیید', 'PENDING');
    expect(await moderateComment(viewerOf(owner), c.id, 'APPROVED')).toEqual({ changed: true });

    expect(await statusOf(c.id)).toBe('APPROVED');
    expect(await commentCount(video.id)).toBe(1);
    const action = await db.moderationAction.findFirstOrThrow({ where: { commentId: c.id } });
    expect(action).toMatchObject({ type: 'COMMENT_APPROVE', actorId: owner.id, channelId: owner.channel!.id, targetUserId: fan.id });
    const notice = await db.notification.findFirstOrThrow({ where: { userId: fan.id } });
    expect(notice).toMatchObject({ type: 'COMMENT_APPROVED', actorId: owner.id, commentId: c.id, href: `/watch/${video.id}#comments` });
    expect(notice.title).toContain('تأیید و منتشر شد');
  });

  it('rejects, marks as spam, deletes and restores — counters stay exact and every change is audited', async () => {
    const { owner, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'یک دیدگاه', 'APPROVED');
    for (const [status, counter] of [['REJECTED', 0], ['APPROVED', 1], ['SPAM', 0], ['APPROVED', 1], ['DELETED', 0]] as const) {
      await moderateComment(viewerOf(owner), c.id, status);
      expect(await commentCount(video.id)).toBe(counter);
      expect(await statusOf(c.id)).toBe(status);
    }
    const types = (await db.moderationAction.findMany({ where: { commentId: c.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.type);
    expect(types).toEqual(['COMMENT_REJECT', 'COMMENT_APPROVE', 'COMMENT_SPAM', 'COMMENT_APPROVE', 'COMMENT_DELETE']);
  });

  it('is idempotent and never resurrects deleted comments', async () => {
    const { owner, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'یک دیدگاه', 'APPROVED');
    expect(await moderateComment(viewerOf(owner), c.id, 'REJECTED')).toEqual({ changed: true });
    expect(await moderateComment(viewerOf(owner), c.id, 'REJECTED')).toEqual({ changed: false });
    expect(await db.moderationAction.count({ where: { commentId: c.id } })).toBe(1);
    await moderateComment(viewerOf(owner), c.id, 'DELETED');
    await expect(moderateComment(viewerOf(owner), c.id, 'APPROVED')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('only notifies on a real approval, not when it was already public', async () => {
    const { owner, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'عمومی', 'APPROVED');
    await moderateComment(viewerOf(owner), c.id, 'APPROVED');
    expect(await db.notification.count()).toBe(0);
  });

  it('answers NOT_FOUND to people who may not moderate this channel (never 403)', async () => {
    const { owner, rival, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'دیدگاه من', 'PENDING');
    await expect(moderateComment(viewerOf(rival), c.id, 'APPROVED')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(moderateComment(viewerOf(fan), c.id, 'APPROVED')).rejects.toMatchObject({ code: 'NOT_FOUND' }); // the author cannot approve themselves
    await expect(moderateComment(viewerOf(owner), 'cknonexistent0000000000000', 'APPROVED')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await statusOf(c.id)).toBe('PENDING');
    expect(await commentCount(video.id)).toBe(0);
  });

  it('does not let platform moderators moderate through the studio (the staff panel does, with policy + audit)', async () => {
    const { fan, video } = await setup();
    const moderator = await createUser({ role: 'MODERATOR' });
    const c = await seed(video.id, fan.id, 'دیدگاه', 'APPROVED');
    await expect(moderateComment(viewerOf(moderator), c.id, 'SPAM')).rejects.toMatchObject({ status: 404 });
    expect((await db.comment.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('APPROVED');
  });

  it('a deleted root takes its live replies with it so counters cannot drift', async () => {
    const { owner, fan, other, video } = await setup();
    const root = await seed(video.id, fan.id, 'اصلی', 'APPROVED');
    const r1 = await seed(video.id, other.id, 'پاسخ ۱', 'APPROVED', root.id);
    const r2 = await seed(video.id, other.id, 'پاسخ ۲', 'PENDING', root.id);
    const r3 = await seed(video.id, other.id, 'پاسخ ۳', 'SPAM', root.id);
    expect(await commentCount(video.id)).toBe(2);

    await moderateComment(viewerOf(owner), root.id, 'DELETED');
    expect(await commentCount(video.id)).toBe(0);
    expect(await statusOf(r1.id)).toBe('DELETED');
    expect(await statusOf(r2.id)).toBe('DELETED');
    expect(await statusOf(r3.id)).toBe('SPAM'); // already out of the way, left as evidence
  });
});

describe('moderateComments (bulk)', () => {
  it('applies one status to many comments and skips ids it may not touch', async () => {
    const { owner, rival, fan, video, rivalVideo } = await setup();
    const mine = await Promise.all([1, 2, 3].map((i) => seed(video.id, fan.id, `دیدگاه ${i}`, 'PENDING')));
    const foreign = await seed(rivalVideo.id, fan.id, 'دیدگاه روی ویدیوی رقیب', 'PENDING');
    const ids = [...mine.map((c) => c.id), foreign.id, 'cknonexistent0000000000000', mine[0]!.id];

    const result = await moderateComments(viewerOf(owner), ids, 'APPROVED');
    expect(result).toEqual({ changed: 3, skipped: 2 });
    expect(await commentCount(video.id)).toBe(3);
    expect(await statusOf(foreign.id)).toBe('PENDING');
    expect(await commentCount(rivalVideo.id)).toBe(0);
    expect(await db.notification.count({ where: { type: 'COMMENT_APPROVED' } })).toBe(3);
    expect(rival.id).toBeTruthy();
  });

  it('handles roots and their replies in one batch', async () => {
    const { owner, fan, other, video } = await setup();
    const root = await seed(video.id, fan.id, 'اصلی', 'APPROVED');
    const reply = await seed(video.id, other.id, 'پاسخ', 'APPROVED', root.id);
    await moderateComments(viewerOf(owner), [root.id, reply.id], 'DELETED');
    expect(await commentCount(video.id)).toBe(0);
    expect((await db.comment.findMany()).every((c) => c.status === 'DELETED')).toBe(true);
  });
});

describe('replyAsCreator', () => {
  it('approves a held comment first, publishes the reply and notifies the author', async () => {
    const { owner, fan, video } = await setup();
    const held = await seed(video.id, fan.id, 'سؤال من این است', 'PENDING');
    const result = await replyAsCreator(viewerOf(owner), held.id, 'پاسخ سازنده');

    expect(result.approvedParent).toBe(true);
    expect(result.reply).toMatchObject({ status: 'APPROVED', rootId: held.id, author: { isCreator: true } });
    expect(await statusOf(held.id)).toBe('APPROVED');
    expect(await commentCount(video.id)).toBe(2);
    expect((await db.comment.findUniqueOrThrow({ where: { id: held.id } })).replyCount).toBe(1);
    const types = (await db.notification.findMany({ where: { userId: fan.id } })).map((n) => n.type).sort();
    expect(types).toEqual(['COMMENT_APPROVED', 'COMMENT_REPLY'].sort());
  });

  it('answers a published comment without touching its status', async () => {
    const { owner, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'سؤال من این است', 'APPROVED');
    const result = await replyAsCreator(viewerOf(owner), c.id, 'ممنون از شما');
    expect(result.approvedParent).toBe(false);
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('validates the text before changing anything', async () => {
    const { owner, fan, video } = await setup();
    const held = await seed(video.id, fan.id, 'سؤال', 'PENDING');
    await expect(replyAsCreator(viewerOf(owner), held.id, '   ')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await statusOf(held.id)).toBe('PENDING');
  });

  it('refuses rejected / spam / deleted targets and other channels', async () => {
    const { owner, rival, fan, video } = await setup();
    for (const status of ['REJECTED', 'SPAM'] as const) {
      const c = await seed(video.id, fan.id, `دیدگاه ${status}`, status);
      await expect(replyAsCreator(viewerOf(owner), c.id, 'پاسخ')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    const gone = await seed(video.id, fan.id, 'حذف شده', 'DELETED');
    await expect(replyAsCreator(viewerOf(owner), gone.id, 'پاسخ')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const ok = await seed(video.id, fan.id, 'عادی', 'APPROVED');
    await expect(replyAsCreator(viewerOf(rival), ok.id, 'پاسخ')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is blocked when the channel turned comments off', async () => {
    const { owner, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'عادی', 'APPROVED');
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'DISABLED' } });
    await expect(replyAsCreator(viewerOf(owner), c.id, 'پاسخ')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('blocking commenters', () => {
  it('blocks and unblocks with an audit trail, idempotently', async () => {
    const { owner, fan, video } = await setup();
    const channelId = owner.channel!.id;
    expect(await blockCommenter(viewerOf(owner), channelId, fan.id, 'هرزنامه می‌فرستاد')).toEqual({ changed: true });
    expect(await blockCommenter(viewerOf(owner), channelId, fan.id)).toEqual({ changed: false });
    expect(await db.channelBlock.findUniqueOrThrow({ where: { channelId_userId: { channelId, userId: fan.id } } })).toMatchObject({ reason: 'هرزنامه می‌فرستاد' });
    await expect(postComment(viewerOf(fan), { videoId: video.id, body: 'سلام' })).rejects.toMatchObject({ code: 'BLOCKED' });

    expect(await unblockCommenter(viewerOf(owner), channelId, fan.id)).toEqual({ changed: true });
    expect(await unblockCommenter(viewerOf(owner), channelId, fan.id)).toEqual({ changed: false });
    const actions = await db.moderationAction.findMany({ orderBy: { createdAt: 'asc' } });
    expect(actions.map((a) => [a.type, a.targetUserId, a.channelId, a.actorId])).toEqual([
      ['CHANNEL_USER_BLOCK', fan.id, channelId, owner.id],
      ['CHANNEL_USER_UNBLOCK', fan.id, channelId, owner.id],
    ]);
    await expect(postComment(viewerOf(fan), { videoId: video.id, body: 'حالا می‌توانم' })).resolves.toMatchObject({ outcome: 'published' });
  });

  it('cannot block the owner, unknown users, or act on another channel', async () => {
    const { owner, rival, fan } = await setup();
    await expect(blockCommenter(viewerOf(owner), owner.channel!.id, owner.id)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(blockCommenter(viewerOf(owner), owner.channel!.id, 'cknonexistent0000000000000')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(blockCommenter(viewerOf(rival), owner.channel!.id, fan.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unblockCommenter(viewerOf(rival), owner.channel!.id, fan.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.channelBlock.count()).toBe(0);
  });
});

describe('studio queries', () => {
  async function populate() {
    const ctx = await setup();
    const { owner, rival, fan, other, video, rivalVideo } = ctx;
    const approved = await seed(video.id, fan.id, 'دیدگاه تأیید شده درباره‌ی پلو', 'APPROVED');
    const pending1 = await seed(video.id, fan.id, 'دیدگاه در انتظار اول', 'PENDING');
    const pending2 = await seed(video.id, other.id, 'دیدگاه در انتظار دوم', 'PENDING');
    const rejected = await seed(video.id, other.id, 'دیدگاه ردشده', 'REJECTED');
    const spam1 = await seed(video.id, other.id, 'کسب درآمد دلاری', 'SPAM');
    const spam2 = await seed(video.id, other.id, 'خرید فالوور', 'SPAM');
    const reply = await seed(video.id, other.id, 'پاسخ به دیدگاه تأیید شده', 'APPROVED', approved.id);
    const replySpam = await seed(video.id, fan.id, 'پاسخ هرز', 'SPAM', approved.id);
    await seed(video.id, fan.id, 'حذف شده', 'DELETED');
    await seed(rivalVideo.id, fan.id, 'دیدگاه روی کانال دیگر', 'PENDING');
    return { ...ctx, approved, pending1, pending2, rejected, spam1, spam2, reply, replySpam, owner, rival };
  }

  it('counts every tab for the channel only (deleted and other channels excluded)', async () => {
    const { owner } = await populate();
    // all = approved + pending×2 + rejected + reply(approved) = 5 ; spam = 3 ; pending = 2 ; replies = reply only (spam reply excluded) = 1
    expect(await getStudioCommentCounts(owner.channel!.id)).toEqual({ all: 5, spam: 3, pending: 2, replies: 1 });
  });

  it('lists each tab newest first with the video, author and block information', async () => {
    const { owner, other, approved, pending1, pending2, reply, video } = await populate();
    const channelId = owner.channel!.id;
    await db.channelBlock.create({ data: { channelId, userId: other.id } });

    const pending = await listStudioComments(channelId, { tab: 'pending' });
    expect(pending.total).toBe(2);
    expect(pending.items.map((c) => c.id)).toEqual([pending2.id, pending1.id]);
    expect(pending.items[0]).toMatchObject({
      status: 'PENDING',
      isReply: false,
      author: { id: other.id, name: 'دیگری', blocked: true },
      video: { id: video.id, title: 'ویدیوی من' },
    });
    expect(pending.items[1]!.author.blocked).toBe(false);

    const replies = await listStudioComments(channelId, { tab: 'replies' });
    expect(replies.items.map((c) => c.id)).toEqual([reply.id]);
    expect(replies.items[0]).toMatchObject({ isReply: true, parentExcerpt: approved.body });

    const all = await listStudioComments(channelId, { tab: 'all' });
    expect(all.items.every((c) => c.status !== 'SPAM' && c.status !== 'DELETED')).toBe(true);
    expect(all.total).toBe(5);
    const spam = await listStudioComments(channelId, { tab: 'spam' });
    expect(spam.items.map((c) => c.status)).toEqual(['SPAM', 'SPAM', 'SPAM']);
  });

  it('searches comment text, author and video title, and paginates with a stable total', async () => {
    const { owner } = await populate();
    const channelId = owner.channel!.id;
    expect((await listStudioComments(channelId, { tab: 'all', q: 'پلو' })).items.map((c) => c.body)).toEqual(['دیدگاه تأیید شده درباره‌ی پلو']);
    expect((await listStudioComments(channelId, { tab: 'all', q: 'علاقه‌مند' })).total).toBe(2); // approved + pending1 by "علاقه‌مند"
    expect((await listStudioComments(channelId, { tab: 'all', q: 'ویدیوی من' })).total).toBe(5); // video title
    expect((await listStudioComments(channelId, { tab: 'all', q: 'چیزی که وجود ندارد' })).total).toBe(0);
    // Arabic Yeh (U+064A) typed by the creator still matches the normalized (Persian Yeh) stored text
    expect((await listStudioComments(channelId, { tab: 'all', q: 'تأيید شده' })).items.map((c) => c.body)).toEqual([
      'پاسخ به دیدگاه تأیید شده',
      'دیدگاه تأیید شده درباره‌ی پلو',
    ]);

    const p1 = await listStudioComments(channelId, { tab: 'all', pageSize: 2, page: 1 });
    const p2 = await listStudioComments(channelId, { tab: 'all', pageSize: 2, page: 2 });
    const p3 = await listStudioComments(channelId, { tab: 'all', pageSize: 2, page: 3 });
    expect([p1.total, p1.pageCount, p3.items.length]).toEqual([5, 3, 1]);
    expect(new Set([...p1.items, ...p2.items, ...p3.items].map((c) => c.id)).size).toBe(5);
    expect((await listStudioComments(channelId, { tab: 'all', pageSize: 2, page: 99 })).page).toBe(3); // clamped
  });

  it('lists spam writers with counts, and keeps blocked people visible so a block can be undone', async () => {
    const { owner, fan, other } = await populate();
    const channelId = owner.channel!.id;
    const quiet = await createUser({ displayName: 'ساکت' });
    await db.channelBlock.create({ data: { channelId, userId: quiet.id } });
    await db.channelBlock.create({ data: { channelId, userId: other.id } });

    const writers = await listSpamWriters(channelId);
    expect(writers.map((w) => [w.name, w.spamCount, w.blocked])).toEqual([
      ['دیگری', 2, true],
      ['علاقه‌مند', 1, false],
      ['ساکت', 0, true],
    ]);
    expect(writers.find((w) => w.userId === fan.id)).toBeTruthy();
    expect(await listSpamWriters((await createUser({ withChannel: true })).channel!.id)).toEqual([]);
  });
});

describe('studio server actions', () => {
  it('require sign-in; forged ids from another channel are 404', async () => {
    const { owner, rival, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'منتظر', 'PENDING');
    logout();
    expect(await moderateCommentAction({ commentId: c.id, status: 'APPROVED' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await bulkModerateCommentsAction({ commentIds: [c.id], status: 'APPROVED' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await creatorReplyAction({ commentId: c.id, body: 'سلام' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await blockCommenterAction({ userId: fan.id })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await unblockCommenterAction({ userId: fan.id })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });

    await loginAs(rival.id);
    expect(await moderateCommentAction({ commentId: c.id, status: 'APPROVED' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await bulkModerateCommentsAction({ commentIds: [c.id], status: 'APPROVED' })).toEqual({ ok: true, data: { changed: 0, skipped: 1 } });
    expect(await creatorReplyAction({ commentId: c.id, body: 'سلام' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await statusOf(c.id)).toBe('PENDING');

    await loginAs(owner.id);
    expect(await moderateCommentAction({ commentId: c.id, status: 'APPROVED' })).toEqual({ ok: true, data: { changed: true } });
  });

  it('validate their input', async () => {
    const { owner } = await setup();
    await loginAs(owner.id);
    expect(await moderateCommentAction({ commentId: 'x', status: 'APPROVED' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await moderateCommentAction({ commentId: 'cknonexistent0000000000000', status: 'PENDING' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await bulkModerateCommentsAction({ commentIds: [], status: 'APPROVED' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    const tooMany = Array.from({ length: 101 }, (_, i) => `ck${String(i).padStart(22, '0')}`);
    expect(await bulkModerateCommentsAction({ commentIds: tooMany, status: 'SPAM' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await creatorReplyAction({ commentId: 'cknonexistent0000000000000', body: 5 })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('blocking needs a channel and works end to end', async () => {
    const { owner, fan } = await setup();
    await loginAs(fan.id); // a user without a channel
    expect(await blockCommenterAction({ userId: owner.id })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await loginAs(owner.id);
    expect(await blockCommenterAction({ userId: fan.id, reason: 'مزاحمت' })).toEqual({ ok: true, data: { changed: true } });
    expect(await unblockCommenterAction({ userId: fan.id })).toEqual({ ok: true, data: { changed: true } });
  });

  it('rate limits studio actions', async () => {
    const { owner, fan, video } = await setup();
    const c = await seed(video.id, fan.id, 'دیدگاه', 'APPROVED');
    await loginAs(owner.id);
    let limited = 0;
    for (let i = 0; i < 62; i++) {
      const res = await moderateCommentAction({ commentId: c.id, status: i % 2 ? 'APPROVED' : 'REJECTED' });
      if (!res.ok && res.code === 'RATE_LIMITED') limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
