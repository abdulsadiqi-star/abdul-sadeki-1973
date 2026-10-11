import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { approveCommentAction } from '@/features/studio/actions';
import { getDashboardData } from '@/features/studio/queries';
import { videoStatusBadge } from '@/features/studio/status';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { addComment, addLike, addViews } from '../helpers/insights-fixtures';

// 2026-10-11 23:00 in Tehran (19 Mehr 1405)
const NOW = new Date('2026-10-11T19:30:00.000Z');

async function channelWith() {
  const owner = await createUser({ withChannel: true });
  return { owner, channelId: owner.channel!.id, userId: owner.id };
}

describe('dashboard numbers (reproducible from the database)', () => {
  it('counts videos, followers, total and today\'s views exactly', async () => {
    const { owner, channelId } = await channelWith();
    const other = await createUser({ withChannel: true });
    const otherVideo = await createVideo(other.channel!.id);
    const v1 = await createVideo(channelId, { title: 'اول' });
    const v2 = await createVideo(channelId, { title: 'دوم' });
    await createVideo(channelId, { state: 'draft' });
    const abandoned = await createVideo(channelId, { title: 'ناتمام' });
    await db.video.update({ where: { id: abandoned.id }, data: { processingStatus: 'AWAITING_UPLOAD' } });
    await db.channel.update({ where: { id: channelId }, data: { followerCount: 42 } });

    await addViews([
      { channelId, videoId: v1.id, at: '2026-10-10T20:29:59.999Z' }, // 10-10 23:59:59 Tehran → yesterday
      { channelId, videoId: v1.id, at: '2026-10-10T20:30:00.000Z' }, // 10-11 00:00:00 sharp → today
      { channelId, videoId: v1.id, at: '2026-10-11T08:00:00.000Z' },
      { channelId, videoId: v2.id, at: '2026-10-11T12:00:00.000Z', source: 'SEED' },
      { channelId, videoId: v2.id, at: '2026-08-01T12:00:00.000Z' }, // long ago: counts in the total only
      { channelId: other.channel!.id, videoId: otherVideo.id, at: '2026-10-11T08:00:00.000Z' }, // someone else
    ]);

    const data = await getDashboardData({ userId: owner.id, channelId, now: NOW });
    expect(data.counts).toEqual({ videos: 3, published: 2, followers: 42, totalViews: 5, todayViews: 3 });
    expect(data.sample).toEqual({ totalViews: { real: 4, seed: 1 }, todayViews: { real: 2, seed: 1 } });
  });

  it('lists the five newest videos with their own all-time views and likes, newest first', async () => {
    const { owner, channelId } = await channelWith();
    const fans = await Promise.all([createUser(), createUser()]);
    const videos = [];
    for (let i = 1; i <= 7; i++) {
      videos.push(await createVideo(channelId, { title: `ویدیو ${i}`, state: i === 7 ? 'private' : 'public' }));
      await db.video.update({ where: { id: videos[i - 1]!.id }, data: { createdAt: new Date(NOW.getTime() - (8 - i) * 3_600_000) } });
    }
    const newest = videos[6]!;
    const second = videos[5]!;
    await addViews([
      { channelId, videoId: newest.id, at: '2026-10-11T08:00:00.000Z' },
      { channelId, videoId: newest.id, at: '2026-10-11T09:00:00.000Z' },
      { channelId, videoId: second.id, at: '2026-10-11T09:00:00.000Z' },
    ]);
    await addLike(fans[0]!.id, newest.id, '2026-10-11T09:00:00.000Z');
    await addLike(fans[1]!.id, newest.id, '2026-10-11T09:00:00.000Z');

    const data = await getDashboardData({ userId: owner.id, channelId, now: NOW });
    expect(data.recentVideos.map((v) => v.title)).toEqual(['ویدیو 7', 'ویدیو 6', 'ویدیو 5', 'ویدیو 4', 'ویدیو 3']);
    expect(data.recentVideos[0]).toMatchObject({ views: 2, likes: 2, visibility: 'PRIVATE' });
    expect(data.recentVideos[1]).toMatchObject({ views: 1, likes: 0 });
    expect(videoStatusBadge(data.recentVideos[0]!)).toMatchObject({ key: 'private', label: 'خصوصی' });
    expect(videoStatusBadge(data.recentVideos[1]!)).toMatchObject({ key: 'public', label: 'عمومی' });
  });

  it('shows the latest approved and pending comments, hides spam/deleted/other channels, and counts what waits', async () => {
    const { owner, channelId } = await channelWith();
    const stranger = await createUser({ withChannel: true });
    const strangerVideo = await createVideo(stranger.channel!.id);
    const video = await createVideo(channelId, { title: 'ویدیوی من' });
    const fan = await createUser({ displayName: 'علی' });
    const at = (m: number) => new Date(NOW.getTime() - m * 60_000);
    await addComment(video.id, fan.id, at(50), 'APPROVED', 'قدیمی');
    await addComment(video.id, fan.id, at(40), 'PENDING', 'در انتظار الف');
    await addComment(video.id, fan.id, at(30), 'SPAM', 'هرزنامه');
    await addComment(video.id, fan.id, at(20), 'DELETED', 'حذف‌شده');
    await addComment(video.id, fan.id, at(10), 'REJECTED', 'ردشده');
    await addComment(video.id, fan.id, at(5), 'PENDING', 'در انتظار ب');
    await addComment(strangerVideo.id, fan.id, at(1), 'PENDING', 'کانال دیگر');

    const data = await getDashboardData({ userId: owner.id, channelId, now: NOW });
    expect(data.recentComments.map((c) => c.body)).toEqual(['در انتظار ب', 'در انتظار الف', 'قدیمی']);
    expect(data.recentComments[0]).toMatchObject({ status: 'PENDING', author: { name: 'علی' }, video: { id: video.id, title: 'ویدیوی من' } });
    expect(data.pendingComments).toBe(2);
  });

  it('reports processing and failed uploads (with the creator-visible reason) and unread notifications', async () => {
    const { owner, channelId } = await channelWith();
    const processing = await createVideo(channelId, { state: 'processing', title: 'در حال پردازش' });
    await db.transcodeJob.create({ data: { videoId: processing.id, status: 'ACTIVE', stage: 'TRANSCODE', progress: 45 } });
    const failed = await createVideo(channelId, { state: 'failed', title: 'ناموفق' });
    await db.video.update({ where: { id: failed.id }, data: { failureReason: 'فرمت فایل پشتیبانی نمی‌شود.' } });
    await createVideo(channelId, { title: 'سالم' });
    await db.notification.createMany({
      data: [
        { userId: owner.id, type: 'NEW_FOLLOWER', title: 'الف' },
        { userId: owner.id, type: 'NEW_FOLLOWER', title: 'ب', readAt: new Date() },
        { userId: owner.id, type: 'NEW_COMMENT', title: 'ج' },
      ],
    });

    const data = await getDashboardData({ userId: owner.id, channelId, now: NOW });
    expect(data.alerts.processing).toEqual([{ id: processing.id, title: 'در حال پردازش', status: 'PROCESSING', progress: 45, failureReason: null }]);
    expect(data.alerts.failed).toEqual([{ id: failed.id, title: 'ناموفق', status: 'FAILED', progress: null, failureReason: 'فرمت فایل پشتیبانی نمی‌شود.' }]);
    expect(data.notifications.unread).toBe(2);
    expect(data.notifications.items).toHaveLength(3);
  });

  it('is all zeros and empty for a brand-new channel', async () => {
    const { owner, channelId } = await channelWith();
    const data = await getDashboardData({ userId: owner.id, channelId, now: NOW });
    expect(data.counts).toEqual({ videos: 0, published: 0, followers: 0, totalViews: 0, todayViews: 0 });
    expect(data.recentVideos).toEqual([]);
    expect(data.recentComments).toEqual([]);
    expect(data.alerts).toEqual({ processing: [], failed: [] });
    expect(data.notifications).toEqual({ unread: 0, items: [] });
  });
});

describe('quick approve (dashboard)', () => {
  async function pendingComment() {
    const { owner, channelId } = await channelWith();
    const video = await createVideo(channelId, { title: 'ویدیو' });
    const fan = await createUser({ displayName: 'نظر‌دهنده' });
    const comment = await addComment(video.id, fan.id, new Date(), 'PENDING', 'سلام');
    return { owner, channelId, video, fan, comment };
  }

  it('lets the channel owner approve: status, counters, audit row and a notification to the author', async () => {
    const { owner, video, fan, comment } = await pendingComment();
    await loginAs(owner.id);
    expect(await approveCommentAction({ commentId: comment.id })).toEqual({ ok: true, data: { approved: true } });

    expect(await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).toMatchObject({ status: 'APPROVED', moderatedById: owner.id });
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).commentCount).toBe(1);
    expect(await db.moderationAction.findMany({ where: { commentId: comment.id } })).toMatchObject([{ type: 'COMMENT_APPROVE', actorId: owner.id }]);
    const notes = await db.notification.findMany({ where: { userId: fan.id, type: 'COMMENT_APPROVED' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ href: `/watch/${video.id}`, actorId: owner.id, commentId: comment.id });
  });

  it('is idempotent and never double counts', async () => {
    const { owner, video, comment } = await pendingComment();
    await loginAs(owner.id);
    await approveCommentAction({ commentId: comment.id });
    expect(await approveCommentAction({ commentId: comment.id })).toEqual({ ok: true, data: { approved: true } });
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).commentCount).toBe(1);
    expect(await db.moderationAction.count({ where: { commentId: comment.id } })).toBe(1);
  });

  it('answers 404 (never 403) for another channel\'s comment and for unknown ids, and changes nothing', async () => {
    const { comment, video } = await pendingComment();
    const stranger = await createUser({ withChannel: true });
    await loginAs(stranger.id);
    expect(await approveCommentAction({ commentId: comment.id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await approveCommentAction({ commentId: 'doesNotExist123456' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).status).toBe('PENDING');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).commentCount).toBe(0);
  });

  it('requires a signed-in user and refuses forged input', async () => {
    const { owner, comment } = await pendingComment();
    logout();
    expect(await approveCommentAction({ commentId: comment.id })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    await loginAs(owner.id);
    expect(await approveCommentAction({ commentId: comment.id, status: 'SPAM' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await approveCommentAction({})).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await approveCommentAction({ commentId: 123 })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).status).toBe('PENDING');
  });

  it('only approves comments that are waiting; rejected, spam and deleted ones stay as they are', async () => {
    const { owner, video, fan } = await pendingComment();
    await loginAs(owner.id);
    for (const status of ['REJECTED', 'SPAM', 'DELETED'] as const) {
      const comment = await addComment(video.id, fan.id, new Date(), status);
      expect(await approveCommentAction({ commentId: comment.id }), status).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).status).toBe(status);
    }
  });

  it('lets a moderator approve on any channel (canModerateComments) but not an ordinary user', async () => {
    const { comment } = await pendingComment();
    const moderator = await createUser({ role: 'MODERATOR' });
    await loginAs(moderator.id);
    expect(await approveCommentAction({ commentId: comment.id })).toEqual({ ok: true, data: { approved: true } });
    const plain = await createUser();
    const second = await pendingComment();
    await loginAs(plain.id);
    expect(await approveCommentAction({ commentId: second.comment.id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
