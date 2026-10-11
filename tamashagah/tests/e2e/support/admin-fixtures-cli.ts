/**
 * Database fixtures for tests/e2e/admin.spec.ts.
 *
 * Playwright's own TypeScript loader cannot import the generated Prisma client (it uses `import.meta`), so the
 * spec shells out to this script (run by `tsx`, which can) whenever it needs rows that the UI cannot create yet
 * (staff accounts, a viewer's report, tickets, creator requests) or wants to assert on database state.
 *
 *   tsx admin-fixtures-cli.ts scenario <password>   → prints a JSON description of a fresh, isolated scenario
 *   tsx admin-fixtures-cli.ts state '<json query>'  → prints the current state of the listed entities
 *
 * Everything is created with a random token in its names, so parallel projects (desktop / mobile) never collide.
 */
import { db } from '../../../src/lib/db';
import { hashPassword } from '../../../src/lib/auth/password';
import { newVideoId, randomToken } from '../../../src/lib/ids';
import { buildChannelSearchName, buildVideoSearchFields } from '../../../src/lib/persian';
import { getStorage, keys } from '../../../src/lib/storage';

const [command, arg] = process.argv.slice(2);

async function makeUser(token: string, key: string, displayName: string, password: string, role: 'USER' | 'CREATOR' | 'MODERATOR' | 'ADMIN' = 'USER', withChannel = false) {
  const email = `${key}-${token}@e2e.example.test`;
  const user = await db.user.create({
    data: { email, displayName, role: withChannel && role === 'USER' ? 'CREATOR' : role, emailVerifiedAt: new Date(), passwordHash: await hashPassword(password) },
  });
  let channel: { id: string; handle: string; name: string } | null = null;
  if (withChannel) {
    const handle = `${key}-${token}`;
    const name = `کانال ${displayName}`;
    channel = await db.channel.create({
      data: { ownerId: user.id, handle, name, description: 'کانال آزمایشی برای تست‌های سرتاسری.', searchName: buildChannelSearchName(name, handle) },
      select: { id: true, handle: true, name: true },
    });
  }
  return { id: user.id, email, name: displayName, channel };
}

/** A real (1x1) JPEG, so that `/media/videos/<id>/thumbs/...` has something to serve and its 404s are meaningful. */
const POSTER = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

async function makeVideo(channel: { id: string; name: string }, title: string, viewCount = 120) {
  const search = buildVideoSearchFields({ title, description: 'ویدیوی آزمایشی', tags: [], channelName: channel.name });
  const id = newVideoId();
  const posterKey = keys.poster(id, 'e2e');
  await getStorage().put(posterKey, POSTER, { contentType: 'image/jpeg' });
  const video = await db.video.create({
    data: {
      id,
      posterKey,
      channelId: channel.id,
      title,
      description: 'ویدیوی آزمایشی',
      processingStatus: 'READY',
      publishStatus: 'PUBLISHED',
      visibility: 'PUBLIC',
      publishedAt: new Date(),
      durationSeconds: 95,
      width: 1280,
      height: 720,
      viewCount,
      ...search,
    },
    select: { id: true, title: true, posterKey: true },
  });
  return video;
}

async function scenario(password: string) {
  const token = randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const moderator = await makeUser(token, 'mod', `ناظر ${token}`, password, 'MODERATOR');
  const admin = await makeUser(token, 'admin', `مدیر ${token}`, password, 'ADMIN');
  const creator = await makeUser(token, 'creator', `سازنده ${token}`, password, 'CREATOR', true);
  const viewer = await makeUser(token, 'viewer', `بیننده ${token}`, password);
  const commenter = await makeUser(token, 'commenter', `دیدگاه‌نویس ${token}`, password);
  const promotee = await makeUser(token, 'promotee', `کاربر ارتقا ${token}`, password);
  const applicant = await makeUser(token, 'applicant', `متقاضی ${token}`, password, 'CREATOR', true);
  const verifier = await makeUser(token, 'verifier', `متقاضی تیک ${token}`, password, 'CREATOR', true);

  const video = await makeVideo(creator.channel!, `ویدیوی گزارش‌شده ${token}`);
  const video2 = await makeVideo(creator.channel!, `ویدیوی دوم ${token}`);
  const comment = await db.comment.create({ data: { videoId: video.id, authorId: commenter.id, body: `تبلیغ مزاحم ${token}: برای خرید لایک پیام بدهید`, status: 'APPROVED' } });
  await db.video.update({ where: { id: video.id }, data: { commentCount: 1 } });

  const report = await db.report.create({
    data: { reporterId: viewer.id, targetType: 'VIDEO', videoId: video.id, reason: 'MISINFORMATION', details: `اطلاعات نادرست در ویدیو ${token}` },
    select: { id: true },
  });
  const commentReport = await db.report.create({
    data: { reporterId: viewer.id, targetType: 'COMMENT', commentId: comment.id, reason: 'SPAM', details: 'تبلیغ فروش لایک' },
    select: { id: true },
  });

  const ticket = await db.supportTicket.create({
    data: { userId: creator.id, email: creator.email, subject: `پردازش ویدیو متوقف شده ${token}`, category: 'UPLOAD', status: 'OPEN' },
    select: { id: true, number: true, subject: true },
  });
  await db.ticketMessage.create({ data: { ticketId: ticket.id, authorId: creator.id, body: 'سلام، ویدیوی من ساعت‌هاست در صف پردازش مانده است.' } });

  const monetization = await db.monetizationApplication.create({
    data: {
      channelId: applicant.channel!.id,
      status: 'SUBMITTED',
      acceptedTermsAt: new Date(),
      contactEmail: applicant.email,
      submittedAt: new Date(),
      statsSnapshot: { followers: 1500, totalViews: 52000, watchHours: 640, videoCount: 7, capturedAt: new Date().toISOString() },
    },
    select: { id: true },
  });
  const verification = await db.verificationRequest.create({
    data: {
      channelId: verifier.channel!.id,
      status: 'SUBMITTED',
      message: `کانال رسمی ${token} هستم.`,
      evidenceLinks: [
        { title: 'صفحه‌ی رسمی', url: 'https://example.com/official-page' },
        { title: 'پیوند خطرناک', url: 'javascript:alert(1)' },
      ],
    },
    select: { id: true },
  });

  // 45 audit rows by a unique actor, to exercise filters and pagination of the audit log without touching other data
  const auditActor = await makeUser(token, 'audit', `ناظر سابقه ${token}`, password, 'MODERATOR');
  await db.moderationAction.createMany({
    data: Array.from({ length: 45 }, (_, i) => ({
      actorId: auditActor.id,
      type: i % 5 === 0 ? ('VIDEO_TAKEDOWN' as const) : ('TICKET_CLOSE' as const),
      reason: `دلیل شماره ${i + 1} ${token}`,
      createdAt: new Date(Date.now() - i * 60_000),
      meta: { number: i + 1, videoTitle: `ویدیوی سابقه ${i + 1}` },
    })),
  });

  // two administrator-only decisions about the viewer: moderators must never see them in the audit log
  await db.moderationAction.createMany({
    data: [
      { actorId: admin.id, type: 'USER_ROLE_CHANGE' as const, targetUserId: viewer.id, reason: `ارتقای آزمایشی ${token}`, meta: { from: 'USER', to: 'MODERATOR' } },
      { actorId: admin.id, type: 'USER_SUSPEND' as const, targetUserId: viewer.id, reason: `تعلیق آزمایشی ${token}`, meta: {} },
    ],
  });

  return { token, password, moderator, admin, creator, viewer, commenter, promotee, applicant, verifier, auditActor, video, video2, comment: { id: comment.id }, report, commentReport, ticket, monetization, verification };
}

type StateQuery = {
  videoId?: string;
  reportIds?: string[];
  commentId?: string;
  channelId?: string;
  userId?: string;
  ticketId?: string;
  monetizationId?: string;
  verificationId?: string;
  notificationsFor?: string;
  auditWhere?: { videoId?: string; commentId?: string; channelId?: string; targetUserId?: string; actorId?: string };
};

async function state(query: StateQuery) {
  const out: Record<string, unknown> = {};
  if (query.videoId) {
    const v = await db.video.findUnique({ where: { id: query.videoId }, select: { takedownAt: true, takedownReason: true, commentCount: true } });
    out.video = v && { takedown: !!v.takedownAt, takedownReason: v.takedownReason, commentCount: v.commentCount };
  }
  if (query.reportIds) {
    const reports = await db.report.findMany({ where: { id: { in: query.reportIds } }, select: { id: true, status: true, resolution: true, handledById: true } });
    out.reports = Object.fromEntries(reports.map((r) => [r.id, { status: r.status, resolution: r.resolution, handled: !!r.handledById }]));
  }
  if (query.commentId) {
    const c = await db.comment.findUnique({ where: { id: query.commentId }, select: { status: true, moderationNote: true } });
    out.comment = c;
  }
  if (query.channelId) {
    const c = await db.channel.findUnique({ where: { id: query.channelId }, select: { isVerified: true, suspendedAt: true } });
    out.channel = c && { isVerified: c.isVerified, suspended: !!c.suspendedAt };
  }
  if (query.userId) {
    const u = await db.user.findUnique({ where: { id: query.userId }, select: { role: true, status: true } });
    out.user = u && { ...u, sessions: await db.session.count({ where: { userId: query.userId } }) };
  }
  if (query.ticketId) {
    const t = await db.supportTicket.findUnique({ where: { id: query.ticketId }, select: { status: true, _count: { select: { messages: true } } } });
    out.ticket = t && { status: t.status, messages: t._count.messages };
  }
  if (query.monetizationId) {
    out.monetization = await db.monetizationApplication.findUnique({ where: { id: query.monetizationId }, select: { status: true, decisionNote: true } });
  }
  if (query.verificationId) {
    out.verification = await db.verificationRequest.findUnique({ where: { id: query.verificationId }, select: { status: true, decisionNote: true } });
  }
  if (query.notificationsFor) {
    const rows = await db.notification.findMany({ where: { userId: query.notificationsFor }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { type: true, title: true, body: true } });
    out.notifications = rows;
  }
  if (query.auditWhere) {
    const rows = await db.moderationAction.findMany({ where: query.auditWhere, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { type: true, reason: true, reportId: true } });
    out.audit = rows;
  }
  return out;
}

async function main() {
  if (command === 'scenario') {
    if (!arg) throw new Error('usage: scenario <password>');
    console.log(JSON.stringify(await scenario(arg)));
  } else if (command === 'state') {
    console.log(JSON.stringify(await state(JSON.parse(arg ?? '{}') as StateQuery)));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
