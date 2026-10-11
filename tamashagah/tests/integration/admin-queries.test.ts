/**
 * Read models of the staff panel: filters, pagination, visibility of the audit log, and honest numbers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { createFormatter } from '@/lib/format';
import { listActivity, getActionHistory, getRecentActivity } from '@/features/admin/queries/activity';
import { getAdminChannel, listAdminChannels } from '@/features/admin/queries/channels';
import { getNavCounts, getOverview } from '@/features/admin/queries/overview';
import { getReportDetail, getReportStatusCounts, listReports } from '@/features/admin/queries/reports';
import {
  getLiveChannelStats,
  getMonetizationDetail,
  getVerificationDetail,
  listMonetization,
  listVerification,
  parseEvidenceLinks,
  parseSnapshot,
} from '@/features/admin/queries/requests';
import { getTicketDetail, listSupportTickets } from '@/features/admin/queries/support';
import { getAdminUser, listAdminUsers } from '@/features/admin/queries/users';
import { listAdminVideos } from '@/features/admin/queries/videos';
import {
  activityListSchema,
  channelListSchema,
  monetizationListSchema,
  reportListSchema,
  supportListSchema,
  userListSchema,
  verificationListSchema,
  videoListSchema,
} from '@/features/admin/schemas';
import { takedownVideo } from '@/features/moderation/content';
import {
  administrator,
  createComment,
  createMonetizationApplication,
  createReport,
  createTicket,
  createVerificationRequest,
  createVideo,
  creator,
  creatorWithVideo,
  moderator,
  plainUser,
} from './_admin-helpers';

vi.mock('@/lib/queue', () => ({ enqueueVideoCleanup: vi.fn(async () => undefined) }));

const f = createFormatter('fa');
const asViewer = (u: { id: string; role: 'MODERATOR' | 'ADMIN' | 'USER' | 'CREATOR' }) => ({ id: u.id, role: u.role });
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

beforeEach(() => vi.clearAllMocks());

describe('audit log visibility', () => {
  async function seedAudit() {
    const admin = await administrator();
    const mod = await moderator();
    const otherMod = await moderator();
    const owner = await creator('سازنده');
    const target = await plainUser('هدف');
    const rows = [
      { actorId: admin.id, type: 'USER_ROLE_CHANGE' as const, targetUserId: target.id },
      { actorId: admin.id, type: 'USER_SUSPEND' as const, targetUserId: target.id },
      { actorId: admin.id, type: 'MONETIZATION_APPROVE' as const, channelId: owner.channel!.id },
      { actorId: otherMod.id, type: 'VIDEO_TAKEDOWN' as const },
      { actorId: otherMod.id, type: 'USER_ROLE_CHANGE' as const, targetUserId: target.id }, // (historic) admin-only type by a non-admin
      { actorId: mod.id, type: 'COMMENT_DELETE' as const },
      { actorId: owner.id, type: 'COMMENT_SPAM' as const }, // a creator moderating their own channel in the studio
      { actorId: admin.id, type: 'CHANNEL_SUSPEND' as const, channelId: owner.channel!.id },
    ];
    for (const [i, r] of rows.entries()) await db.moderationAction.create({ data: { ...r, createdAt: new Date(Date.now() - (rows.length - i) * 60_000) } });
    return { admin, mod, otherMod, owner, target };
  }

  it('administrators see everything, newest first', async () => {
    const { admin } = await seedAudit();
    const { items, pageInfo } = await listActivity(asViewer(admin), activityListSchema.parse({}), f);
    expect(pageInfo.total).toBe(8);
    expect(items[0]!.type).toBe('CHANNEL_SUSPEND');
    expect(items.at(-1)!.type).toBe('USER_ROLE_CHANGE');
  });

  it('moderators see their own rows plus content moderation — never other people’s account / money decisions', async () => {
    const { mod } = await seedAudit();
    const { items } = await listActivity(asViewer(mod), activityListSchema.parse({}), f);
    const types = items.map((i) => i.type).sort();
    expect(types).toEqual(['CHANNEL_SUSPEND', 'COMMENT_DELETE', 'COMMENT_SPAM', 'VIDEO_TAKEDOWN']);
  });

  it('a moderator keeps seeing their OWN rows even of an admin-only type', async () => {
    const { otherMod } = await seedAudit();
    const { items } = await listActivity(asViewer(otherMod), activityListSchema.parse({}), f);
    expect(items.map((i) => i.type)).toContain('USER_ROLE_CHANGE');
    expect(items.filter((i) => i.type === 'USER_ROLE_CHANGE')).toHaveLength(1);
  });

  it('filters cannot widen the scope (asking for admin-only types as a moderator returns nothing)', async () => {
    const { mod } = await seedAudit();
    const res = await listActivity(asViewer(mod), activityListSchema.parse({ type: 'USER_SUSPEND' }), f);
    expect(res.items).toHaveLength(0);
    const byActor = await listActivity(asViewer(mod), activityListSchema.parse({ actor: 'آزمایشی' }), f);
    expect(byActor.items.every((i) => i.type !== 'USER_SUSPEND' && i.type !== 'MONETIZATION_APPROVE')).toBe(true);
  });

  it('non-staff roles see nothing at all', async () => {
    await seedAudit();
    for (const u of [await plainUser(), await creator()]) {
      expect((await listActivity(asViewer(u), activityListSchema.parse({}), f)).items).toEqual([]);
      expect(await getRecentActivity(asViewer(u), f)).toEqual([]);
      expect(await getActionHistory(asViewer(u), {}, f)).toEqual([]);
    }
  });

  it('describes rows in Persian with the actor, target and reason', async () => {
    const admin = await administrator();
    const user = await plainUser('سارا');
    await db.moderationAction.create({ data: { actorId: admin.id, type: 'USER_ROLE_CHANGE', targetUserId: user.id, reason: 'ارتقا', meta: { from: 'USER', to: 'MODERATOR' } } });
    const [item] = (await listActivity(asViewer(admin), activityListSchema.parse({}), f)).items;
    expect(item!.sentence.text).toBe('مدیر آزمایشی نقش «سارا» را از «کاربر» به «ناظر» تغییر داد');
    expect(item!.reason).toBe('ارتقا');
    expect(item!.links.map((l) => l.kind)).toContain('user');
  });

  it('filters by actor, type, target and the Tehran calendar day', async () => {
    const admin = await administrator();
    const mod = await moderator();
    const { video, channel, owner } = await creatorWithVideo();
    const sooner = new Date('2026-10-10T20:25:00Z'); // 23:55 on 10 Oct in Tehran
    const later = new Date('2026-10-10T20:35:00Z'); // 00:05 on 11 Oct in Tehran
    await db.moderationAction.create({ data: { actorId: mod.id, type: 'VIDEO_TAKEDOWN', videoId: video.id, channelId: channel.id, targetUserId: owner.id, createdAt: sooner } });
    await db.moderationAction.create({ data: { actorId: admin.id, type: 'CHANNEL_SUSPEND', channelId: channel.id, targetUserId: owner.id, createdAt: later } });
    const run = async (filters: object) => (await listActivity(asViewer(admin), activityListSchema.parse(filters), f)).items.map((i) => i.type);

    expect(await run({ from: '2026-10-11', to: '2026-10-11' })).toEqual(['CHANNEL_SUSPEND']);
    expect(await run({ from: '2026-10-10', to: '2026-10-10' })).toEqual(['VIDEO_TAKEDOWN']);
    expect(await run({ from: '2026-10-10', to: '2026-10-11' })).toEqual(['CHANNEL_SUSPEND', 'VIDEO_TAKEDOWN']);
    expect(await run({ to: '2026-10-09' })).toEqual([]);
    expect(await run({ type: 'CHANNEL_SUSPEND' })).toEqual(['CHANNEL_SUSPEND']);
    expect(await run({ actor: mod.displayName })).toEqual(['VIDEO_TAKEDOWN']);
    expect(await run({ actor: admin.email.toUpperCase() })).toEqual(['CHANNEL_SUSPEND']);
    expect(await run({ target: video.id })).toEqual(['VIDEO_TAKEDOWN']);
    expect(await run({ target: channel.handle })).toEqual(['CHANNEL_SUSPEND', 'VIDEO_TAKEDOWN']);
    expect(await run({ target: owner.email })).toEqual(['CHANNEL_SUSPEND', 'VIDEO_TAKEDOWN']);
    expect(await run({ target: 'چیزی که وجود ندارد' })).toEqual([]);
  });

  it('paginates (20 per page) with a clamped page number', async () => {
    const admin = await administrator();
    await db.moderationAction.createMany({ data: Array.from({ length: 45 }, (_, i) => ({ actorId: admin.id, type: 'TICKET_CLOSE' as const, createdAt: new Date(Date.now() - i * 1000) })) });
    const p1 = await listActivity(asViewer(admin), activityListSchema.parse({}), f);
    expect(p1.items).toHaveLength(20);
    expect(p1.pageInfo).toMatchObject({ page: 1, pageCount: 3, total: 45 });
    const p3 = await listActivity(asViewer(admin), activityListSchema.parse({ page: '3' }), f);
    expect(p3.items).toHaveLength(5);
    const beyond = await listActivity(asViewer(admin), activityListSchema.parse({ page: '99' }), f);
    expect(beyond.pageInfo.page).toBe(3);
    const ids = new Set([...p1.items, ...(await listActivity(asViewer(admin), activityListSchema.parse({ page: '2' }), f)).items, ...p3.items].map((i) => i.id));
    expect(ids.size).toBe(45); // total order: no row twice, none missing
  });

  it('survives rows whose video was force-deleted (title comes from the metadata)', async () => {
    const admin = await administrator();
    await db.moderationAction.create({ data: { actorId: admin.id, type: 'VIDEO_DELETE', reason: 'حق تکثیر', meta: { videoId: 'x', videoTitle: 'ویدیوی حذف‌شده' } } });
    const [item] = (await listActivity(asViewer(admin), activityListSchema.parse({}), f)).items;
    expect(item!.sentence.predicate).toContain('«ویدیوی حذف‌شده»');
  });
});

describe('report queue', () => {
  async function seedQueue() {
    const { owner, channel, video } = await creatorWithVideo();
    const other = await createVideo(channel.id, { title: 'ویدیوی دوم' });
    const people = await Promise.all([plainUser(), plainUser(), plainUser(), plainUser()]);
    const comment = await createComment({ videoId: video.id, authorId: people[0]!.id, body: 'دیدگاه گزارش‌شده' });
    const reports = {
      v1: await createReport({ reporterId: people[0]!.id, video, reason: 'SPAM' }),
      v2: await createReport({ reporterId: people[1]!.id, video, reason: 'ABUSE', status: 'REVIEWING' }),
      v3: await createReport({ reporterId: people[2]!.id, video: other, reason: 'SPAM', status: 'ACTIONED' }),
      c1: await createReport({ reporterId: people[1]!.id, comment, reason: 'HATE' }),
      ch: await createReport({ reporterId: people[3]!.id, channel, reason: 'COPYRIGHT', status: 'DISMISSED' }),
    };
    await db.report.update({ where: { id: reports.v1.id }, data: { createdAt: ago(10) } });
    await db.report.update({ where: { id: reports.v2.id }, data: { createdAt: ago(3) } });
    await db.report.update({ where: { id: reports.c1.id }, data: { createdAt: ago(0.2) } });
    return { owner, channel, video, other, comment, reports, people };
  }

  const ids = async (filters: object) => (await listReports(reportListSchema.parse(filters))).items.map((i) => i.id);

  it('shows the working queue (open + reviewing) oldest first by default', async () => {
    const { reports } = await seedQueue();
    expect(await ids({})).toEqual([reports.v1.id, reports.v2.id, reports.c1.id]);
    expect(await ids({ sort: 'newest' })).toEqual([reports.c1.id, reports.v2.id, reports.v1.id]);
  });

  it('filters by status, target type, reason and age', async () => {
    const { reports } = await seedQueue();
    expect(await ids({ status: 'ALL', sort: 'newest' })).toHaveLength(5);
    expect(await ids({ status: 'ACTIONED' })).toEqual([reports.v3.id]);
    expect(await ids({ status: 'DISMISSED' })).toEqual([reports.ch.id]);
    expect(await ids({ status: 'OPEN' })).toEqual([reports.v1.id, reports.c1.id]);
    expect(await ids({ status: 'REVIEWING' })).toEqual([reports.v2.id]);
    expect(await ids({ status: 'ALL', target: 'COMMENT' })).toEqual([reports.c1.id]);
    expect(await ids({ status: 'ALL', target: 'CHANNEL' })).toEqual([reports.ch.id]);
    expect(await ids({ reason: 'ABUSE' })).toEqual([reports.v2.id]);
    expect(await ids({ age: 'DAY' })).toEqual([reports.c1.id]);
    expect(await ids({ age: 'WEEK' })).toEqual([reports.v2.id, reports.c1.id]);
    expect(await ids({ age: 'OLDER' })).toEqual([reports.v1.id]);
    expect(await ids({ target: 'VIDEO', reason: 'SPAM', age: 'OLDER' })).toEqual([reports.v1.id]);
  });

  it('counts the open reports of each target without per-row queries and previews the target', async () => {
    const { reports, video, comment } = await seedQueue();
    const { items } = await listReports(reportListSchema.parse({ status: 'ALL' }));
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId[reports.v1.id]!.openOnTarget).toBe(2);
    expect(byId[reports.v2.id]!.openOnTarget).toBe(2);
    expect(byId[reports.c1.id]!.openOnTarget).toBe(1);
    expect(byId[reports.v1.id]!.target).toMatchObject({ type: 'VIDEO', id: video.id, title: 'ویدیوی آزمایشی', takenDown: false });
    expect(byId[reports.c1.id]!.target).toMatchObject({ type: 'COMMENT', id: comment.id, excerpt: 'دیدگاه گزارش‌شده' });
    expect(byId[reports.ch.id]!.target).toMatchObject({ type: 'CHANNEL', suspended: false });
  });

  it('counts per status for the filter header', async () => {
    await seedQueue();
    expect(await getReportStatusCounts()).toEqual({ OPEN: 2, REVIEWING: 1, ACTIONED: 1, DISMISSED: 1, PENDING: 3, ALL: 5 });
  });

  it('paginates the queue', async () => {
    const { video, channel } = await creatorWithVideo();
    for (let i = 0; i < 23; i++) await createReport({ reporterId: (await plainUser()).id, video: i % 2 ? video : await createVideo(channel.id) });
    const first = await listReports(reportListSchema.parse({}));
    expect(first.items).toHaveLength(20);
    expect(first.pageInfo).toMatchObject({ pageCount: 2, total: 23 });
    expect((await listReports(reportListSchema.parse({ page: '2' }))).items).toHaveLength(3);
  });

  it('detail: target preview, reporter, other reports on the same target, previous actions', async () => {
    const { reports, video, owner, channel } = await seedQueue();
    const mod = await moderator();
    await takedownVideo({ id: mod.id, role: 'MODERATOR', displayName: mod.displayName }, { videoId: video.id, reason: 'نقض قانون', resolveAll: false });
    const detail = await getReportDetail(reports.v1.id, asViewer(mod), f);
    expect(detail).not.toBeNull();
    expect(detail!.report).toMatchObject({ id: reports.v1.id, status: 'OPEN', reason: 'SPAM', targetType: 'VIDEO' });
    expect(detail!.target).toMatchObject({ type: 'VIDEO', id: video.id, title: 'ویدیوی آزمایشی', takedownReason: 'نقض قانون' });
    const videoTarget = detail!.target;
    expect(videoTarget?.type === 'VIDEO' && videoTarget.channel.id).toBe(channel.id);
    expect(detail!.owner).toMatchObject({ id: owner.id, role: 'CREATOR' });
    expect(detail!.others.map((o) => o.id)).toEqual([reports.v2.id]); // same video, not itself
    expect(detail!.history.map((h) => h.type)).toEqual(['VIDEO_TAKEDOWN']);
  });

  it('detail of a comment report shows the neighbouring comments of the thread and the block state', async () => {
    const { video, channel, people } = await seedQueue();
    const root = await createComment({ videoId: video.id, authorId: people[0]!.id, body: 'ریشه' });
    const a = await createComment({ videoId: video.id, authorId: people[1]!.id, body: 'پاسخ اول', parentId: root.id });
    const target = await createComment({ videoId: video.id, authorId: people[2]!.id, body: 'پاسخ گزارش‌شده', parentId: root.id });
    const b = await createComment({ videoId: video.id, authorId: people[3]!.id, body: 'پاسخ بعدی', parentId: root.id });
    await db.channelBlock.create({ data: { channelId: channel.id, userId: people[2]!.id } });
    const report = await createReport({ reporterId: people[3]!.id, comment: target });
    const mod = await moderator();
    const detail = await getReportDetail(report.id, asViewer(mod), f);
    expect(detail!.target).toMatchObject({ type: 'COMMENT', isReply: true, authorBlockedOnChannel: true, deletedByAuthor: false });
    const commentTarget = detail!.target;
    const ctx = commentTarget?.type === 'COMMENT' ? commentTarget.context : [];
    expect(ctx.map((c) => c.id)).toEqual([root.id, a.id, target.id, b.id]);
    expect(ctx.filter((c) => c.isTarget).map((c) => c.id)).toEqual([target.id]);
  });

  it('detail: unknown report → null; channel report knows the owner', async () => {
    const { reports, owner } = await seedQueue();
    const mod = await moderator();
    expect(await getReportDetail('nope', asViewer(mod), f)).toBeNull();
    const d = await getReportDetail(reports.ch.id, asViewer(mod), f);
    expect(d!.target).toMatchObject({ type: 'CHANNEL', videoCount: 2 });
    expect(d!.owner!.id).toBe(owner.id);
  });
});

describe('videos, channels, users', () => {
  it('video list: normalized title search, id search, status filters, open report badge', async () => {
    const { channel, video } = await creatorWithVideo();
    const arabic = await createVideo(channel.id, { title: 'كتاب آشپزی', state: 'private' });
    const failed = await createVideo(channel.id, { title: 'ناموفق', state: 'failed' });
    const processing = await createVideo(channel.id, { title: 'در حال پردازش', state: 'processing' });
    const down = await createVideo(channel.id, { title: 'خارج شده', state: 'takedown' });
    await createReport({ reporterId: (await plainUser()).id, video });
    const run = async (f2: object) => (await listAdminVideos(videoListSchema.parse(f2))).items.map((v) => v.id);

    expect(await run({ q: 'کتاب' })).toEqual([arabic.id]); // Arabic kaf in the data, Persian kaf in the query
    expect(await run({ q: 'ك' + 'تاب' })).toEqual([arabic.id]);
    expect(await run({ q: video.id })).toEqual([video.id]);
    expect(await run({ processing: 'FAILED' })).toEqual([failed.id]);
    expect(await run({ processing: 'PENDING' })).toEqual([processing.id]);
    expect(await run({ takedown: 'YES' })).toEqual([down.id]);
    expect(await run({ visibility: 'PRIVATE' })).toEqual([arabic.id]);
    expect(await run({ channel: channel.handle })).toHaveLength(5);
    expect(await run({ channel: 'no-such-channel' })).toEqual([]);
    const { items } = await listAdminVideos(videoListSchema.parse({ q: video.id }));
    expect(items[0]).toMatchObject({ openReports: 1, owner: { role: 'CREATOR' }, channel: { id: channel.id, suspended: false } });
  });

  it('channel list: search by name / handle / owner e-mail, verified, suspended, sort', async () => {
    const a = await creator('الف');
    const b = await creator('ب');
    await db.channel.update({ where: { id: a.channel!.id }, data: { isVerified: true, followerCount: 10 } });
    await db.channel.update({ where: { id: b.channel!.id }, data: { suspendedAt: new Date(), followerCount: 50 } });
    const run = async (f2: object) => (await listAdminChannels(channelListSchema.parse(f2))).items.map((c) => c.id);
    expect(await run({ verified: 'YES' })).toEqual([a.channel!.id]);
    expect(await run({ suspended: 'YES' })).toEqual([b.channel!.id]);
    expect(await run({ suspended: 'NO', verified: 'NO' })).toEqual([]);
    expect(await run({ q: a.email })).toEqual([a.channel!.id]);
    expect(await run({ q: `@${b.channel!.handle}` })).toEqual([b.channel!.id]);
    expect(await run({ sort: 'followers' })).toEqual([b.channel!.id, a.channel!.id]);
  });

  it('channel detail: real counts, latest requests, suspension reason, scoped history', async () => {
    const mod = await moderator();
    const admin = await administrator();
    const { channel, video } = await creatorWithVideo();
    await createVideo(channel.id, { state: 'takedown' });
    await createVideo(channel.id, { state: 'failed' });
    await createComment({ videoId: video.id, authorId: (await plainUser()).id });
    await createReport({ reporterId: (await plainUser()).id, channel });
    await createMonetizationApplication(channel.id, 'SUBMITTED');
    await db.channel.update({ where: { id: channel.id }, data: { suspendedAt: new Date(), followerCount: 321 } });
    await db.moderationAction.create({ data: { actorId: mod.id, type: 'CHANNEL_SUSPEND', channelId: channel.id, reason: 'دلیل تعلیق' } });
    await db.moderationAction.create({ data: { actorId: admin.id, type: 'MONETIZATION_APPROVE', channelId: channel.id } });

    const forMod = await getAdminChannel(channel.id, asViewer(mod), f);
    expect(forMod).toMatchObject({ suspensionReason: 'دلیل تعلیق', stats: { followers: 321, totalVideos: 3, publicVideos: 1, takenDownVideos: 1, approvedComments: 1 }, reports: { open: 1, total: 1 }, monetization: { status: 'SUBMITTED' } });
    expect(forMod!.history.map((h) => h.type)).toEqual(['CHANNEL_SUSPEND']); // the admin-only monetization row is hidden from moderators
    expect((await getAdminChannel(channel.id, asViewer(admin), f))!.history.map((h) => h.type)).toEqual(['MONETIZATION_APPROVE', 'CHANNEL_SUSPEND']);
    expect(await getAdminChannel('nope', asViewer(mod), f)).toBeNull();
  });

  it('user list: search by e-mail / name / channel handle, role and status filters', async () => {
    const admin = await administrator();
    const mod = await moderator();
    const suspended = await plainUser('تعلیق‌شده');
    await db.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    const owner = await creator('سازنده‌ی ویژه');
    const run = async (f2: object) => (await listAdminUsers(userListSchema.parse(f2))).items.map((u) => u.id);
    expect(await run({ role: 'ADMIN' })).toEqual([admin.id]);
    expect(await run({ role: 'MODERATOR' })).toEqual([mod.id]);
    expect(await run({ status: 'SUSPENDED' })).toEqual([suspended.id]);
    expect(await run({ q: owner.email.toUpperCase() })).toEqual([owner.id]);
    expect(await run({ q: 'سازنده‌ی ویژه' })).toEqual([owner.id]);
    expect(await run({ q: owner.channel!.handle })).toEqual([owner.id]);
    expect(await run({ q: 'nobody-like-this' })).toEqual([]);
  });

  it('user detail: reports against the user (channel, videos, comments), last-admin flag, scoped history', async () => {
    const admin = await administrator();
    const mod = await moderator();
    const { owner, channel, video } = await creatorWithVideo();
    const reporter = await plainUser();
    const comment = await createComment({ videoId: video.id, authorId: owner.id });
    await createReport({ reporterId: reporter.id, video });
    await createReport({ reporterId: reporter.id, comment, status: 'ACTIONED' });
    await createReport({ reporterId: reporter.id, channel });
    await db.moderationAction.create({ data: { actorId: admin.id, type: 'USER_SUSPEND', targetUserId: owner.id } });
    await db.moderationAction.create({ data: { actorId: mod.id, type: 'COMMENT_DELETE', targetUserId: owner.id } });

    const detail = await getAdminUser(owner.id, asViewer(mod), f);
    expect(detail).toMatchObject({ id: owner.id, role: 'CREATOR', reportsAgainst: { open: 2, total: 3 }, isLastAdmin: false });
    expect(detail!.history.map((h) => h.type)).toEqual(['COMMENT_DELETE']);
    expect((await getAdminUser(owner.id, asViewer(admin), f))!.history).toHaveLength(2);
    expect((await getAdminUser(reporter.id, asViewer(mod), f))!.reportsFiled).toBe(3);
    expect((await getAdminUser(admin.id, asViewer(mod), f))!.isLastAdmin).toBe(true);
    await administrator();
    expect((await getAdminUser(admin.id, asViewer(mod), f))!.isLastAdmin).toBe(false);
    expect(await getAdminUser('nope', asViewer(mod), f)).toBeNull();
  });
});

describe('requests and tickets', () => {
  it('monetization list hides drafts, orders the waiting queue oldest first, filters by status and channel', async () => {
    const a = await creator();
    const b = await creator();
    const c = await creator();
    const d = await creator();
    const first = await createMonetizationApplication(a.channel!.id, 'SUBMITTED');
    await db.monetizationApplication.update({ where: { id: first.id }, data: { submittedAt: ago(5) } });
    const second = await createMonetizationApplication(b.channel!.id, 'UNDER_REVIEW');
    await createMonetizationApplication(c.channel!.id, 'DRAFT');
    const decided = await createMonetizationApplication(d.channel!.id, 'APPROVED');
    const run = async (f2: object) => (await listMonetization(monetizationListSchema.parse(f2))).items.map((x) => x.id);
    expect(await run({})).toEqual([first.id, second.id]);
    expect(await run({ status: 'APPROVED' })).toEqual([decided.id]);
    expect(await run({ status: 'ALL' })).toHaveLength(3); // no draft
    expect(await run({ status: 'DRAFT' })).toEqual([first.id, second.id]); // drafts cannot be asked for: unknown values fall back to the waiting queue
    expect(await run({ q: b.channel!.handle })).toEqual([second.id]);
  });

  it('monetization detail: live statistics come from the tables, SEED events are reported separately', async () => {
    const owner = await creator();
    const channel = owner.channel!;
    await db.channel.update({ where: { id: channel.id }, data: { followerCount: 1500 } });
    const v1 = await createVideo(channel.id, { viewCount: 700 });
    await createVideo(channel.id, { viewCount: 300 });
    await createVideo(channel.id, { state: 'private', viewCount: 5 });
    const mk = (watchSeconds: number, source: 'REAL' | 'SEED', daysAgo: number) =>
      db.viewEvent.create({ data: { videoId: v1.id, channelId: channel.id, viewerKey: `k${watchSeconds}${source}${daysAgo}`, watchSeconds, source, createdAt: ago(daysAgo) } });
    await mk(3600, 'REAL', 10);
    await mk(7200, 'REAL', 20);
    await mk(1800, 'SEED', 5);
    await mk(36_000, 'REAL', 400); // outside the 365-day window
    const app = await createMonetizationApplication(channel.id, 'SUBMITTED');

    const live = await getLiveChannelStats(channel.id);
    expect(live).toMatchObject({ followers: 1500, totalViews: 1005, publicVideos: 2, totalVideos: 3, windowDays: 365 });
    expect(live.watchHours.real).toBeCloseTo(3, 5);
    expect(live.watchHours.seed).toBeCloseTo(0.5, 5);

    const detail = await getMonetizationDetail(app.id);
    expect(detail).toMatchObject({ status: 'SUBMITTED', snapshot: { followers: 1200, watchHours: 620 }, owner: { id: owner.id } });
    expect(detail!.live.followers).toBe(1500);
    expect(await getMonetizationDetail('nope')).toBeNull();
    const draft = await createMonetizationApplication((await creator()).channel!.id, 'DRAFT');
    expect(await getMonetizationDetail(draft.id)).toBeNull();
  });

  it('snapshot and evidence parsing never trust stored JSON', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot([1, 2])).toBeNull();
    expect(parseSnapshot({ followers: '12', totalViews: 5, watchHours: NaN, videoCount: 3, capturedAt: 7 })).toEqual({ followers: null, totalViews: 5, watchHours: null, videoCount: 3, capturedAt: null });
    expect(parseEvidenceLinks('x')).toEqual([]);
    const links = parseEvidenceLinks([
      { title: 'سایت', url: 'https://example.com/a' },
      { title: 'خطرناک', url: 'javascript:alert(1)' },
      { title: 'داده', url: 'data:text/html,<script>' },
      { url: '' },
      null,
      { title: 5, url: 'http://example.org' },
      { url: 'not a url' },
    ]);
    expect(links.map((l) => [l.url, l.safe])).toEqual([
      ['https://example.com/a', true],
      ['javascript:alert(1)', false],
      ['data:text/html,<script>', false],
      ['http://example.org', true],
      ['not a url', false],
    ]);
    expect(parseEvidenceLinks(Array.from({ length: 30 }, (_, i) => ({ url: `https://e.com/${i}` })))).toHaveLength(10);
  });

  it('verification list / detail', async () => {
    const a = await creator();
    const b = await creator();
    const first = await createVerificationRequest(a.channel!.id, 'SUBMITTED');
    await db.verificationRequest.update({ where: { id: first.id }, data: { createdAt: ago(4) } });
    const second = await createVerificationRequest(b.channel!.id, 'UNDER_REVIEW');
    const done = await createVerificationRequest(a.channel!.id, 'REJECTED');
    await db.verificationRequest.update({ where: { id: done.id }, data: { decisionNote: 'ناکافی' } });
    const run = async (f2: object) => (await listVerification(verificationListSchema.parse(f2))).items.map((x) => x.id);
    expect(await run({})).toEqual([first.id, second.id]);
    expect(await run({ status: 'REJECTED' })).toEqual([done.id]);
    expect(await run({ status: 'ALL' })).toHaveLength(3);
    expect(await run({ q: b.channel!.name })).toEqual([second.id]);

    const detail = await getVerificationDetail(first.id);
    expect(detail).toMatchObject({ status: 'SUBMITTED', owner: { id: a.id }, evidence: [{ safe: true }], channel: { handle: a.channel!.handle } });
    expect(detail!.previous.map((p) => p.id)).toEqual([done.id]);
    expect(await getVerificationDetail('nope')).toBeNull();
  });

  it('support list: waiting tickets first, search by number / subject / e-mail, category filter; detail thread', async () => {
    const user = await plainUser('کاربر الف');
    const older = await createTicket({ userId: user.id, subject: 'مشکل ورود', email: 'a@example.test' });
    await db.supportTicket.update({ where: { id: older.id }, data: { updatedAt: ago(5) } });
    const newer = await createTicket({ userId: user.id, subject: 'مشکل پخش', status: 'OPEN', email: 'b@example.test' });
    const answered = await createTicket({ userId: user.id, subject: 'تغییر ایمیل', status: 'ANSWERED' });
    const closed = await createTicket({ userId: null, subject: 'بسته', status: 'CLOSED', email: 'guest@example.test' });
    const run = async (f2: object) => (await listSupportTickets(supportListSchema.parse(f2))).items.map((x) => x.id);

    expect(await run({})).toEqual([older.id, newer.id, answered.id]); // OPEN (oldest first), then ANSWERED
    expect(await run({ status: 'OPEN' })).toEqual([older.id, newer.id]);
    expect(await run({ status: 'CLOSED' })).toEqual([closed.id]);
    expect(await run({ status: 'ALL' })).toHaveLength(4);
    expect(await run({ q: String(newer.number) })).toEqual([newer.id]);
    expect(await run({ q: 'پخش' })).toEqual([newer.id]);
    expect(await run({ status: 'ALL', q: 'GUEST@example' })).toEqual([closed.id]);
    expect(await run({ category: 'PLAYBACK' })).toEqual([]);

    const { items } = await listSupportTickets(supportListSchema.parse({ q: String(older.number) }));
    expect(items[0]).toMatchObject({ messageCount: 1, user: { name: 'کاربر الف' }, lastMessage: { isStaff: false } });

    const detail = await getTicketDetail(older.id);
    expect(detail).toMatchObject({ number: older.number, status: 'OPEN', user: { id: user.id } });
    expect(detail!.messages).toHaveLength(1);
    expect(await getTicketDetail('nope')).toBeNull();
  });
});

describe('overview', () => {
  it('counts exactly what waits for a human; monetization is hidden from moderators', async () => {
    const { video, channel } = await creatorWithVideo();
    const reporters = await Promise.all([plainUser(), plainUser(), plainUser(), plainUser()]);
    await createReport({ reporterId: reporters[0]!.id, video, status: 'OPEN' });
    await createReport({ reporterId: reporters[1]!.id, video, status: 'REVIEWING' });
    await createReport({ reporterId: reporters[2]!.id, video, status: 'ACTIONED' });
    await createVerificationRequest(channel.id, 'SUBMITTED');
    await createVerificationRequest(channel.id, 'APPROVED');
    await createMonetizationApplication(channel.id, 'UNDER_REVIEW');
    await createMonetizationApplication((await creator()).channel!.id, 'DRAFT');
    await createTicket({ userId: reporters[0]!.id, status: 'OPEN' });
    await createTicket({ userId: reporters[0]!.id, status: 'ANSWERED' });
    await createVideo(channel.id, { state: 'processing' });
    await createVideo(channel.id, { state: 'failed' });
    await createVideo(channel.id, { state: 'failed' });

    const admin = await getOverview('ADMIN');
    expect(admin.counts).toEqual({ openReports: 1, reviewingReports: 1, pendingVerification: 1, pendingMonetization: 1, openTickets: 1, processingVideos: 1, failedVideos: 2 });
    expect(admin.oldestPendingReportAt).toBeInstanceOf(Date);
    expect((await getOverview('MODERATOR')).counts.pendingMonetization).toBeNull();
    expect(await getNavCounts('ADMIN')).toEqual({ reports: 2, verification: 1, monetization: 1, support: 1 });
    expect(await getNavCounts('MODERATOR')).toEqual({ reports: 2, verification: 1, monetization: null, support: 1 });
  });

  it('is all zeros on an empty platform', async () => {
    const o = await getOverview('ADMIN');
    expect(Object.values(o.counts).every((n) => n === 0)).toBe(true);
    expect(o.oldestPendingReportAt).toBeNull();
  });
});
