/** The data behind `/studio/videos`, the upload page and the edit page. */
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { newVideoId } from '@/lib/ids';
import { getPendingUploads, getProcessingVideos, getStudioEditData, getStudioTabCounts, listStudioVideos } from '@/features/videos-studio/queries';
import { studioListParamsSchema } from '@/features/videos-studio/schemas';
import { createCategory, createUser, createVideo } from '../helpers/factories';
import { createReadyVideo } from '../helpers/media';

const params = (over: Record<string, unknown> = {}) => studioListParamsSchema.parse(over);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function seedChannel() {
  const owner = await createUser({ withChannel: true });
  const channelId = owner.channel!.id;
  const category = await createCategory('cat-a', 'آموزش');
  // ready + public (newest first by createdAt)
  const publics = [];
  for (let i = 0; i < 10; i++) {
    const v = await createVideo(channelId, { state: 'public', title: `ویدیوی عمومی ${i}`, viewCount: i * 10, categoryId: i < 3 ? category.id : undefined });
    await db.video.update({ where: { id: v.id }, data: { createdAt: hoursAgo(100 - i) } });
    publics.push(v);
  }
  const drafts = await Promise.all([1, 2, 3, 4].map((i) => createVideo(channelId, { state: 'draft', title: `پیش‌نویس ${i}` })));
  const processing = await createVideo(channelId, { state: 'processing', title: 'در حال پردازش' });
  const queued = await createVideo(channelId, { state: 'processing', title: 'در صف' });
  await db.video.update({ where: { id: queued.id }, data: { processingStatus: 'QUEUED' } });
  const uploading = await createVideo(channelId, { state: 'processing', title: 'در حال بارگذاری' });
  await db.video.update({ where: { id: uploading.id }, data: { processingStatus: 'AWAITING_UPLOAD' } });
  const failed = await Promise.all([1, 2].map((i) => createVideo(channelId, { state: 'failed', title: `ناموفق ${i}` })));
  const scheduled = await Promise.all([1, 2].map((i) => createVideo(channelId, { state: 'scheduled', title: `زمان‌بندی ${i}` })));
  const shortPublic = await createVideo(channelId, { state: 'public', kind: 'SHORT', title: 'شورتس عمومی' });
  const shortDraft = await createVideo(channelId, { state: 'draft', kind: 'SHORT', title: 'شورتس پیش‌نویس' });
  const privateVideo = await createVideo(channelId, { state: 'private', title: 'خصوصی' });
  return { owner, channelId, category, publics, drafts, processing, queued, uploading, failed, scheduled, shortPublic, shortDraft, privateVideo };
}

describe('tab counts and filters', () => {
  it('counts every tab with one query', async () => {
    const { channelId } = await seedChannel();
    expect(await getStudioTabCounts(channelId)).toEqual({
      all: 10 + 4 + 3 + 2 + 2 + 2 + 1, // public + draft + processing(3) + failed + scheduled + shorts + private
      unpublished: 4 + 1, // READY drafts (incl. the short draft)
      scheduled: 2,
      processing: 3,
      failed: 2,
      shorts: 2,
    });
    expect(await getStudioTabCounts('nobody')).toEqual({ all: 0, unpublished: 0, scheduled: 0, processing: 0, failed: 0, shorts: 0 });
  });

  it('each tab lists exactly its videos, and the total matches the badge', async () => {
    const { channelId, drafts, shortDraft, scheduled, failed, processing, queued, uploading, shortPublic } = await seedChannel();
    const ids = async (tab: string) => (await listStudioVideos(channelId, params({ tab }))).items.map((i) => i.id).sort();
    expect(await ids('unpublished')).toEqual([...drafts, shortDraft].map((v) => v.id).sort());
    expect(await ids('scheduled')).toEqual(scheduled.map((v) => v.id).sort());
    expect(await ids('failed')).toEqual(failed.map((v) => v.id).sort());
    expect(await ids('processing')).toEqual([processing, queued, uploading].map((v) => v.id).sort());
    expect(await ids('shorts')).toEqual([shortPublic, shortDraft].map((v) => v.id).sort());
    const all = await listStudioVideos(channelId, params());
    expect(all.total).toBe(all.counts.all);
    expect(all.items).toHaveLength(Math.min(24, all.total));
  });

  it('never shows another channel’s videos', async () => {
    const { channelId } = await seedChannel();
    const other = await createUser({ withChannel: true });
    await createVideo(other.channel!.id, { title: 'ویدیوی دیگران' });
    const page = await listStudioVideos(channelId, params());
    expect(page.items.some((i) => i.title === 'ویدیوی دیگران')).toBe(false);
    expect((await listStudioVideos(other.channel!.id, params())).total).toBe(1);
  });

  it('searches titles with Persian-aware normalization (ي/ك, ZWNJ, digits)', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const a = await createVideo(channelId, { title: 'كتاب‌خوانی شبانه' }); // Arabic kaf + ZWNJ
    await createVideo(channelId, { title: 'آشپزی ایرانی', description: 'دستور ۱۲۳ پخت' });
    const titles = async (q: string) => (await listStudioVideos(channelId, params({ q }))).items.map((i) => i.title);
    expect(await titles('کتاب خوانی')).toEqual([a.title]); // Persian kaf, plain space
    expect(await titles('شبانه')).toEqual([a.title]);
    expect(await titles('پخت 123')).toEqual([]); // adjacent words only if contiguous after folding
    expect(await titles('123')).toEqual(['آشپزی ایرانی']); // body search, Persian digits folded
    expect(await titles('')).toHaveLength(2);
    expect(await titles('وجود ندارد')).toEqual([]);
    // a query with SQL/regex metacharacters is just text
    expect(await titles("%' OR 1=1 --")).toEqual([]);
  });

  it('filters by visibility and category', async () => {
    const { channelId, category, privateVideo } = await seedChannel();
    const priv = await listStudioVideos(channelId, params({ visibility: 'PRIVATE' }));
    expect(priv.items.map((i) => i.id)).toEqual([privateVideo.id]);
    const cat = await listStudioVideos(channelId, params({ category: category.id }));
    expect(cat.total).toBe(3);
    const both = await listStudioVideos(channelId, params({ category: category.id, visibility: 'UNLISTED' }));
    expect(both.total).toBe(0);
  });

  it('sorts by newest, oldest, views and likes with a stable tie-breaker', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const v = [] as Awaited<ReturnType<typeof createVideo>>[];
    for (let i = 0; i < 4; i++) v.push(await createVideo(channelId, { title: `v${i}`, viewCount: [5, 50, 50, 1][i]! }));
    await db.$transaction(v.map((x, i) => db.video.update({ where: { id: x.id }, data: { createdAt: hoursAgo(10 - i), likeCount: [0, 3, 9, 1][i]! } })));
    const order = async (sort: string) => (await listStudioVideos(channelId, params({ sort }))).items.map((i) => i.title);
    expect(await order('newest')).toEqual(['v3', 'v2', 'v1', 'v0']);
    expect(await order('oldest')).toEqual(['v0', 'v1', 'v2', 'v3']);
    expect(await order('views')).toEqual(['v2', 'v1', 'v0', 'v3']); // 50/50 tie → newest first
    expect(await order('likes')).toEqual(['v2', 'v1', 'v3', 'v0']);
  });
});

describe('pagination', () => {
  it('pages the grid by 24 and the list by 20, clamps out-of-range pages and keeps the order stable', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    await db.video.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        id: newVideoId(),
        channelId,
        title: `ویدیو ${i}`,
        processingStatus: 'READY' as const,
        publishStatus: 'PUBLISHED' as const,
        createdAt: new Date(Date.now() - i * 60_000),
      })),
    });
    const g1 = await listStudioVideos(channelId, params({ view: 'grid' }));
    const g2 = await listStudioVideos(channelId, params({ view: 'grid', page: 2 }));
    const g3 = await listStudioVideos(channelId, params({ view: 'grid', page: 3 }));
    expect([g1.items.length, g2.items.length, g3.items.length]).toEqual([24, 24, 2]);
    expect([g1.pageCount, g1.total, g1.pageSize]).toEqual([3, 50, 24]);
    const seen = new Set([...g1.items, ...g2.items, ...g3.items].map((i) => i.id));
    expect(seen.size).toBe(50); // no duplicates, nothing missing

    const clamped = await listStudioVideos(channelId, params({ page: 99 }));
    expect(clamped.page).toBe(3);
    expect(clamped.items).toHaveLength(2);

    const list = await listStudioVideos(channelId, params({ view: 'list' }));
    expect([list.items.length, list.pageCount, list.pageSize]).toEqual([20, 3, 20]);
  });

  it('an empty channel has one empty page', async () => {
    const owner = await createUser({ withChannel: true });
    const page = await listStudioVideos(owner.channel!.id, params());
    expect(page).toMatchObject({ items: [], total: 0, page: 1, pageCount: 1 });
  });
});

describe('list items', () => {
  it('are plain serializable data with live job info for processing videos', async () => {
    const owner = await createUser({ withChannel: true });
    const video = await createVideo(owner.channel!.id, { state: 'processing', title: 'در حال کار' });
    await db.transcodeJob.create({ data: { videoId: video.id, status: 'ACTIVE', stage: 'TRANSCODE', progress: 37, attempt: 2, maxAttempts: 3 } });
    const ready = await createReadyVideo(owner.channel!.id, { state: 'public' });

    const { items } = await listStudioVideos(owner.channel!.id, params());
    const working = items.find((i) => i.id === video.id)!;
    expect(working.job).toEqual({ status: 'ACTIVE', stage: 'TRANSCODE', progress: 37, attempt: 2, maxAttempts: 3 });
    const done = items.find((i) => i.id === ready.id)!;
    expect(done.job).toBeNull();
    expect(done.posterUrl).toMatch(/^\/media\/videos\/.+\/thumbs\/poster_/);
    expect(typeof done.createdAt).toBe('string');
    expect(() => JSON.stringify(items)).not.toThrow(); // no BigInt / Date leaks
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);
  });
});

describe('upload page data', () => {
  it('lists unfinished uploads (not stale ones) and videos still being processed', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const mk = (title: string, status: 'AWAITING_UPLOAD' | 'QUEUED' | 'PROCESSING' | 'READY', createdAt = new Date()) =>
      db.video.create({
        data: { id: newVideoId(), channelId, title, processingStatus: status, originalFilename: `${title}.mp4`, sourceSizeBytes: 5_000_000n, createdAt },
      });
    const fresh = await mk('تازه', 'AWAITING_UPLOAD');
    await mk('کهنه', 'AWAITING_UPLOAD', hoursAgo(60)); // older than UPLOAD_STALE_HOURS (48)
    const queued = await mk('صف', 'QUEUED');
    const working = await mk('پردازش', 'PROCESSING');
    await mk('آماده', 'READY');

    expect(await getPendingUploads(channelId)).toEqual([{ id: fresh.id, filename: 'تازه.mp4', sizeBytes: 5_000_000, createdAt: fresh.createdAt.toISOString() }]);
    expect((await getProcessingVideos(channelId)).map((v) => v.id).sort()).toEqual([queued.id, working.id].sort());
    expect(await getPendingUploads('someone-else')).toEqual([]);
  });
});

describe('edit page data', () => {
  it('returns everything for the owner and nothing for strangers', async () => {
    const owner = await createUser({ withChannel: true });
    const video = await createReadyVideo(owner.channel!.id, { state: 'public', title: 'نمونه' });
    const actor = { id: owner.id, role: owner.role, channelId: owner.channel!.id, emailVerified: true };

    const data = await getStudioEditData(actor, video.id);
    expect(data).toMatchObject({
      id: video.id,
      title: 'نمونه',
      processingStatus: 'READY',
      publishStatus: 'PUBLISHED',
      kind: 'VIDEO',
      kindChoice: 'VIDEO', // a READY video starts the form with its current kind
      channelHandle: owner.channel!.handle,
      customPoster: false,
    });
    expect(data!.thumbnails.map((t) => [t.index, t.selected])).toEqual([[1, false], [2, true], [3, false]]);
    expect(data!.thumbnails[0]!.url).toBe(`/media/videos/${video.id}/thumbs/auto_1.jpg`);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);

    const stranger = await createUser({ withChannel: true });
    const strangerActor = { id: stranger.id, role: stranger.role, channelId: stranger.channel!.id, emailVerified: true };
    expect(await getStudioEditData(strangerActor, video.id)).toBeNull();
    expect(await getStudioEditData(null, video.id)).toBeNull();
    expect(await getStudioEditData(actor, 'AAAAAAAAAAA')).toBeNull();
    const mod = await createUser({ role: 'MODERATOR' });
    expect(await getStudioEditData({ id: mod.id, role: 'MODERATOR', channelId: null, emailVerified: true }, video.id)).not.toBeNull();
  });

  it('while processing, the kind choice comes from the SOURCE asset', async () => {
    const owner = await createUser({ withChannel: true });
    const video = await createVideo(owner.channel!.id, { state: 'processing' });
    const actor = { id: owner.id, role: owner.role, channelId: owner.channel!.id, emailVerified: true };
    expect((await getStudioEditData(actor, video.id))!.kindChoice).toBe('auto');
    await db.mediaAsset.create({ data: { videoId: video.id, kind: 'SOURCE', storageKey: `uploads/${video.id}`, meta: { kindChoice: 'SHORT' } } });
    expect((await getStudioEditData(actor, video.id))!.kindChoice).toBe('SHORT');
  });
});
