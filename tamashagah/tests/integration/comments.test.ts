import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { postComment, deleteOwnComment } from '@/features/comments/service';
import { moderateComment } from '@/features/comments/moderation-service';
import { getCommentPage, getReplyPage } from '@/features/comments/queries';
import { deleteCommentAction, postCommentAction } from '@/features/comments/actions';
import { GET as listRoute } from '@/app/api/comments/route';
import { GET as repliesRoute } from '@/app/api/comments/[id]/replies/route';
import { reportComment } from '@/features/reports/service';
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
const actorOf = (u: U | null) => (u ? viewerOf(u) : null);

async function setup() {
  const owner = await createUser({ withChannel: true, displayName: 'سازنده' });
  const fan = await createUser({ displayName: 'علاقه‌مند' });
  const other = await createUser({ displayName: 'دیگری' });
  const video = await createVideo(owner.channel!.id, { title: 'ویدیوی آزمایشی' });
  return { owner, fan, other, video };
}

const counters = async (videoId: string) => (await db.video.findUniqueOrThrow({ where: { id: videoId } })).commentCount;
const replyCountOf = async (id: string) => (await db.comment.findUniqueOrThrow({ where: { id } })).replyCount;
const post = (u: U, videoId: string, body: string, parentId?: string) => postComment(viewerOf(u), { videoId, body, parentId });

/** Varied Persian filler of exactly `n` characters (a single repeated letter would trip the flood heuristic). */
const filler = (n: number) => {
  let out = '';
  for (let i = 1; out.length < n; i++) out += `کلمه${i} `;
  return out.slice(0, n).trimEnd().padEnd(n, 'ن');
};

describe('posting', () => {
  it('publishes immediately in OPEN mode, bumps the counter and notifies the creator', async () => {
    const { owner, fan, video } = await setup();
    const { comment, outcome } = await post(fan, video.id, 'ویدیوی خیلی خوبی بود، ممنون');
    expect(outcome).toBe('published');
    expect(comment).toMatchObject({
      status: 'APPROVED',
      body: 'ویدیوی خیلی خوبی بود، ممنون',
      rootId: null,
      replyCount: 0,
      isOwn: true,
      author: { id: fan.id, name: 'علاقه‌مند', isCreator: false, handle: null },
    });
    expect(await counters(video.id)).toBe(1);

    const notices = await db.notification.findMany({ where: { userId: owner.id } });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      type: 'NEW_COMMENT',
      actorId: fan.id,
      videoId: video.id,
      commentId: comment!.id,
      href: `/watch/${video.id}#comments`,
    });
    expect(notices[0]!.title).toContain('علاقه‌مند');
    expect(notices[0]!.title).toContain('ویدیوی آزمایشی');
    expect(notices[0]!.body).toBe('ویدیوی خیلی خوبی بود، ممنون');
  });

  it('does not notify the creator about their own comments and marks them as the creator', async () => {
    const { owner, video } = await setup();
    const { comment } = await post(owner, video.id, 'ممنون از همه‌ی شما');
    expect(comment!.author.isCreator).toBe(true);
    expect(await db.notification.count()).toBe(0);
  });

  it('normalizes the text (Arabic letters, control and bidi characters, whitespace)', async () => {
    const { fan, video } = await setup();
    const { comment } = await post(fan, video.id, '  كتاب   خوبي‎ بود\u0007  \n\n\n\nدوباره  ');
    expect(comment!.body).toBe('کتاب خوبی بود\n\nدوباره');
    expect((await db.comment.findFirstOrThrow()).body).toBe('کتاب خوبی بود\n\nدوباره');
  });

  it('validates the length after normalization', async () => {
    const { fan, video } = await setup();
    await expect(post(fan, video.id, '   ‌  ')).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { body: expect.any(Array) } });
    await expect(post(fan, video.id, filler(1001))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(post(fan, video.id, filler(1000))).resolves.toMatchObject({ outcome: 'published' });
    expect(await db.comment.count()).toBe(1);
  });

  it('requires a verified e-mail', async () => {
    const { video } = await setup();
    const unverified = await createUser({ verified: false });
    await expect(post(unverified, video.id, 'سلام')).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect(await db.comment.count()).toBe(0);
  });

  it('answers NOT_FOUND for videos the viewer may not see, but lets the owner comment on their own hidden video', async () => {
    const { owner, fan } = await setup();
    for (const state of ['private', 'draft', 'processing', 'scheduled', 'takedown'] as const) {
      const hidden = await createVideo(owner.channel!.id, { state });
      await expect(post(fan, hidden.id, `سلام ${state}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    const priv = await createVideo(owner.channel!.id, { state: 'private' });
    await expect(post(owner, priv.id, 'یادداشت خصوصی')).resolves.toMatchObject({ outcome: 'published' });
    const unlisted = await createVideo(owner.channel!.id, { state: 'unlisted' });
    await expect(post(fan, unlisted.id, 'پیوند را از دوستم گرفتم')).resolves.toMatchObject({ outcome: 'published' });
  });
});

describe('channel comment modes', () => {
  it('DISABLED channels and videos with comments turned off reject posts server-side', async () => {
    const { owner, fan, video } = await setup();
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'DISABLED' } });
    await expect(post(fan, video.id, 'سلام')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(post(owner, video.id, 'حتی سازنده هم نه')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'OPEN' } });
    await db.video.update({ where: { id: video.id }, data: { commentsEnabled: false } });
    await expect(post(fan, video.id, 'سلام')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.comment.count()).toBe(0);
  });

  it('APPROVAL_REQUIRED holds comments (no counter change) and tells the creator', async () => {
    const { owner, fan, video } = await setup();
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'APPROVAL_REQUIRED' } });
    const { comment, outcome } = await post(fan, video.id, 'منتظر تأیید می‌مانم');
    expect(outcome).toBe('pending');
    expect(comment).toMatchObject({ status: 'PENDING', isOwn: true });
    expect(await counters(video.id)).toBe(0);
    const notice = await db.notification.findFirstOrThrow({ where: { userId: owner.id } });
    expect(notice).toMatchObject({ type: 'COMMENT_PENDING', href: '/studio/comments?tab=pending', commentId: comment!.id });
  });

  it('exempts the channel owner from approval', async () => {
    const { owner, video } = await setup();
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'APPROVAL_REQUIRED' } });
    expect((await post(owner, video.id, 'پاسخ خودم')).outcome).toBe('published');
    expect(await counters(video.id)).toBe(1);
  });
});

describe('blocked commenters', () => {
  it('cannot post on the blocking channel only', async () => {
    const { owner, fan, video } = await setup();
    await db.channelBlock.create({ data: { channelId: owner.channel!.id, userId: fan.id, reason: 'هرزنامه' } });
    await expect(post(fan, video.id, 'سلام دوباره')).rejects.toMatchObject({ code: 'BLOCKED' });

    const other = await createUser({ withChannel: true });
    const elsewhere = await createVideo(other.channel!.id);
    await expect(post(fan, elsewhere.id, 'این‌جا اشکالی ندارد')).resolves.toMatchObject({ outcome: 'published' });

    await db.channelBlock.deleteMany();
    await expect(post(fan, video.id, 'حالا می‌توانم')).resolves.toMatchObject({ outcome: 'published' });
  });
});

describe('spam heuristics', () => {
  it('holds comments with more than two links for review', async () => {
    const { owner, fan, video } = await setup();
    const { outcome, comment } = await post(fan, video.id, 'ببینید https://a.com https://b.com https://c.com');
    expect(outcome).toBe('pending');
    expect(comment!.status).toBe('PENDING');
    expect(await counters(video.id)).toBe(0);
    expect((await db.notification.findFirstOrThrow({ where: { userId: owner.id } })).type).toBe('COMMENT_PENDING');
  });

  it('stores duplicates and known scams as SPAM: hidden from everyone, no counters, no notification', async () => {
    const { owner, fan, other, video } = await setup();
    await post(fan, video.id, 'این ویدیو واقعاً آموزنده و خوب بود');
    const dup = await post(fan, video.id, 'این ویدیو واقعاً آموزنده و خوب بود');
    expect(dup).toEqual({ comment: null, outcome: 'spam' });
    const scam = await post(other, video.id, 'کسب درآمد روزانه بدون سرمایه');
    expect(scam.outcome).toBe('spam');

    expect(await db.comment.count({ where: { status: 'SPAM' } })).toBe(2);
    expect(await counters(video.id)).toBe(1);
    expect(await db.notification.count({ where: { userId: owner.id } })).toBe(1); // only the first, genuine comment
    const page = await getCommentPage(video.id, actorOf(fan));
    expect(page.items.map((c) => c.body)).toEqual(['این ویدیو واقعاً آموزنده و خوب بود']);
  });

  it('only compares against the last 10 minutes and ignores deleted comments', async () => {
    const { fan, video } = await setup();
    const first = await post(fan, video.id, 'یک متن نسبتاً بلند برای بررسی');
    await db.comment.update({ where: { id: first.comment!.id }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await post(fan, video.id, 'یک متن نسبتاً بلند برای بررسی')).outcome).toBe('published');

    const second = await post(fan, video.id, 'متن دیگری که حذف می‌شود');
    await deleteOwnComment(viewerOf(fan), second.comment!.id);
    expect((await post(fan, video.id, 'متن دیگری که حذف می‌شود')).outcome).toBe('published');
  });

  it('never applies the heuristics to the channel owner', async () => {
    const { owner, video } = await setup();
    expect((await post(owner, video.id, 'https://a.com https://b.com https://c.com')).outcome).toBe('published');
  });
});

describe('replies', () => {
  it('flattens threads under the root and keeps both counters exact', async () => {
    const { owner, fan, other, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    const reply = (await post(other, video.id, 'پاسخ به دیدگاه اصلی', root.id)).comment!;
    const nested = (await post(fan, video.id, 'پاسخ به پاسخ دیگری', reply.id)).comment!;

    expect(reply).toMatchObject({ rootId: root.id, replyToName: null });
    expect(nested).toMatchObject({ rootId: root.id, replyToName: 'دیگری' });
    const rows = await db.comment.findMany({ where: { id: { in: [reply.id, nested.id] } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => ({ parentId: r.parentId, rootId: r.rootId, replyToUserId: r.replyToUserId }))).toEqual([
      { parentId: root.id, rootId: root.id, replyToUserId: fan.id },
      { parentId: reply.id, rootId: root.id, replyToUserId: other.id },
    ]);
    expect(await counters(video.id)).toBe(3);
    expect(await replyCountOf(root.id)).toBe(2);
    expect(await replyCountOf(reply.id)).toBe(0); // replies never accumulate their own replyCount
    expect(owner.id).toBeTruthy();
  });

  it('notifies the answered person (not the creator) about a reply', async () => {
    const { owner, fan, other, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    await db.notification.deleteMany();
    const reply = (await post(other, video.id, 'نظرتان درست است', root.id)).comment!;
    const notices = await db.notification.findMany();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: fan.id, type: 'COMMENT_REPLY', actorId: other.id, commentId: reply.id, href: `/watch/${video.id}#comments` });
    expect(owner.id).toBeTruthy();
  });

  it('does not notify when you answer yourself', async () => {
    const { fan, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    await db.notification.deleteMany();
    await post(fan, video.id, 'ادامه‌ی همان صحبت', root.id);
    expect(await db.notification.count({ where: { userId: fan.id } })).toBe(0);
  });

  it('refuses to answer comments that are not public, belong to another video or do not exist', async () => {
    const { owner, fan, other, video } = await setup();
    const elsewhere = await createVideo(owner.channel!.id);
    const onOther = (await post(fan, elsewhere.id, 'دیدگاه روی ویدیوی دیگر')).comment!;
    const pending = await db.comment.create({ data: { videoId: video.id, authorId: fan.id, body: 'در انتظار', status: 'PENDING' } });
    const spam = await db.comment.create({ data: { videoId: video.id, authorId: fan.id, body: 'هرز', status: 'SPAM' } });
    for (const parentId of [onOther.id, pending.id, spam.id, 'cknonexistent0000000000000']) {
      await expect(post(other, video.id, 'پاسخ', parentId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('cannot answer a reply whose thread was hidden', async () => {
    const { owner, fan, other, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    const reply = (await post(other, video.id, 'پاسخ اول', root.id)).comment!;
    await moderateComment(viewerOf(owner), root.id, 'REJECTED');
    await expect(post(fan, video.id, 'پاسخ به پاسخ', reply.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('holds replies in approval mode and counts them only after approval, notifying everybody involved', async () => {
    const { owner, fan, other, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'APPROVAL_REQUIRED' } });
    await db.notification.deleteMany();

    const reply = (await post(other, video.id, 'پاسخ در انتظار تأیید', root.id)).comment!;
    expect(reply.status).toBe('PENDING');
    expect(await counters(video.id)).toBe(1);
    expect(await replyCountOf(root.id)).toBe(0);
    expect((await db.notification.findMany()).map((n) => [n.userId, n.type])).toEqual([[owner.id, 'COMMENT_PENDING']]);

    await moderateComment(viewerOf(owner), reply.id, 'APPROVED');
    expect(await counters(video.id)).toBe(2);
    expect(await replyCountOf(root.id)).toBe(1);
    const after = await db.notification.findMany({ where: { type: { in: ['COMMENT_APPROVED', 'COMMENT_REPLY'] } } });
    expect(after.map((n) => `${n.userId}:${n.type}`).sort()).toEqual([`${other.id}:COMMENT_APPROVED`, `${fan.id}:COMMENT_REPLY`].sort());
  });
});

describe('deleting your own comment', () => {
  it('removes the comment and keeps counters exact; a deleted root takes its replies along', async () => {
    const { fan, other, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    const r1 = (await post(other, video.id, 'پاسخ اول', root.id)).comment!;
    await post(fan, video.id, 'پاسخ دوم من', root.id);
    expect(await counters(video.id)).toBe(3);

    await deleteOwnComment(viewerOf(other), r1.id);
    expect(await counters(video.id)).toBe(2);
    expect(await replyCountOf(root.id)).toBe(1);

    await deleteOwnComment(viewerOf(fan), root.id);
    expect(await counters(video.id)).toBe(0);
    expect((await db.comment.findMany({ select: { status: true } })).every((c) => c.status === 'DELETED')).toBe(true);
    const actions = await db.moderationAction.findMany({ where: { type: 'COMMENT_DELETE' } });
    expect(actions.length).toBe(3);
    expect(actions.every((a) => a.actorId === fan.id || a.actorId === other.id)).toBe(true);
  });

  it('lets people remove their held comment too, but nobody else’s', async () => {
    const { owner, fan, other, video } = await setup();
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'APPROVAL_REQUIRED' } });
    const pending = (await post(fan, video.id, 'در انتظار تأیید')).comment!;
    await expect(deleteOwnComment(viewerOf(other), pending.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteOwnComment(viewerOf(owner), pending.id)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // moderating is a studio action
    await deleteOwnComment(viewerOf(fan), pending.id);
    expect((await db.comment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('DELETED');
    await expect(deleteOwnComment(viewerOf(fan), pending.id)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // already gone
    expect(await counters(video.id)).toBe(0);
  });
});

describe('listing', () => {
  async function seedMany(videoId: string, authorId: string, n: number) {
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < n; i++) {
      await db.comment.create({ data: { videoId, authorId, body: `دیدگاه شماره ${i + 1}`, createdAt: new Date(base + i * 1_000) } });
    }
    await db.video.update({ where: { id: videoId }, data: { commentCount: n } });
  }

  it('lists newest first with cursor pagination and no duplicates', async () => {
    const { fan, video } = await setup();
    await seedMany(video.id, fan.id, 25);
    const page1 = await getCommentPage(video.id, null, { limit: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.items[0]!.body).toBe('دیدگاه شماره 25');
    expect(page1.nextCursor).toBe(page1.items[9]!.id);

    const page2 = await getCommentPage(video.id, null, { limit: 10, cursor: page1.nextCursor });
    const page3 = await getCommentPage(video.id, null, { limit: 10, cursor: page2.nextCursor });
    expect(page3.items).toHaveLength(5);
    expect(page3.nextCursor).toBeNull();
    const all = [...page1.items, ...page2.items, ...page3.items].map((c) => c.id);
    expect(new Set(all).size).toBe(25);
    expect(page3.items.at(-1)!.body).toBe('دیدگاه شماره 1');
  });

  it('shows only APPROVED comments publicly, plus the author’s own PENDING one', async () => {
    const { fan, other, video } = await setup();
    await db.comment.createMany({
      data: [
        { videoId: video.id, authorId: fan.id, body: 'تأیید شده', status: 'APPROVED' },
        { videoId: video.id, authorId: fan.id, body: 'در انتظار من', status: 'PENDING' },
        { videoId: video.id, authorId: other.id, body: 'در انتظار دیگری', status: 'PENDING' },
        { videoId: video.id, authorId: fan.id, body: 'رد شده', status: 'REJECTED' },
        { videoId: video.id, authorId: fan.id, body: 'هرز', status: 'SPAM' },
        { videoId: video.id, authorId: fan.id, body: 'حذف شده', status: 'DELETED' },
      ],
    });
    const bodies = async (actor: U | null) => (await getCommentPage(video.id, actorOf(actor))).items.map((c) => [c.body, c.status, c.isOwn]).sort();
    expect(await bodies(null)).toEqual([['تأیید شده', 'APPROVED', false]]);
    expect(await bodies(other)).toEqual([['تأیید شده', 'APPROVED', false], ['در انتظار دیگری', 'PENDING', true]].sort());
    expect(await bodies(fan)).toEqual([['تأیید شده', 'APPROVED', true], ['در انتظار من', 'PENDING', true]].sort());
  });

  it('pages replies oldest first and hides replies of threads that are not visible', async () => {
    const { owner, fan, other, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    for (let i = 1; i <= 12; i++) await post(i % 2 ? other : fan, video.id, `پاسخ شماره ${i}`, root.id);
    const p1 = await getReplyPage(root.id, null, { limit: 5 });
    expect(p1.items.map((r) => r.body)).toEqual(['پاسخ شماره 1', 'پاسخ شماره 2', 'پاسخ شماره 3', 'پاسخ شماره 4', 'پاسخ شماره 5']);
    const p2 = await getReplyPage(root.id, null, { limit: 5, cursor: p1.nextCursor });
    const p3 = await getReplyPage(root.id, null, { limit: 5, cursor: p2.nextCursor });
    expect(p3.items.map((r) => r.body)).toEqual(['پاسخ شماره 11', 'پاسخ شماره 12']);
    expect(p3.nextCursor).toBeNull();

    await moderateComment(viewerOf(owner), root.id, 'SPAM');
    await expect(getReplyPage(root.id, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('decorates comments: creator badge, channel identity, reported flag', async () => {
    const { owner, fan, other, video } = await setup();
    const channelUser = await createUser({ withChannel: true, displayName: 'صاحب کانال', handle: 'my-channel' });
    const mine = (await post(owner, video.id, 'پاسخ سازنده')).comment!;
    const theirs = (await post(channelUser, video.id, 'نظر یک سازنده‌ی دیگر')).comment!;
    const plain = (await post(fan, video.id, 'نظر یک بیننده')).comment!;
    await reportComment(viewerOf(other), plain.id, { reason: 'SPAM' });

    const items = (await getCommentPage(video.id, actorOf(other))).items;
    const byId = new Map(items.map((c) => [c.id, c]));
    expect(byId.get(mine.id)!.author).toMatchObject({ isCreator: true, name: owner.channel!.name, handle: owner.channel!.handle });
    expect(byId.get(theirs.id)!.author).toMatchObject({ isCreator: false, name: channelUser.channel!.name, handle: 'my-channel' });
    expect(byId.get(plain.id)).toMatchObject({ reported: true, author: { name: 'علاقه‌مند', handle: null } });
    expect(byId.get(mine.id)!.reported).toBe(false);
  });

  it('lists nothing when the creator turned comments off', async () => {
    const { owner, fan, video } = await setup();
    await post(fan, video.id, 'دیدگاه قبل از بستن');
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'DISABLED' } });
    expect(await getCommentPage(video.id, null)).toEqual({ items: [], nextCursor: null, total: 0, disabled: true });
  });

  it('answers NOT_FOUND for videos the viewer may not see', async () => {
    const { owner, video } = await setup();
    for (const state of ['private', 'draft', 'takedown'] as const) {
      const hidden = await createVideo(owner.channel!.id, { state });
      await expect(getCommentPage(hidden.id, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(getCommentPage(video.id, null)).resolves.toMatchObject({ items: [] });
  });
});

describe('GET /api/comments', () => {
  const get = (qs: string) => listRoute(new NextRequest(`http://localhost:3000/api/comments?${qs}`), { params: Promise.resolve({}) });

  it('serves public comments and 404s for private, draft and taken-down videos', async () => {
    const { owner, fan, video } = await setup();
    await post(fan, video.id, 'دیدگاه عمومی');
    logout();
    const ok = await get(`videoId=${video.id}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ total: 1, items: [{ body: 'دیدگاه عمومی' }] });
    expect(ok.headers.get('cache-control')).toMatch(/no-store/);

    for (const state of ['private', 'draft', 'takedown'] as const) {
      const hidden = await createVideo(owner.channel!.id, { state });
      expect((await get(`videoId=${hidden.id}`)).status, state).toBe(404);
    }
    expect((await get('videoId=aB3dE5gH7jK')).status).toBe(404);
    const unlisted = await createVideo(owner.channel!.id, { state: 'unlisted' });
    expect((await get(`videoId=${unlisted.id}`)).status).toBe(200);
  });

  it('validates the query and lets the owner read comments of their private video', async () => {
    const { owner } = await setup();
    expect((await get('videoId=bad')).status).toBe(422);
    expect((await get('')).status).toBe(422);
    const priv = await createVideo(owner.channel!.id, { state: 'private' });
    await loginAs(owner.id);
    expect((await get(`videoId=${priv.id}`)).status).toBe(200);
  });

  it('includes the signed-in author’s own held comment', async () => {
    const { owner, fan, other, video } = await setup();
    await db.channel.update({ where: { id: owner.channel!.id }, data: { commentsMode: 'APPROVAL_REQUIRED' } });
    await post(fan, video.id, 'منتظر تأیید');
    await loginAs(fan.id);
    expect((await (await get(`videoId=${video.id}`)).json()).items).toHaveLength(1);
    await loginAs(other.id);
    expect((await (await get(`videoId=${video.id}`)).json()).items).toHaveLength(0);
    logout();
    expect((await (await get(`videoId=${video.id}`)).json()).items).toHaveLength(0);
  });
});

describe('GET /api/comments/[id]/replies', () => {
  const get = (id: string, qs = '') =>
    repliesRoute(new NextRequest(`http://localhost:3000/api/comments/${id}/replies?${qs}`), { params: Promise.resolve({ id }) });

  it('serves replies and hides them for hidden videos', async () => {
    const { owner, fan, other, video } = await setup();
    const root = (await post(fan, video.id, 'دیدگاه اصلی من')).comment!;
    await post(other, video.id, 'یک پاسخ', root.id);
    logout();
    const res = await get(root.id);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
    expect((await get('x')).status).toBe(404);
    expect((await get('cknonexistent0000000000000')).status).toBe(404);

    await db.video.update({ where: { id: video.id }, data: { visibility: 'PRIVATE' } });
    expect((await get(root.id)).status).toBe(404);
    await loginAs(owner.id);
    expect((await get(root.id)).status).toBe(200);
  });
});

describe('server actions', () => {
  it('require sign-in and a verified e-mail, and validate their input', async () => {
    const { fan, video } = await setup();
    logout();
    expect(await postCommentAction({ videoId: video.id, body: 'سلام' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await deleteCommentAction({ commentId: 'cknonexistent0000000000000' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });

    const unverified = await createUser({ verified: false });
    await loginAs(unverified.id);
    expect(await postCommentAction({ videoId: video.id, body: 'سلام' })).toMatchObject({ ok: false, code: 'EMAIL_NOT_VERIFIED' });

    await loginAs(fan.id);
    expect(await postCommentAction({ videoId: 'bad', body: 'سلام' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await postCommentAction({ videoId: video.id, body: 12 })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await postCommentAction({ videoId: video.id, body: 'x'.repeat(5000) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await postCommentAction({ videoId: video.id, body: '   ' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('post and delete end to end', async () => {
    const { fan, other, video } = await setup();
    await loginAs(fan.id);
    const res = await postCommentAction({ videoId: video.id, body: 'سلام به همه' });
    expect(res).toMatchObject({ ok: true, data: { outcome: 'published', comment: { body: 'سلام به همه' } } });
    const id = res.ok ? res.data.comment!.id : '';
    await loginAs(other.id);
    expect(await deleteCommentAction({ commentId: id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await loginAs(fan.id);
    expect(await deleteCommentAction({ commentId: id })).toEqual({ ok: true, data: undefined });
    expect(await counters(video.id)).toBe(0);
  });

  it('rate limit posting (12 comments per 5 minutes per user)', async () => {
    const { fan, video } = await setup();
    await loginAs(fan.id);
    for (let i = 0; i < 12; i++) {
      expect(await postCommentAction({ videoId: video.id, body: `دیدگاه متفاوت شماره ${i} برای آزمون` })).toMatchObject({ ok: true });
    }
    expect(await postCommentAction({ videoId: video.id, body: 'دیدگاه سیزدهم برای آزمون' })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('answer NOT_FOUND for hidden videos', async () => {
    const { owner, fan } = await setup();
    const hidden = await createVideo(owner.channel!.id, { state: 'takedown' });
    await loginAs(fan.id);
    expect(await postCommentAction({ videoId: hidden.id, body: 'سلام' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
