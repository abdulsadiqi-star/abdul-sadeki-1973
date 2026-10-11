/**
 * Dev helper: fills the LOCAL development database with a realistic moderation backlog so the staff panel can be
 * looked at (screenshots, manual testing): videos with posters, comments, reports in every state, tickets,
 * monetization applications, verification requests and an audit trail produced by the REAL services.
 *
 *   pnpm exec tsx --env-file=.env tests/e2e/seed-admin-demo.ts          # refuses to run twice
 *   pnpm exec tsx --env-file=.env tests/e2e/seed-admin-demo.ts --force
 *
 * Needs the demo accounts of `pnpm db:seed`. Synthetic view events are tagged source=SEED. Never run it on real data.
 */
import sharp from 'sharp';
import { db } from '../../src/lib/db';
import { hashPassword } from '../../src/lib/auth/password';
import { newVideoId, randomToken } from '../../src/lib/ids';
import { buildChannelSearchName, buildVideoSearchFields } from '../../src/lib/persian';
import { getStorage, keys } from '../../src/lib/storage';
import { applyCommentStatus } from '../../src/features/comments/moderation-core';
import { blockCommenter, deleteComment, suspendChannel, takedownVideo, verifyChannel } from '../../src/features/moderation/content';
import { dismissReport, warnCreator } from '../../src/features/moderation/reports';
import { decideVerification } from '../../src/features/moderation/requests';
import { replyToTicket } from '../../src/features/moderation/support';
import { changeUserRole, suspendUser } from '../../src/features/moderation/users';
import type { CommentStatus, ReportReason, TicketCategory } from '../../src/generated/prisma/enums';

const force = process.argv.includes('--force');

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

async function user(email: string) {
  const u = await db.user.findUnique({ where: { email }, include: { channel: true } });
  if (!u) throw new Error(`Run "pnpm db:seed" first: ${email} is missing.`);
  return u;
}

async function ensureUser(email: string, displayName: string, channel?: { handle: string; name: string; description: string }) {
  let existing = await db.user.findUnique({ where: { email } });
  existing ??= await db.user.create({
    data: { email, displayName, role: channel ? 'CREATOR' : 'USER', emailVerifiedAt: new Date(), passwordHash: await hashPassword(`${randomToken(9)}-A1`) },
  });
  if (channel) {
    await db.channel.upsert({
      where: { handle: channel.handle },
      create: { ownerId: existing.id, handle: channel.handle, name: channel.name, description: channel.description, searchName: buildChannelSearchName(channel.name, channel.handle) },
      update: {},
    });
  }
  return existing;
}

async function poster(videoId: string, hue: number, shape: number): Promise<string> {
  const rgb = (h: number, s: number, l: number) => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${rgb(hue, 70, 48)}"/><stop offset="1" stop-color="${rgb((hue + 60) % 360, 75, 28)}"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <circle cx="${120 + shape * 70}" cy="${90 + (shape % 3) * 60}" r="${90 + shape * 8}" fill="rgba(255,255,255,0.10)"/>
    <circle cx="${520 - shape * 40}" cy="${280 - (shape % 2) * 50}" r="${60 + shape * 10}" fill="rgba(255,255,255,0.14)"/>
    <path d="M285 130 L285 230 L375 180 Z" fill="rgba(255,255,255,0.85)"/></svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 78 }).toBuffer();
  const key = keys.poster(videoId, randomToken(6).replace(/[^A-Za-z0-9]/g, 'x'));
  await getStorage().put(key, jpeg, { contentType: 'image/jpeg' });
  return key;
}

type VideoSpec = { title: string; description: string; tags: string[]; views: number; ageDays: number };

async function createVideo(channelId: string, channelName: string, spec: VideoSpec, hue: number, shape: number, state: 'public' | 'processing' | 'failed' | 'private' = 'public') {
  const id = newVideoId();
  const search = buildVideoSearchFields({ title: spec.title, description: spec.description, tags: spec.tags, channelName });
  const ready = state === 'public' || state === 'private';
  return db.video.create({
    data: {
      id,
      channelId,
      title: spec.title,
      description: spec.description,
      tags: spec.tags,
      kind: 'VIDEO',
      processingStatus: state === 'processing' ? 'PROCESSING' : state === 'failed' ? 'FAILED' : 'READY',
      publishStatus: ready ? 'PUBLISHED' : 'DRAFT',
      visibility: state === 'private' ? 'PRIVATE' : 'PUBLIC',
      publishedAt: ready ? ago(spec.ageDays) : null,
      createdAt: ago(spec.ageDays, 2),
      durationSeconds: ready ? 90 + ((shape * 137) % 800) : null,
      width: ready ? 1280 : null,
      height: ready ? 720 : null,
      posterKey: ready ? await poster(id, hue, shape) : null,
      viewCount: spec.views,
      failureReason: state === 'failed' ? 'فایل بارگذاری‌شده خراب است و خوانده نشد.' : null,
      ...search,
    },
  });
}

async function main() {
  if (!force && (await db.report.count()) > 0) {
    console.log('The database already contains reports; pass --force to add the demo data anyway.');
    return;
  }

  const admin = await user('admin@tamashagah.test');
  const moderator = await user('moderator@tamashagah.test');
  const sara = await user('sara@tamashagah.test');
  const arman = await user('arman@tamashagah.test');
  const nika = await user('nika@tamashagah.test');
  const staffAdmin = { id: admin.id, role: admin.role, displayName: admin.displayName };
  const staffMod = { id: moderator.id, role: moderator.role, displayName: moderator.displayName };

  const people = await Promise.all([
    ensureUser('mohsen@tamashagah.test', 'محسن رضایی'),
    ensureUser('leila@tamashagah.test', 'لیلا صادقی'),
    ensureUser('reza@tamashagah.test', 'رضا نوری'),
    ensureUser('hamid@tamashagah.test', 'حمید قاسمی'),
    ensureUser('shirin@tamashagah.test', 'شیرین کاظمی'),
    ensureUser('spam-bot@tamashagah.test', 'تبلیغات_ارزان'),
    ensureUser('banned@tamashagah.test', 'کاربر متخلف'),
    ensureUser('viewer@tamashagah.test', 'بیننده‌ی نمونه'),
  ]);
  const [mohsen, leila, reza, hamid, shirin, spammer, banned, viewer] = people as [(typeof people)[0], (typeof people)[0], (typeof people)[0], (typeof people)[0], (typeof people)[0], (typeof people)[0], (typeof people)[0], (typeof people)[0]];
  // two more channel owners for the "verified" and "suspended" examples
  const news = await ensureUser('news@tamashagah.test', 'تحریریه‌ی اخبار', { handle: 'tamashagah-news', name: 'اخبار تماشاگاه', description: 'خبرهای رسمی و اطلاعیه‌های پلتفرم.' });
  const dubious = await ensureUser('dubious@tamashagah.test', 'سازنده‌ی پرتکرار', { handle: 'fast-money', name: 'پولدار شدن در یک هفته', description: 'روش‌های مطمئن کسب درآمد سریع!' });

  // --- catalogue ------------------------------------------------------------------------------------------------
  const sc = sara.channel!;
  const ac = arman.channel!;
  const nc = nika.channel!;
  await db.channel.update({ where: { id: sc.id }, data: { followerCount: 1280 } });
  await db.channel.update({ where: { id: ac.id }, data: { followerCount: 5400 } });
  await db.channel.update({ where: { id: nc.id }, data: { followerCount: 860 } });

  const saraVideos = await Promise.all([
    createVideo(sc.id, sc.name, { title: 'طرز تهیه‌ی قورمه‌سبزی اصیل ایرانی', description: 'دستور کامل قورمه‌سبزی با نکته‌های سرخ‌کردن سبزی و پخت لوبیا.', tags: ['قورمه‌سبزی', 'غذای ایرانی'], views: 18240, ageDays: 40 }, 25, 1),
    createVideo(sc.id, sc.name, { title: 'سالاد شیرازی؛ ساده و خوشمزه', description: 'سالاد شیرازی با سس مخصوص و نکته‌های سرو.', tags: ['سالاد', 'پیش‌غذا'], views: 9120, ageDays: 31 }, 120, 2),
    createVideo(sc.id, sc.name, { title: 'کیک شکلاتی بدون فر در ده دقیقه', description: 'کیک اسفنجی شکلاتی با مایکروویو؛ مناسب مهمانی‌های ناگهانی.', tags: ['کیک', 'دسر'], views: 30410, ageDays: 22 }, 18, 3),
    createVideo(sc.id, sc.name, { title: 'آش رشته‌ی سنتی برای شب‌های سرد', description: 'آش رشته با کشک و نعناداغ.', tags: ['آش', 'سنتی'], views: 6020, ageDays: 14 }, 80, 4),
    createVideo(sc.id, sc.name, { title: 'پیش‌نمایش ویدیوی بعدی', description: 'این ویدیو هنوز در حال پردازش است.', tags: [], views: 0, ageDays: 0 }, 200, 5, 'processing'),
  ]);
  const armanVideos = await Promise.all([
    createVideo(ac.id, ac.name, { title: 'نقد و بررسی گوشی میان‌رده‌ی جدید', description: 'بررسی دوربین، باتری و کارایی در یک هفته استفاده‌ی واقعی.', tags: ['گوشی', 'نقد'], views: 52300, ageDays: 18 }, 215, 6),
    createVideo(ac.id, ac.name, { title: 'آموزش پایتون از صفر؛ جلسه‌ی اول', description: 'نصب پایتون، اولین برنامه و آشنایی با متغیرها.', tags: ['پایتون', 'برنامه‌نویسی'], views: 41800, ageDays: 55 }, 140, 7),
    createVideo(ac.id, ac.name, { title: 'ده ابزار مفید برای افزایش بهره‌وری', description: 'ابزارهای رایگان برای مدیریت زمان و یادداشت‌برداری.', tags: ['ابزار', 'بهره‌وری'], views: 12900, ageDays: 9 }, 290, 8),
    createVideo(ac.id, ac.name, { title: 'ویدیوی آزمایشی با فایل خراب', description: 'پردازش این ویدیو ناموفق بود.', tags: [], views: 0, ageDays: 2 }, 0, 9, 'failed'),
  ]);
  const nikaVideos = await Promise.all([
    createVideo(nc.id, nc.name, { title: 'یک روز در کاشان؛ از باغ فین تا خانه‌های تاریخی', description: 'راهنمای سفر یک‌روزه به کاشان با بودجه‌ی کم.', tags: ['کاشان', 'سفر'], views: 15700, ageDays: 27 }, 40, 10),
    createVideo(nc.id, nc.name, { title: 'جاده‌ی چالوس در پاییز', description: 'مسیر، توقف‌گاه‌ها و بهترین ساعت حرکت.', tags: ['چالوس', 'پاییز'], views: 8800, ageDays: 12 }, 160, 11),
    createVideo(nc.id, nc.name, { title: 'ویدیوی خصوصی نیکا', description: 'پیش‌نویس خصوصی.', tags: [], views: 3, ageDays: 3 }, 330, 12, 'private'),
  ]);

  // --- comments -------------------------------------------------------------------------------------------------
  const mk = async (videoId: string, authorId: string, body: string, status: CommentStatus = 'APPROVED', parent?: { id: string }, ageDays = 1) => {
    const c = await db.comment.create({ data: { videoId, authorId, body, status, parentId: parent?.id ?? null, rootId: parent?.id ?? null, createdAt: ago(ageDays) } });
    if (status === 'APPROVED') {
      await db.video.update({ where: { id: videoId }, data: { commentCount: { increment: 1 } } });
      if (parent) await db.comment.update({ where: { id: parent.id }, data: { replyCount: { increment: 1 } } });
    }
    return c;
  };
  const v0 = saraVideos[0]!;
  const c1 = await mk(v0.id, mohsen.id, 'دستور عالی بود؛ دقیقاً مثل قورمه‌سبزی مادربزرگم شد. ممنون از سارا جان.', 'APPROVED', undefined, 6);
  await mk(v0.id, sara.id, 'ممنون از لطفتان، خوشحالم که خوشمزه شد.', 'APPROVED', c1, 5);
  const c2 = await mk(v0.id, spammer.id, 'برای خرید فالوور و لایک ارزان به آی‌دی من پیام بدهید!!! تخفیف ویژه فقط امروز', 'APPROVED', undefined, 3);
  const c3 = await mk(v0.id, banned.id, 'این غذا آشغاله و کسی که پخته هم بی‌سواده. برید یاد بگیرید آشپزی رو، مسخره‌ها!', 'APPROVED', undefined, 2);
  await mk(v0.id, leila.id, 'من لوبیا را کمتر می‌ریزم، آیا اشکالی دارد؟', 'APPROVED', undefined, 2);
  const c4 = await mk(saraVideos[2]!.id, reza.id, 'مقدار آرد را چند فنجان بریزیم؟ توضیح نداده‌اید.', 'APPROVED', undefined, 4);
  await mk(saraVideos[2]!.id, sara.id, 'دو فنجان و نیم؛ توی توضیحات هم نوشته‌ام.', 'APPROVED', c4, 4);
  const c5 = await mk(armanVideos[0]!.id, hamid.id, 'نقد بی‌طرفانه نبود، معلوم است تبلیغ پولی بوده.', 'APPROVED', undefined, 5);
  await mk(armanVideos[0]!.id, shirin.id, 'من همین گوشی را دارم و با نظر شما موافقم. باتری واقعاً عالی است.', 'APPROVED', undefined, 3);
  const c6 = await mk(nikaVideos[0]!.id, spammer.id, 'سفرهای خارجی با تخفیف ۷۰ درصد: لینک را در پروفایل ببینید', 'APPROVED', undefined, 1);
  await mk(nikaVideos[1]!.id, viewer.id, 'عکس‌ها فوق‌العاده بود، مخصوصاً غروب جاده.', 'APPROVED', undefined, 1);

  // --- reports (all states) ---------------------------------------------------------------------------------------
  const rep = (reporterId: string | null, target: { video?: string; comment?: string; channel?: string }, reason: ReportReason, details: string | null, createdAt: Date, status: 'OPEN' | 'REVIEWING' = 'OPEN') =>
    db.report.create({
      data: {
        reporterId,
        reason,
        details,
        status,
        createdAt,
        targetType: target.video ? 'VIDEO' : target.comment ? 'COMMENT' : 'CHANNEL',
        videoId: target.video ?? null,
        commentId: target.comment ?? null,
        channelId: target.channel ?? null,
      },
    });

  // a video with several reports
  await rep(mohsen.id, { video: armanVideos[0]!.id }, 'MISINFORMATION', 'ادعاهایی درباره‌ی باتری گفته شده که با آزمایش واقعی نمی‌خواند.', ago(3));
  await rep(hamid.id, { video: armanVideos[0]!.id }, 'SPAM', 'تبلیغ پنهان بدون اعلام حمایت مالی.', ago(2, 5));
  await rep(leila.id, { video: armanVideos[0]!.id }, 'OTHER', null, ago(1, 8));
  // spam comments
  await rep(reza.id, { comment: c2.id }, 'SPAM', 'تبلیغ فروش فالوور.', ago(2));
  await rep(shirin.id, { comment: c2.id }, 'SPAM', null, ago(1, 3));
  await rep(leila.id, { comment: c3.id }, 'ABUSE', 'توهین مستقیم به سازنده و بیننده‌ها.', ago(2, 2), 'REVIEWING');
  await rep(mohsen.id, { comment: c6.id }, 'SPAM', 'همان تبلیغ دوباره زیر ویدیوی دیگر.', ago(0, 5));
  await rep(hamid.id, { comment: c5.id }, 'OTHER', 'به نظرم نقد مشروع است و نباید حذف شود، فقط بررسی کنید.', ago(4));
  // channels
  await rep(shirin.id, { channel: nc.id }, 'COPYRIGHT', 'بخشی از ویدیوهای این کانال از فیلم‌های دیگران است.', ago(9));
  await rep(reza.id, { channel: nc.id }, 'MISINFORMATION', 'اطلاعات نادرست درباره‌ی ساعت کار اماکن تاریخی.', ago(8));
  // older / varied backlog to exercise pagination and the age filter
  const reasons: ReportReason[] = ['SPAM', 'ABUSE', 'HATE', 'VIOLENCE', 'ADULT', 'COPYRIGHT', 'MISINFORMATION', 'OTHER'];
  const reporters = [mohsen, leila, reza, hamid, shirin, viewer];
  // (saraVideos[1] and [3] are kept free for the decided reports below: one report per reporter and target)
  const targets = [saraVideos[2]!, ...armanVideos.slice(1, 3), ...nikaVideos.slice(0, 2)];
  let n = 0;
  for (const t of targets) {
    for (let k = 0; k < 5 && n < 24; k++, n++) {
      const reporter = reporters[(n + k) % reporters.length]!;
      await rep(reporter.id, { video: t.id }, reasons[n % reasons.length]!, n % 3 === 0 ? 'لطفاً این ویدیو را بررسی کنید.' : null, ago(10 + n * 1.5)).catch(() => undefined);
    }
  }

  // --- decisions made through the REAL services (so the audit trail, report resolution and notifications are genuine)
  const closed1 = await rep(leila.id, { video: saraVideos[3]!.id }, 'OTHER', 'عنوان با محتوا مطابقت ندارد.', ago(12));
  await dismissReport(staffMod, { reportId: closed1.id, reason: 'عنوان و محتوا هم‌خوانی دارند؛ گزارش بی‌اساس بود.', resolveAll: true });
  const closed2 = await rep(reza.id, { comment: c1.id }, 'ABUSE', 'فکر می‌کنم تعریف بیش از حد است.', ago(11));
  await dismissReport(staffMod, { reportId: closed2.id, reason: 'دیدگاه مؤدبانه است و نقض قانونی ندارد.', resolveAll: true });
  const closed3 = await rep(mohsen.id, { video: saraVideos[1]!.id }, 'COPYRIGHT', 'موسیقی پس‌زمینه حق تکثیر دارد.', ago(15));
  await warnCreator(staffMod, { reportId: closed3.id, reason: 'لطفاً از موسیقی بدون مجوز یا موسیقی آزاد استفاده کنید.', resolveAll: true });

  // a taken-down video with its reports (appears in "taken down" filters)
  const bad = await createVideo(nc.id, nc.name, { title: 'ویدیوی نقض‌کننده‌ی قوانین (نمونه)', description: 'این ویدیو برای نمایش وضعیت «خارج‌شده از دسترس» ساخته شده است.', tags: [], views: 940, ageDays: 20 }, 355, 13);
  const closed4 = await rep(hamid.id, { video: bad.id }, 'VIOLENCE', 'صحنه‌های خشونت‌آمیز بدون هشدار سنی.', ago(6));
  await takedownVideo(staffMod, { videoId: bad.id, reason: 'نمایش خشونت بدون هشدار سنی و برچسب مناسب (بند ۳ قوانین).', reportId: closed4.id, resolveAll: true });

  // spam comment: deleted + commenter blocked
  const spamComment = await mk(armanVideos[2]!.id, spammer.id, 'عضو کانال ما شوید و جایزه ببرید!!! 🎁', 'APPROVED', undefined, 7);
  const closed5 = await rep(shirin.id, { comment: spamComment.id }, 'SPAM', null, ago(6, 4));
  await deleteComment(staffMod, { commentId: spamComment.id, reason: 'تبلیغ مزاحم و تکراری.', reportId: closed5.id, resolveAll: true });
  await blockCommenter(staffMod, { channelId: ac.id, userId: spammer.id, reason: 'ارسال مکرر تبلیغات در کانال.', reportId: closed5.id });
  // a creator's own studio moderation (actor = channel owner)
  const studioSpam = await mk(saraVideos[1]!.id, spammer.id, 'تبلیغ فروش سبد غذایی', 'APPROVED', undefined, 8);
  await applyCommentStatus(studioSpam.id, 'SPAM', { actorId: sara.id });

  // roles / users / channels (administrator and moderator actions through the real services)
  await changeUserRole(staffAdmin, { userId: shirin.id, role: 'MODERATOR', reason: 'ارتقا به ناظر پس از سه ماه همکاری مفید.' });
  await changeUserRole(staffAdmin, { userId: shirin.id, role: 'USER', reason: 'پایان دوره‌ی آزمایشی نظارت.' });
  await suspendUser(staffAdmin, { userId: banned.id, reason: 'توهین مکرر به کاربران و سازندگان در دیدگاه‌ها.' });
  await verifyChannel(staffMod, { channelId: (await db.channel.findUniqueOrThrow({ where: { ownerId: news.id } })).id, note: 'کانال رسمی پلتفرم؛ هویت تأیید شد.' });
  const dubiousChannel = await db.channel.findUniqueOrThrow({ where: { ownerId: dubious.id } });
  await createVideo(dubiousChannel.id, dubiousChannel.name, { title: 'ثروتمند شدن در یک هفته؛ فقط امروز', description: 'محتوای فریبنده و تبلیغ پانزی.', tags: ['درآمد'], views: 310, ageDays: 5 }, 50, 14);
  const closed6 = await rep(leila.id, { channel: dubiousChannel.id }, 'SPAM', 'کانال فقط برای تبلیغ طرح‌های پولی و کلاهبرداری است.', ago(4));
  await suspendChannel(staffMod, { channelId: dubiousChannel.id, reason: 'تبلیغ طرح‌های پانزی و گمراه‌کردن کاربران؛ پس از هشدار قبلی تکرار شده است.', reportId: closed6.id, resolveAll: true });

  // --- tickets ---------------------------------------------------------------------------------------------------
  const ticket = async (u: { id: string; email: string }, subject: string, category: TicketCategory, body: string, ageDays: number, replies: string[] = [], userFollowUp?: string) => {
    const t = await db.supportTicket.create({ data: { userId: u.id, email: u.email, subject, category, status: 'OPEN', createdAt: ago(ageDays), updatedAt: ago(ageDays) } });
    await db.ticketMessage.create({ data: { ticketId: t.id, authorId: u.id, body, createdAt: ago(ageDays) } });
    for (const reply of replies) await replyToTicket(staffMod, { ticketId: t.id, body: reply });
    if (userFollowUp) {
      await db.ticketMessage.create({ data: { ticketId: t.id, authorId: u.id, body: userFollowUp } });
      await db.supportTicket.update({ where: { id: t.id }, data: { status: 'OPEN' } });
    }
    return t;
  };
  await ticket(sara, 'ویدیوی من بعد از بارگذاری در صف پردازش مانده است', 'UPLOAD', 'سلام، ویدیویی که دیروز بارگذاری کردم هنوز در وضعیت «در صف پردازش» است. حجم فایل ۴۰۰ مگابایت و فرمت mp4 است.', 1);
  await ticket(arman, 'درخواست بررسی دوباره‌ی تیک تأیید', 'ACCOUNT', 'درخواست تیک تأیید من چند روز است در انتظار است. آیا مدرک دیگری لازم دارید؟', 3, ['سلام و وقت بخیر؛ درخواست شما در صف بررسی است و تا دو روز کاری آینده نتیجه اعلام می‌شود.'], 'ممنون. منتظر می‌مانم، فقط اگر مدرک دیگری لازم شد خبر بدهید.');
  await ticket(nika, 'اعتراض به گزارش حق تکثیر', 'COPYRIGHT', 'یکی از ویدیوهای من به‌دلیل موسیقی گزارش شده است. موسیقی را از کتابخانه‌ی آزاد برداشته‌ام و مجوز آن را دارم.', 5, ['سلام؛ لطفاً نشانی منبع و مجوز موسیقی را برای ما بفرستید تا بررسی شود.']);
  await ticket(mohsen, 'پخش ویدیو در موبایل قطع‌وصل می‌شود', 'PLAYBACK', 'روی گوشی اندروید ویدیوها مدام بافر می‌شوند، اینترنت من سالم است.', 2);
  await ticket(leila, 'تغییر ایمیل حساب کاربری', 'ACCOUNT', 'می‌خواهم ایمیل حسابم را عوض کنم؛ از کجا ممکن است؟', 8, ['سلام؛ فعلاً تغییر ایمیل از طریق پشتیبانی انجام می‌شود. ایمیل جدید را بنویسید تا اقدام کنیم.', 'ایمیل شما تغییر یافت. لطفاً دوباره وارد شوید.']);
  const closedTicket = await ticket(reza, 'سؤال درباره‌ی درآمدزایی', 'MONETIZATION', 'حداقل شرایط درآمدزایی چیست؟', 14, ['سلام؛ شرایط در صفحه‌ی درآمدزایی استودیو نوشته شده است.']);
  await db.supportTicket.update({ where: { id: closedTicket.id }, data: { status: 'CLOSED' } });
  await ticket(hamid, 'گزارش مزاحمت از طرف یک کاربر', 'REPORT_ABUSE', 'کاربری در دیدگاه‌ها مدام مرا مسخره می‌کند.', 0);

  // --- creator programs --------------------------------------------------------------------------------------------
  const watch = async (channelId: string, videoId: string, seconds: number, count: number) => {
    await db.viewEvent.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        videoId,
        channelId,
        viewerKey: `seed-${channelId.slice(-4)}-${videoId}-${i}`,
        watchSeconds: seconds,
        source: 'SEED' as const,
        createdAt: ago(1 + (i % 60)),
        lastBeatAt: ago(1 + (i % 60)),
      })),
    });
  };
  await watch(sc.id, saraVideos[0]!.id, 420, 220);
  await watch(sc.id, saraVideos[2]!.id, 260, 180);
  await watch(ac.id, armanVideos[1]!.id, 900, 400);
  const snapshot = (followers: number, totalViews: number, watchHours: number, videoCount: number) => ({ followers, totalViews, watchHours, videoCount, capturedAt: ago(3).toISOString() });
  await db.monetizationApplication.create({
    data: { channelId: sc.id, status: 'SUBMITTED', acceptedTermsAt: ago(3), contactEmail: 'sara@example.com', statsSnapshot: snapshot(1190, 63800, 410, 4), submittedAt: ago(3) },
  });
  await db.monetizationApplication.create({
    data: { channelId: ac.id, status: 'UNDER_REVIEW', acceptedTermsAt: ago(6), contactEmail: 'arman@example.com', statsSnapshot: snapshot(5200, 107000, 1480, 7), submittedAt: ago(6) },
  });
  await db.monetizationApplication.create({
    data: { channelId: nc.id, status: 'REJECTED', acceptedTermsAt: ago(40), contactEmail: 'nika@example.com', statsSnapshot: snapshot(310, 9100, 52, 3), submittedAt: ago(40), reviewedAt: ago(38), reviewedById: admin.id, decisionNote: 'هنوز به حداقل‌های برنامه نرسیده‌اید؛ پس از رسیدن به ۱۰۰۰ دنبال‌کننده دوباره درخواست دهید.' },
  });
  await db.monetizationApplication.create({
    data: { channelId: nc.id, status: 'SUBMITTED', acceptedTermsAt: ago(1), contactEmail: 'nika@example.com', statsSnapshot: snapshot(840, 24500, 190, 3), submittedAt: ago(1) },
  });

  const vr = (channelId: string, message: string, links: { title: string; url: string }[], ageDays: number, status: 'SUBMITTED' | 'UNDER_REVIEW' = 'SUBMITTED') =>
    db.verificationRequest.create({ data: { channelId, status, message, evidenceLinks: links, createdAt: ago(ageDays) } });
  await vr(ac.id, 'کانال رسمی آرمان تک هستم؛ حساب‌های رسمی من در شبکه‌های دیگر به این کانال لینک دارند.', [
    { title: 'صفحه‌ی رسمی در اینستاگرام', url: 'https://example.com/arman-tech' },
    { title: 'وب‌سایت شخصی', url: 'https://arman.example.org/about' },
  ], 2, 'UNDER_REVIEW');
  await vr(sc.id, 'سارا احمدی، آشپز حرفه‌ای و نویسنده‌ی کتاب «آشپزی با سارا». لینک ناشر و صفحه‌ی رسمی در پیوست آمده است.', [
    { title: 'صفحه‌ی کتاب در سایت ناشر', url: 'https://example.com/books/sara-cooks' },
    { title: 'مصاحبه با رسانه', url: 'javascript:alert(1)' },
  ], 1);
  const oldVr = await vr(nc.id, 'سفرنامه‌نویس هستم.', [], 20);
  await decideVerification(staffMod, { id: oldVr.id, decision: 'REJECT', note: 'مدارک کافی برای احراز هویت ارائه نشده است؛ لطفاً لینک صفحه‌ی رسمی را اضافه کنید.' });
  await db.verificationRequest.update({ where: { id: oldVr.id }, data: { createdAt: ago(20) } });

  console.log('✔ admin demo data created (videos, reports, tickets, requests, audit trail).');
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
