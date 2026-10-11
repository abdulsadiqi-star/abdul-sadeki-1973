import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { enqueueVideoCleanup } from '@/lib/queue';
import { canViewVideo, type VideoAccessInfo } from '@/lib/permissions';
import { applyCommentStatus } from '@/features/comments/moderation-core';
import { linkableVideoWhere, publicVideoWhere } from '@/features/videos/visibility';
import {
  blockCommenterAction,
  deleteCommentAction,
  deleteVideoAction,
  restoreChannelAction,
  restoreCommentAction,
  suspendChannelAction,
  unblockCommenterAction,
  unverifyChannelAction,
  verifyChannelAction,
} from '@/features/admin/actions/content';
import {
  actAs,
  administrator,
  auditRows,
  createComment,
  createReport,
  createVideo,
  creator,
  creatorWithVideo,
  expectFailure,
  logout,
  moderator,
  notificationsOf,
  plainUser,
} from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

const reason = 'مطابق قوانین، این مورد قابل قبول نیست';

beforeEach(() => {
  logout();
  vi.mocked(enqueueVideoCleanup).mockClear();
});

const counters = async (videoId: string, rootId?: string) => ({
  comments: (await db.video.findUniqueOrThrow({ where: { id: videoId } })).commentCount,
  replies: rootId ? (await db.comment.findUniqueOrThrow({ where: { id: rootId } })).replyCount : undefined,
});

describe('deleting and restoring comments', () => {
  async function setup() {
    const mod = await moderator();
    const { owner, channel, video } = await creatorWithVideo();
    const author = await plainUser('نویسنده');
    const root = await createComment({ videoId: video.id, authorId: author.id, body: 'دیدگاه اصلی' });
    const reply = await createComment({ videoId: video.id, authorId: author.id, body: 'پاسخ', parentId: root.id });
    const report = await createReport({ reporterId: (await plainUser()).id, comment: reply });
    const second = await createReport({ reporterId: (await plainUser()).id, comment: reply });
    await actAs(mod);
    return { mod, owner, channel, video, author, root, reply, report, second };
  }

  it('deletes through the shared core: counters stay exact, one audit row, report resolved, author notified', async () => {
    const { mod, author, video, root, reply, report, second, channel } = await setup();
    expect(await counters(video.id, root.id)).toEqual({ comments: 2, replies: 1 });

    const res = await deleteCommentAction({ commentId: reply.id, reason, reportId: report.id });
    expect(res).toMatchObject({ ok: true, data: { resolvedReportIds: expect.arrayContaining([report.id, second.id]) } });

    expect(await db.comment.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ status: 'DELETED', moderatedById: mod.id, moderationNote: reason });
    expect(await counters(video.id, root.id)).toEqual({ comments: 1, replies: 0 });
    for (const id of [report.id, second.id]) {
      expect(await db.report.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'ACTIONED', handledById: mod.id });
    }

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'COMMENT_DELETE',
      actorId: mod.id,
      commentId: reply.id,
      videoId: video.id,
      channelId: channel.id,
      targetUserId: author.id,
      reportId: report.id,
      reason,
    });
    expect(rows[0]!.meta).toMatchObject({ from: 'APPROVED', to: 'DELETED', resolvedReportIds: expect.arrayContaining([report.id, second.id]) });

    const [note] = await notificationsOf(author.id);
    expect(note).toMatchObject({ type: 'MODERATION', commentId: reply.id });
    expect(note!.body).toContain(reason);
  });

  it('cannot delete twice and writes nothing on failure', async () => {
    const { reply } = await setup();
    expect((await deleteCommentAction({ commentId: reply.id, reason })).ok).toBe(true);
    await expectFailure(deleteCommentAction({ commentId: reply.id, reason }), 'CONFLICT');
    expect(await db.moderationAction.count()).toBe(1);
  });

  it('restores to the state before the deletion (counters back), logging COMMENT_RESTORE', async () => {
    const { mod, author, video, root, reply, report } = await setup();
    await deleteCommentAction({ commentId: reply.id, reason, reportId: report.id });

    const res = await restoreCommentAction({ commentId: reply.id, reason: 'بازبینی شد؛ مشکلی نبود', reportId: report.id });
    expect(res).toEqual({ ok: true, data: { restoredTo: 'APPROVED' } });
    expect((await db.comment.findUniqueOrThrow({ where: { id: reply.id } })).status).toBe('APPROVED');
    expect(await counters(video.id, root.id)).toEqual({ comments: 2, replies: 1 });
    expect(await db.report.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({ status: 'ACTIONED' }); // not re-opened

    const rows = await auditRows();
    expect(rows.map((r) => r.type)).toEqual(['COMMENT_DELETE', 'COMMENT_RESTORE']);
    expect(rows[1]).toMatchObject({ actorId: mod.id, reportId: report.id, targetUserId: author.id });
    expect((await notificationsOf(author.id)).map((n) => n.title)).toEqual([expect.stringContaining('حذف'), expect.stringContaining('بازگردانده')]);
  });

  it('does not override the creator’s own decision: a comment the owner had marked as spam is restored to SPAM', async () => {
    const { owner, video, author, mod } = await setup();
    const spammy = await createComment({ videoId: video.id, authorId: author.id, body: 'تبلیغ' });
    await applyCommentStatus(spammy.id, 'SPAM', { actorId: owner.id });
    await deleteCommentAction({ commentId: spammy.id, reason });
    await actAs(mod);
    expect(await restoreCommentAction({ commentId: spammy.id, reason: 'بازگردانی اشتباهی' })).toEqual({ ok: true, data: { restoredTo: 'SPAM' } });
    expect((await db.comment.findUniqueOrThrow({ where: { id: spammy.id } })).status).toBe('SPAM');
  });

  it('refuses to restore comments that are not deleted or that their own author deleted', async () => {
    const { root, video, author } = await setup();
    await expectFailure(restoreCommentAction({ commentId: root.id, reason }), 'CONFLICT');
    const mine = await createComment({ videoId: video.id, authorId: author.id });
    await applyCommentStatus(mine.id, 'DELETED', { actorId: author.id }); // "delete my comment"
    const res = await expectFailure(restoreCommentAction({ commentId: mine.id, reason }), 'CONFLICT');
    expect(res.message).toContain('خود نویسنده');
    expect((await db.comment.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe('DELETED');
  });

  it('validates input, unknown comments and mismatching reports', async () => {
    const { root, reply, report } = await setup();
    await expectFailure(deleteCommentAction({ commentId: root.id, reason: '' }), 'VALIDATION');
    await expectFailure(deleteCommentAction({ commentId: 'k'.repeat(25), reason }), 'NOT_FOUND');
    await expectFailure(deleteCommentAction({ commentId: root.id, reason, reportId: report.id }), 'BAD_REQUEST'); // report is about `reply`
    expect((await db.comment.findUniqueOrThrow({ where: { id: reply.id } })).status).toBe('APPROVED');
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('applies the target rules to the comment’s author', async () => {
    const mod = await moderator();
    const admin = await administrator();
    const { video } = await creatorWithVideo();
    const byAdmin = await createComment({ videoId: video.id, authorId: admin.id });
    const byMod = await createComment({ videoId: video.id, authorId: mod.id });
    await actAs(mod);
    expect(await deleteCommentAction({ commentId: byAdmin.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await deleteCommentAction({ commentId: byMod.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' }); // own comment
    await actAs(admin);
    expect((await deleteCommentAction({ commentId: byMod.id, reason })).ok).toBe(true);
    expect(await deleteCommentAction({ commentId: byAdmin.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' }); // own comment
    expect(await db.moderationAction.count()).toBe(1);
  });
});

describe('blocking commenters', () => {
  async function setup() {
    const mod = await moderator();
    const { owner, channel, video } = await creatorWithVideo();
    const spammer = await plainUser('هرزنویس');
    const comment = await createComment({ videoId: video.id, authorId: spammer.id });
    const report = await createReport({ reporterId: (await plainUser()).id, comment });
    await actAs(mod);
    return { mod, owner, channel, video, spammer, comment, report };
  }

  it('blocks (audit row, notification) and unblocks, linking the report without closing it', async () => {
    const { mod, channel, spammer, report } = await setup();
    expect((await blockCommenterAction({ channelId: channel.id, userId: spammer.id, reason, reportId: report.id })).ok).toBe(true);
    expect(await db.channelBlock.findUnique({ where: { channelId_userId: { channelId: channel.id, userId: spammer.id } } })).toMatchObject({ reason });
    expect((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('OPEN');

    const [row] = await auditRows();
    expect(row).toMatchObject({ type: 'CHANNEL_USER_BLOCK', actorId: mod.id, channelId: channel.id, targetUserId: spammer.id, reportId: report.id, reason });
    expect((await notificationsOf(spammer.id))[0]).toMatchObject({ type: 'MODERATION' });

    await expectFailure(blockCommenterAction({ channelId: channel.id, userId: spammer.id, reason }), 'CONFLICT');

    expect((await unblockCommenterAction({ channelId: channel.id, userId: spammer.id, reason: 'اشتباه بود' })).ok).toBe(true);
    expect(await db.channelBlock.count()).toBe(0);
    expect((await auditRows()).map((r) => r.type)).toEqual(['CHANNEL_USER_BLOCK', 'CHANNEL_USER_UNBLOCK']);
    await expectFailure(unblockCommenterAction({ channelId: channel.id, userId: spammer.id, reason }), 'CONFLICT');
  });

  it('cannot block the channel owner, administrators (as a moderator) or with a foreign report', async () => {
    const { owner, channel, spammer, report } = await setup();
    await expectFailure(blockCommenterAction({ channelId: channel.id, userId: owner.id, reason }), 'BAD_REQUEST');
    const admin = await administrator();
    await expectFailure(blockCommenterAction({ channelId: channel.id, userId: admin.id, reason }), 'FORBIDDEN');
    const elsewhere = await creator();
    await expectFailure(blockCommenterAction({ channelId: elsewhere.channel!.id, userId: spammer.id, reason, reportId: report.id }), 'BAD_REQUEST');
    expect(await db.channelBlock.count()).toBe(0);
    expect(await db.moderationAction.count()).toBe(0);
  });
});

describe('suspending and restoring channels', () => {
  async function setup() {
    const mod = await moderator();
    const { owner, channel, video } = await creatorWithVideo();
    const reporter = await plainUser();
    const channelReport = await createReport({ reporterId: reporter.id, channel });
    const videoReport = await createReport({ reporterId: (await plainUser()).id, video });
    await actAs(mod);
    return { mod, owner, channel, video, channelReport, videoReport };
  }

  const access = async (videoId: string): Promise<VideoAccessInfo> => {
    const row = await db.video.findUniqueOrThrow({ where: { id: videoId }, include: { channel: { select: { suspendedAt: true } } } });
    return { ...row, channelSuspendedAt: row.channel.suspendedAt };
  };

  it('hides the channel’s videos from the public, closes the reports and notifies the owner', async () => {
    const { mod, owner, channel, video, channelReport, videoReport } = await setup();
    const outsider = await plainUser();
    expect(await db.video.count({ where: publicVideoWhere })).toBe(1);

    const res = await suspendChannelAction({ channelId: channel.id, reason, reportId: videoReport.id });
    expect(res).toMatchObject({ ok: true, data: { resolvedReportIds: expect.arrayContaining([videoReport.id, channelReport.id]) } });

    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).suspendedAt).toBeInstanceOf(Date);
    expect(await db.video.count({ where: publicVideoWhere })).toBe(0);
    expect(await db.video.count({ where: linkableVideoWhere })).toBe(0);
    expect(canViewVideo(null, await access(video.id))).toBe(false);
    expect(canViewVideo({ id: outsider.id, role: 'USER' }, await access(video.id))).toBe(false);
    expect(canViewVideo({ id: owner.id, role: 'CREATOR', channelId: channel.id }, await access(video.id))).toBe(true);
    expect(canViewVideo({ id: mod.id, role: 'MODERATOR' }, await access(video.id))).toBe(true);

    for (const id of [channelReport.id, videoReport.id]) {
      expect(await db.report.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'ACTIONED', handledById: mod.id });
    }
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'CHANNEL_SUSPEND', actorId: mod.id, channelId: channel.id, targetUserId: owner.id, reportId: videoReport.id, reason });
    const [note] = await notificationsOf(owner.id);
    expect(note).toMatchObject({ type: 'MODERATION', channelId: channel.id });
    expect(note!.body).toContain(reason);
    await expectFailure(suspendChannelAction({ channelId: channel.id, reason }), 'CONFLICT');
  });

  it('restoring brings the channel and its videos back', async () => {
    const { channel, video } = await setup();
    await suspendChannelAction({ channelId: channel.id, reason });
    await expectFailure(restoreChannelAction({ channelId: channel.id, reason: '' }), 'VALIDATION');
    expect((await restoreChannelAction({ channelId: channel.id, reason: 'استیناف پذیرفته شد' })).ok).toBe(true);
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).suspendedAt).toBeNull();
    expect(await db.video.count({ where: publicVideoWhere })).toBe(1);
    expect(canViewVideo(null, await access(video.id))).toBe(true);
    expect((await auditRows()).map((r) => r.type)).toEqual(['CHANNEL_SUSPEND', 'CHANNEL_RESTORE']);
    await expectFailure(restoreChannelAction({ channelId: channel.id, reason }), 'CONFLICT');
  });

  it('a moderator can neither suspend an administrator’s channel nor their own', async () => {
    const mod = await moderator();
    const admin = await administrator();
    const adminChannel = await db.channel.create({ data: { ownerId: admin.id, handle: 'admin-ch', name: 'کانال مدیر', searchName: 'admin' } });
    const ownChannel = await db.channel.create({ data: { ownerId: mod.id, handle: 'mod-ch', name: 'کانال ناظر', searchName: 'mod' } });
    await actAs(mod);
    expect(await suspendChannelAction({ channelId: adminChannel.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await suspendChannelAction({ channelId: ownChannel.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await db.channel.count({ where: { suspendedAt: { not: null } } })).toBe(0);
    expect(await db.moderationAction.count()).toBe(0);
  });
});

describe('verifying channels directly', () => {
  it('grants and removes the badge with audit rows and VERIFICATION_UPDATE notifications', async () => {
    const mod = await moderator();
    const { owner, channel } = await creatorWithVideo();
    await actAs(mod);

    expect((await verifyChannelAction({ channelId: channel.id, note: 'هویت کانال تأیید شد' })).ok).toBe(true);
    expect(await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({ isVerified: true, verifiedAt: expect.any(Date) });
    await expectFailure(verifyChannelAction({ channelId: channel.id }), 'CONFLICT');

    await expectFailure(unverifyChannelAction({ channelId: channel.id, reason: '' }), 'VALIDATION');
    expect((await unverifyChannelAction({ channelId: channel.id, reason: 'نقض شرایط تیک تأیید' })).ok).toBe(true);
    expect(await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({ isVerified: false, verifiedAt: null });
    await expectFailure(unverifyChannelAction({ channelId: channel.id, reason }), 'CONFLICT');

    const rows = await auditRows();
    expect(rows.map((r) => r.type)).toEqual(['CHANNEL_VERIFY', 'CHANNEL_UNVERIFY']);
    expect(rows[0]).toMatchObject({ actorId: mod.id, channelId: channel.id, targetUserId: owner.id, reason: 'هویت کانال تأیید شد' });
    expect((await notificationsOf(owner.id)).map((n) => n.type)).toEqual(['VERIFICATION_UPDATE', 'VERIFICATION_UPDATE']);
  });

  it('a suspended channel cannot be verified', async () => {
    const mod = await moderator();
    const { channel } = await creatorWithVideo();
    await db.channel.update({ where: { id: channel.id }, data: { suspendedAt: new Date() } });
    await actAs(mod);
    await expectFailure(verifyChannelAction({ channelId: channel.id }), 'CONFLICT');
  });
});

describe('force-deleting a video (administrators only)', () => {
  it('removes the rows, keeps an audit row that explains it, queues the storage cleanup and tells the owner', async () => {
    const admin = await administrator();
    const { owner, channel, video } = await creatorWithVideo();
    const commenter = await plainUser();
    await createComment({ videoId: video.id, authorId: commenter.id });
    const report = await createReport({ reporterId: commenter.id, video });
    await db.notification.create({ data: { userId: owner.id, type: 'VIDEO_LIKED', title: 'x', videoId: video.id } });
    await actAs(admin);

    const res = await deleteVideoAction({ videoId: video.id, reason: 'نقض شدید حق تکثیر' });
    expect(res).toEqual({ ok: true, data: { cleanupQueued: true } });

    expect(await db.video.count({ where: { id: video.id } })).toBe(0);
    expect(await db.comment.count()).toBe(0); // cascade
    expect(await db.report.count({ where: { id: report.id } })).toBe(0); // cascade
    expect(enqueueVideoCleanup).toHaveBeenCalledTimes(1);
    expect(enqueueVideoCleanup).toHaveBeenCalledWith(video.id);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'VIDEO_DELETE', actorId: admin.id, channelId: channel.id, targetUserId: owner.id, reason: 'نقض شدید حق تکثیر', videoId: null });
    expect(rows[0]!.meta).toMatchObject({ videoId: video.id, videoTitle: 'ویدیوی آزمایشی', deletedReports: 1 });
    const mine = (await notificationsOf(owner.id)).filter((n) => n.type === 'MODERATION');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).toContain('ویدیوی آزمایشی');
    expect(mine[0]!.videoId).toBeNull();
  });

  it('moderators and anybody else cannot, and a refusal deletes nothing', async () => {
    const { video } = await creatorWithVideo();
    for (const actor of [await moderator(), await creator(), await plainUser()]) {
      await actAs(actor);
      expect(await deleteVideoAction({ videoId: video.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }
    logout();
    expect(await deleteVideoAction({ videoId: video.id, reason })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await db.video.count({ where: { id: video.id } })).toBe(1);
    expect(enqueueVideoCleanup).not.toHaveBeenCalled();
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('an administrator cannot delete their own video, requires a reason, and unknown videos are 404', async () => {
    const admin = await administrator();
    const channel = await db.channel.create({ data: { ownerId: admin.id, handle: 'adm', name: 'کانال مدیر', searchName: 'adm' } });
    const own = await createVideo(channel.id);
    await actAs(admin);
    await expectFailure(deleteVideoAction({ videoId: own.id, reason }), 'FORBIDDEN');
    const { video } = await creatorWithVideo();
    await expectFailure(deleteVideoAction({ videoId: video.id, reason: '' }), 'VALIDATION');
    await expectFailure(deleteVideoAction({ videoId: 'aaaaaaaaaaa', reason }), 'NOT_FOUND');
    expect(await db.video.count()).toBe(2);
  });

  it('still succeeds (and says so) when the cleanup job cannot be queued', async () => {
    vi.mocked(enqueueVideoCleanup).mockRejectedValueOnce(new Error('redis down'));
    const admin = await administrator();
    const { video } = await creatorWithVideo();
    await actAs(admin);
    expect(await deleteVideoAction({ videoId: video.id, reason })).toEqual({ ok: true, data: { cleanupQueued: false } });
    expect(await db.video.count({ where: { id: video.id } })).toBe(0);
  });
});
