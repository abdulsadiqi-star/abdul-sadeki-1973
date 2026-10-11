import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getReportedCommentIds, reportComment, reportVideo } from '@/features/reports/service';
import { reportCommentAction, reportVideoAction } from '@/features/reports/actions';
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
  const owner = await createUser({ withChannel: true });
  const reporter = await createUser({ displayName: 'گزارش‌دهنده' });
  const author = await createUser({ displayName: 'نویسنده' });
  const video = await createVideo(owner.channel!.id);
  const comment = await db.comment.create({ data: { videoId: video.id, authorId: author.id, body: 'یک دیدگاه نامناسب', status: 'APPROVED' } });
  return { owner, reporter, author, video, comment };
}

describe('reporting a video', () => {
  it('creates an OPEN report with the reason and the cleaned details', async () => {
    const { reporter, video } = await setup();
    const { id } = await reportVideo(viewerOf(reporter), video.id, { reason: 'COPYRIGHT', details: '  این ویدیو از من است  \n\n\n\n  ' });
    const report = await db.report.findUniqueOrThrow({ where: { id } });
    expect(report).toMatchObject({
      reporterId: reporter.id,
      targetType: 'VIDEO',
      videoId: video.id,
      commentId: null,
      reason: 'COPYRIGHT',
      details: 'این ویدیو از من است',
      status: 'OPEN',
    });
  });

  it('stores no details when they are blank or only invisible characters', async () => {
    const { reporter, video } = await setup();
    const { id } = await reportVideo(viewerOf(reporter), video.id, { reason: 'SPAM', details: ' ‌ ' });
    expect((await db.report.findUniqueOrThrow({ where: { id } })).details).toBeNull();
  });

  it('allows one report per reporter and video', async () => {
    const { reporter, video } = await setup();
    await reportVideo(viewerOf(reporter), video.id, { reason: 'SPAM' });
    await expect(reportVideo(viewerOf(reporter), video.id, { reason: 'ABUSE' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const second = await createUser();
    await expect(reportVideo(viewerOf(second), video.id, { reason: 'ABUSE' })).resolves.toBeTruthy();
    expect(await db.report.count()).toBe(2);
  });

  it('limits the details to 500 characters', async () => {
    const { reporter, video } = await setup();
    const long = Array.from({ length: 501 }, (_, i) => String.fromCharCode(0x0627 + (i % 20))).join('');
    await expect(reportVideo(viewerOf(reporter), video.id, { reason: 'OTHER', details: long })).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { details: expect.any(Array) } });
    const exact = long.slice(0, 500);
    await expect(reportVideo(viewerOf(reporter), video.id, { reason: 'OTHER', details: exact })).resolves.toBeTruthy();
  });

  it('refuses to report your own video and hides videos the reporter cannot see', async () => {
    const { owner, reporter, video } = await setup();
    await expect(reportVideo(viewerOf(owner), video.id, { reason: 'SPAM' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const state of ['private', 'draft', 'takedown'] as const) {
      const hidden = await createVideo(owner.channel!.id, { state });
      await expect(reportVideo(viewerOf(reporter), hidden.id, { reason: 'SPAM' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(reportVideo(viewerOf(reporter), 'aB3dE5gH7jK', { reason: 'SPAM' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.report.count()).toBe(0);
  });
});

describe('reporting a comment', () => {
  it('creates the report, increments the comment counter and leaves videoId empty', async () => {
    const { reporter, comment } = await setup();
    const { id } = await reportComment(viewerOf(reporter), comment.id, { reason: 'ABUSE', details: 'توهین به کاربران' });
    expect(await db.report.findUniqueOrThrow({ where: { id } })).toMatchObject({ targetType: 'COMMENT', commentId: comment.id, videoId: null, reason: 'ABUSE', status: 'OPEN' });
    expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).reportCount).toBe(1);

    const another = await createUser();
    await reportComment(viewerOf(another), comment.id, { reason: 'SPAM' });
    expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).reportCount).toBe(2);
  });

  it('allows one report per reporter and comment and does not count duplicates', async () => {
    const { reporter, comment } = await setup();
    await reportComment(viewerOf(reporter), comment.id, { reason: 'SPAM' });
    await expect(reportComment(viewerOf(reporter), comment.id, { reason: 'ABUSE' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).reportCount).toBe(1);
  });

  it('lets one person report both a video and several of its comments', async () => {
    const { reporter, author, video, comment } = await setup();
    const second = await db.comment.create({ data: { videoId: video.id, authorId: author.id, body: 'دیدگاه دوم', status: 'APPROVED' } });
    await reportVideo(viewerOf(reporter), video.id, { reason: 'SPAM' });
    await reportComment(viewerOf(reporter), comment.id, { reason: 'SPAM' });
    await reportComment(viewerOf(reporter), second.id, { reason: 'SPAM' });
    expect(await db.report.count()).toBe(3);
  });

  it('only reports public comments of visible videos, never your own', async () => {
    const { owner, reporter, author, video, comment } = await setup();
    await expect(reportComment(viewerOf(author), comment.id, { reason: 'SPAM' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const status of ['PENDING', 'REJECTED', 'SPAM', 'DELETED'] as const) {
      const c = await db.comment.create({ data: { videoId: video.id, authorId: author.id, body: `دیدگاه ${status}`, status } });
      await expect(reportComment(viewerOf(reporter), c.id, { reason: 'SPAM' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await db.video.update({ where: { id: video.id }, data: { visibility: 'PRIVATE' } });
    await expect(reportComment(viewerOf(reporter), comment.id, { reason: 'SPAM' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(reportComment(viewerOf(owner), comment.id, { reason: 'SPAM' })).resolves.toBeTruthy(); // the creator may report spam on their own video
    await expect(reportComment(viewerOf(reporter), 'cknonexistent0000000000000', { reason: 'SPAM' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('tells which comments a user already reported', async () => {
    const { reporter, author, video, comment } = await setup();
    const other = await db.comment.create({ data: { videoId: video.id, authorId: author.id, body: 'دیگری', status: 'APPROVED' } });
    await reportComment(viewerOf(reporter), comment.id, { reason: 'SPAM' });
    expect([...(await getReportedCommentIds(reporter.id, [comment.id, other.id]))]).toEqual([comment.id]);
    expect((await getReportedCommentIds(null, [comment.id])).size).toBe(0);
    expect((await getReportedCommentIds(reporter.id, [])).size).toBe(0);
  });
});

describe('report actions', () => {
  it('need a signed-in, verified user and valid input', async () => {
    const { reporter, video, comment } = await setup();
    logout();
    expect(await reportVideoAction({ videoId: video.id, reason: 'SPAM' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await reportCommentAction({ commentId: comment.id, reason: 'SPAM' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });

    const unverified = await createUser({ verified: false });
    await loginAs(unverified.id);
    expect(await reportVideoAction({ videoId: video.id, reason: 'SPAM' })).toMatchObject({ ok: false, code: 'EMAIL_NOT_VERIFIED' });

    await loginAs(reporter.id);
    expect(await reportVideoAction({ videoId: 'bad', reason: 'SPAM' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await reportVideoAction({ videoId: video.id, reason: 'NOT_A_REASON' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await reportVideoAction({ videoId: video.id, reason: 'SPAM', details: 'x'.repeat(5000) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await reportCommentAction({ commentId: 'x', reason: 'SPAM' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await db.report.count()).toBe(0);
  });

  it('work end to end and tell duplicates apart', async () => {
    const { reporter, video, comment } = await setup();
    await loginAs(reporter.id);
    expect(await reportVideoAction({ videoId: video.id, reason: 'MISINFORMATION', details: 'ادعای نادرست' })).toEqual({ ok: true, data: undefined });
    expect(await reportVideoAction({ videoId: video.id, reason: 'MISINFORMATION' })).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await reportCommentAction({ commentId: comment.id, reason: 'HATE' })).toEqual({ ok: true, data: undefined });
    expect(await db.report.count()).toBe(2);
  });

  it('are rate limited (10 per hour per user)', async () => {
    const { owner, reporter } = await setup();
    await loginAs(reporter.id);
    const results = [];
    for (let i = 0; i < 12; i++) {
      const v = await createVideo(owner.channel!.id);
      results.push(await reportVideoAction({ videoId: v.id, reason: 'SPAM' }));
    }
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results.slice(10).map((r) => (r.ok ? 'ok' : r.code))).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
  });
});
