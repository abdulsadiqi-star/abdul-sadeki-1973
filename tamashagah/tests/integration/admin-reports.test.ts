import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { canViewVideo, type VideoAccessInfo } from '@/lib/permissions';
import { publicVideoWhere } from '@/features/videos/visibility';
import { getRelatedVideos, getTrendingVideos } from '@/features/recommendations';
import { dismissReportAction, startReportReviewAction, warnCreatorAction } from '@/features/admin/actions/reports';
import { restoreVideoAction, takedownVideoAction } from '@/features/admin/actions/content';
import { takedownVideo } from '@/features/moderation/content';
import {
  actAs,
  administrator,
  auditRows,
  createComment,
  createReport,
  creatorWithVideo,
  createVideo,
  expectFailure,
  logout,
  moderator,
  notificationsOf,
  plainUser,
} from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

const reason = 'محتوای نامناسب و خلاف قوانین سایت';

async function scenario() {
  const mod = await moderator();
  const { owner, channel, video } = await creatorWithVideo();
  const reporters = await Promise.all([plainUser(), plainUser(), plainUser()]);
  const r1 = await createReport({ reporterId: reporters[0]!.id, video, reason: 'SPAM' });
  const r2 = await createReport({ reporterId: reporters[1]!.id, video, reason: 'ABUSE', status: 'REVIEWING' });
  const other = await createVideo(channel.id, { title: 'ویدیوی دیگر' });
  const r3 = await createReport({ reporterId: reporters[2]!.id, video: other });
  await actAs(mod);
  return { mod, owner, channel, video, other, r1, r2, r3, reporters };
}

const statusOf = async (id: string) => (await db.report.findUniqueOrThrow({ where: { id } })).status;

beforeEach(() => logout());

describe('report workflow: opening a report', () => {
  it('moves OPEN → REVIEWING once, never touches decided reports and writes no audit row', async () => {
    const { r1, r2 } = await scenario();
    expect(await startReportReviewAction({ id: r1.id })).toEqual({ ok: true, data: { changed: true } });
    expect(await statusOf(r1.id)).toBe('REVIEWING');
    expect(await startReportReviewAction({ id: r1.id })).toEqual({ ok: true, data: { changed: false } });
    await db.report.update({ where: { id: r2.id }, data: { status: 'DISMISSED' } });
    expect(await startReportReviewAction({ id: r2.id })).toEqual({ ok: true, data: { changed: false } });
    expect(await statusOf(r2.id)).toBe('DISMISSED');
    expect(await db.moderationAction.count()).toBe(0);
  });
});

describe('dismissing reports', () => {
  it('records the decision on the report, writes exactly one audit row and resolves the other open reports of the same target', async () => {
    const { mod, video, r1, r2, r3, owner } = await scenario();
    const res = await dismissReportAction({ reportId: r1.id, reason });
    expect(res).toMatchObject({ ok: true, data: { resolvedReportIds: expect.arrayContaining([r1.id, r2.id]) } });

    const closed = await db.report.findMany({ where: { id: { in: [r1.id, r2.id] } } });
    for (const r of closed) {
      expect(r).toMatchObject({ status: 'DISMISSED', handledById: mod.id });
      expect(r.handledAt).toBeInstanceOf(Date);
      expect(r.resolution).toContain(reason);
    }
    expect(await statusOf(r3.id)).toBe('OPEN'); // another video: untouched

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'REPORT_DISMISS', actorId: mod.id, videoId: video.id, reportId: r1.id, reason, targetUserId: owner.id });
    expect(rows[0]!.meta).toMatchObject({ targetType: 'VIDEO', resolvedReportIds: expect.arrayContaining([r1.id, r2.id]) });
    expect(await notificationsOf(owner.id)).toHaveLength(0); // a dismissal tells the creator nothing
  });

  it('can resolve just the one report', async () => {
    const { r1, r2 } = await scenario();
    await dismissReportAction({ reportId: r1.id, reason, resolveAll: false });
    expect(await statusOf(r1.id)).toBe('DISMISSED');
    expect(await statusOf(r2.id)).toBe('REVIEWING');
    expect((await auditRows())[0]!.meta).toMatchObject({ resolvedReportIds: [r1.id] });
  });

  it('decisions are final: a decided report cannot be decided again (state machine)', async () => {
    const { r1 } = await scenario();
    expect((await dismissReportAction({ reportId: r1.id, reason, resolveAll: false })).ok).toBe(true);
    await expectFailure(dismissReportAction({ reportId: r1.id, reason }), 'CONFLICT');
    await expectFailure(warnCreatorAction({ reportId: r1.id, reason }), 'CONFLICT');
    expect(await db.moderationAction.count()).toBe(1);
  });

  it('requires a reason of 3–500 characters and a real report', async () => {
    const { r1 } = await scenario();
    const empty = await expectFailure(dismissReportAction({ reportId: r1.id, reason: '' }), 'VALIDATION');
    expect(empty).toMatchObject({ ok: false });
    expect((await dismissReportAction({ reportId: r1.id, reason: 'x'.repeat(501) })).ok).toBe(false);
    expect((await dismissReportAction({ reportId: r1.id })).ok).toBe(false);
    await expectFailure(dismissReportAction({ reportId: 'z'.repeat(25), reason }), 'NOT_FOUND');
    expect(await statusOf(r1.id)).toBe('OPEN');
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('a moderator cannot decide a report about their own channel or about an administrator', async () => {
    const mod = await moderator();
    const modChannel = await db.channel.create({ data: { ownerId: mod.id, handle: 'mod-channel', name: 'کانال ناظر', searchName: 'mod' } });
    const ownVideo = await createVideo(modChannel.id);
    const adminUser = await administrator();
    const adminChannel = await db.channel.create({ data: { ownerId: adminUser.id, handle: 'admin-channel', name: 'کانال مدیر', searchName: 'admin' } });
    const adminVideo = await createVideo(adminChannel.id);
    const reporter = await plainUser();
    const own = await createReport({ reporterId: reporter.id, video: ownVideo });
    const adminsReport = await createReport({ reporterId: reporter.id, video: adminVideo });

    await actAs(mod);
    expect(await dismissReportAction({ reportId: own.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await dismissReportAction({ reportId: adminsReport.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await statusOf(own.id)).toBe('OPEN');
    expect(await statusOf(adminsReport.id)).toBe('OPEN');

    // an administrator may handle the moderator's and (as a different person) another admin's reports, but not their own
    await actAs(adminUser);
    expect((await dismissReportAction({ reportId: own.id, reason })).ok).toBe(true);
    expect(await dismissReportAction({ reportId: adminsReport.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await db.moderationAction.count()).toBe(1);
  });
});

describe('taking a video down', () => {
  it('hides the video, records reason + report resolution, notifies the creator, one audit row', async () => {
    const { mod, owner, channel, video, r1, r2, r3 } = await scenario();
    const res = await takedownVideoAction({ videoId: video.id, reason, reportId: r1.id });
    expect(res).toMatchObject({ ok: true, data: { resolvedReportIds: expect.arrayContaining([r1.id, r2.id]) } });

    const row = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(row.takedownAt).toBeInstanceOf(Date);
    expect(row.takedownReason).toBe(reason);

    for (const id of [r1.id, r2.id]) {
      expect(await db.report.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'ACTIONED', handledById: mod.id });
    }
    expect((await db.report.findUniqueOrThrow({ where: { id: r1.id } })).resolution).toContain(reason);
    expect(await statusOf(r3.id)).toBe('OPEN');

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'VIDEO_TAKEDOWN', actorId: mod.id, videoId: video.id, channelId: channel.id, targetUserId: owner.id, reportId: r1.id, reason });

    const notes = await notificationsOf(owner.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'MODERATION', actorId: mod.id, videoId: video.id });
    expect(notes[0]!.body).toContain(reason);
    expect(notes[0]!.title).toContain('ویدیوی آزمایشی');
  });

  it('works without a report (from the video list) and then closes every open report on the video', async () => {
    const { video, r1, r2 } = await scenario();
    expect((await takedownVideoAction({ videoId: video.id, reason })).ok).toBe(true);
    expect(await statusOf(r1.id)).toBe('ACTIONED');
    expect(await statusOf(r2.id)).toBe('ACTIONED');
    const [row] = await auditRows();
    expect(row!.reportId).toBeNull();
    expect(row!.meta).toMatchObject({ resolvedReportIds: expect.arrayContaining([r1.id, r2.id]) });
  });

  it('can leave the other reports open', async () => {
    const { video, r1, r2 } = await scenario();
    await takedownVideoAction({ videoId: video.id, reason, reportId: r1.id, resolveAll: false });
    expect(await statusOf(r1.id)).toBe('ACTIONED');
    expect(await statusOf(r2.id)).toBe('REVIEWING');
  });

  it('cannot be done twice, and failed attempts leave no trace', async () => {
    const { video, r1 } = await scenario();
    expect((await takedownVideoAction({ videoId: video.id, reason, reportId: r1.id })).ok).toBe(true);
    await expectFailure(takedownVideoAction({ videoId: video.id, reason }), 'CONFLICT');
    expect(await db.moderationAction.count()).toBe(1);
    expect(await notificationsOf((await db.channel.findFirstOrThrow({ where: { videos: { some: { id: video.id } } } })).ownerId)).toHaveLength(1);
  });

  it('refuses a report that belongs to something else or is already decided (ids are never trusted)', async () => {
    const { video, r3, r1 } = await scenario();
    await expectFailure(takedownVideoAction({ videoId: video.id, reason, reportId: r3.id }), 'BAD_REQUEST'); // r3 is about another video
    await expectFailure(takedownVideoAction({ videoId: video.id, reason, reportId: 'q'.repeat(25) }), 'NOT_FOUND');
    await db.report.update({ where: { id: r1.id }, data: { status: 'DISMISSED' } });
    await expectFailure(takedownVideoAction({ videoId: video.id, reason, reportId: r1.id }), 'CONFLICT');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).takedownAt).toBeNull();
    expect(await db.moderationAction.count()).toBe(0);
  });

  it('unknown videos are 404, malformed ids are validation errors', async () => {
    await scenario();
    await expectFailure(takedownVideoAction({ videoId: 'aaaaaaaaaaa', reason }), 'NOT_FOUND');
    await expectFailure(takedownVideoAction({ videoId: 'bad id', reason }), 'VALIDATION');
  });

  it('respects the target rules: nobody on themselves, moderators never on administrators', async () => {
    const mod = await moderator();
    const modChannel = await db.channel.create({ data: { ownerId: mod.id, handle: 'mod-ch', name: 'کانال ناظر', searchName: 'mod' } });
    const modVideo = await createVideo(modChannel.id);
    const admin = await administrator();
    const adminChannel = await db.channel.create({ data: { ownerId: admin.id, handle: 'adm-ch', name: 'کانال مدیر', searchName: 'adm' } });
    const adminVideo = await createVideo(adminChannel.id);

    await actAs(mod);
    expect(await takedownVideoAction({ videoId: modVideo.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await takedownVideoAction({ videoId: adminVideo.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    await actAs(admin);
    expect(await takedownVideoAction({ videoId: adminVideo.id, reason })).toMatchObject({ ok: false, code: 'FORBIDDEN' }); // own
    expect((await takedownVideoAction({ videoId: modVideo.id, reason })).ok).toBe(true); // an admin may act on a moderator
    expect(await db.moderationAction.count()).toBe(1);
  });

  it('two moderators deciding at the same time: exactly one wins, exactly one audit row', async () => {
    const { video, r1, mod } = await scenario();
    const other = await moderator();
    const results = await Promise.allSettled([
      takedownVideo({ id: mod.id, role: 'MODERATOR', displayName: 'الف' }, { videoId: video.id, reason, reportId: r1.id, resolveAll: true }),
      takedownVideo({ id: other.id, role: 'MODERATOR', displayName: 'ب' }, { videoId: video.id, reason, reportId: r1.id, resolveAll: true }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await db.moderationAction.count({ where: { type: 'VIDEO_TAKEDOWN' } })).toBe(1);
  });
});

describe('restoring a video', () => {
  it('brings it back, links the audit row to the already-actioned report without re-opening it, and tells the creator', async () => {
    const { owner, video, r1, mod } = await scenario();
    await takedownVideoAction({ videoId: video.id, reason, reportId: r1.id });
    const restoreReason = 'بازبینی شد و مشکلی وجود نداشت';
    expect((await restoreVideoAction({ videoId: video.id, reason: restoreReason, reportId: r1.id })).ok).toBe(true);

    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ takedownAt: null, takedownReason: null });
    expect(await statusOf(r1.id)).toBe('ACTIONED'); // history is not rewritten

    const rows = await auditRows();
    expect(rows.map((r) => r.type)).toEqual(['VIDEO_TAKEDOWN', 'VIDEO_RESTORE']);
    expect(rows[1]).toMatchObject({ actorId: mod.id, videoId: video.id, reportId: r1.id, reason: restoreReason, targetUserId: owner.id });
    const notes = await notificationsOf(owner.id);
    expect(notes.map((n) => n.type)).toEqual(['MODERATION', 'MODERATION']);
    expect(notes[1]!.title).toContain('دوباره در دسترس');
  });

  it('is rejected for a video that is not taken down, and needs a reason', async () => {
    const { video } = await scenario();
    await expectFailure(restoreVideoAction({ videoId: video.id, reason }), 'CONFLICT');
    await takedownVideoAction({ videoId: video.id, reason });
    await expectFailure(restoreVideoAction({ videoId: video.id, reason: '' }), 'VALIDATION');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).takedownAt).not.toBeNull();
    expect(await db.moderationAction.count()).toBe(1);
  });
});

describe('warning the creator', () => {
  it('resolves the report as ACTIONED, writes a CREATOR_WARN audit row and notifies the owner with the reason', async () => {
    const { mod, owner, video, r1, r2 } = await scenario();
    const res = await warnCreatorAction({ reportId: r1.id, reason: 'لطفاً از تصاویر نامناسب استفاده نکنید' });
    expect(res.ok).toBe(true);
    expect(await statusOf(r1.id)).toBe('ACTIONED');
    expect(await statusOf(r2.id)).toBe('ACTIONED');
    expect((await db.report.findUniqueOrThrow({ where: { id: r1.id } })).resolution).toContain('هشدار');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).takedownAt).toBeNull(); // a warning hides nothing

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'CREATOR_WARN', actorId: mod.id, videoId: video.id, reportId: r1.id, targetUserId: owner.id });
    const [note] = await notificationsOf(owner.id);
    expect(note).toMatchObject({ type: 'MODERATION' });
    expect(note!.body).toContain('لطفاً از تصاویر نامناسب استفاده نکنید');
    expect(note!.body).toContain('ویدیوی آزمایشی');
  });

  it('warns the comment’s author (not the channel owner) when the report is about a comment', async () => {
    const mod = await moderator();
    const { owner, video } = await creatorWithVideo();
    const author = await plainUser('نویسنده‌ی دیدگاه');
    const comment = await createComment({ videoId: video.id, authorId: author.id });
    const report = await createReport({ reporterId: (await plainUser()).id, comment });
    await actAs(mod);
    expect((await warnCreatorAction({ reportId: report.id, reason: 'رعایت ادب در دیدگاه‌ها' })).ok).toBe(true);
    expect(await notificationsOf(author.id)).toHaveLength(1);
    expect(await notificationsOf(owner.id)).toHaveLength(0);
    expect((await auditRows())[0]).toMatchObject({ type: 'CREATOR_WARN', commentId: comment.id, targetUserId: author.id });
  });
});

describe('visibility after a take-down (canViewVideo + publicVideoWhere)', () => {
  it('vanishes for everyone except the owner and moderators — and comes back on restore', async () => {
    const mod = await moderator();
    const { owner, channel, video } = await creatorWithVideo();
    const sibling = await createVideo(channel.id, { title: 'ویدیوی همسایه' });
    const visitor = null;
    const viewer = await plainUser();

    const access = async (): Promise<VideoAccessInfo> => {
      const row = await db.video.findUniqueOrThrow({ where: { id: video.id }, include: { channel: { select: { suspendedAt: true } } } });
      return { ...row, channelSuspendedAt: row.channel.suspendedAt };
    };
    const actor = (u: { id: string; role: 'USER' | 'CREATOR' | 'MODERATOR' | 'ADMIN' }, channelId?: string) => ({ id: u.id, role: u.role, channelId: channelId ?? null });
    const listedIds = async () => (await db.video.findMany({ where: publicVideoWhere, select: { id: true } })).map((v) => v.id);

    // before
    expect(await listedIds()).toEqual(expect.arrayContaining([video.id, sibling.id]));
    expect(canViewVideo(visitor, await access())).toBe(true);

    await actAs(mod);
    expect((await takedownVideoAction({ videoId: video.id, reason })).ok).toBe(true);

    // after: public list, recommendations and the watch permission all agree
    expect(await listedIds()).not.toContain(video.id);
    expect(await listedIds()).toContain(sibling.id);
    expect((await getTrendingVideos({ limit: 50 })).map((v) => v.id)).not.toContain(video.id);
    expect((await getRelatedVideos(sibling.id, { limit: 50 })).map((v) => v.id)).not.toContain(video.id);
    expect(canViewVideo(visitor, await access())).toBe(false);
    expect(canViewVideo(actor(viewer), await access())).toBe(false);
    expect(canViewVideo(actor(owner, channel.id), await access())).toBe(true);
    expect(canViewVideo(actor(mod), await access())).toBe(true);

    await restoreVideoAction({ videoId: video.id, reason: 'بازبینی انجام شد' });
    expect(await listedIds()).toContain(video.id);
    expect(canViewVideo(visitor, await access())).toBe(true);
    expect((await getTrendingVideos({ limit: 50 })).map((v) => v.id)).toContain(video.id);
  });
});
