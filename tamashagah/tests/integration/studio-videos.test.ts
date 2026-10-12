/**
 * Studio video management through the real Server Actions: editing, publishing rules, deleting, retrying, bulk
 * actions — including every "who may / may not" rule and every validation failure.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { closeQueues, getQueue } from '@/lib/queue';
import { getStorage, keys } from '@/lib/storage';
import {
  bulkVideosAction,
  confirmUploadAction,
  deleteVideoAction,
  retryProcessingAction,
  updateVideoAction,
} from '@/features/videos-studio/actions';
import { cleanupVideoFiles } from '../../worker/jobs/housekeeping';
import { processVideo } from '../../worker/pipeline/process-video';
import { loadVideoAccess } from '@/features/videos/media-access';
import { createCategory, createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { createReadyVideo, createUploadedVideo } from '../helpers/media';

vi.hoisted(() => {
  process.env.TRANSCODE_PRESET = 'ultrafast';
});

afterAll(async () => {
  await closeQueues();
});

async function creator() {
  const user = await createUser({ withChannel: true });
  await loginAs(user.id);
  return user;
}

const meta = (over: Record<string, unknown> = {}) => ({
  title: 'عنوان تازه',
  description: 'توضیحات',
  tags: ['آموزش'],
  visibility: 'PUBLIC',
  publishMode: 'PUBLISH',
  commentsEnabled: true,
  kindChoice: 'auto',
  ...over,
});

const fail = (result: { ok: boolean }) => {
  if (result.ok) throw new Error('expected a failure');
  return result as unknown as { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };
};

describe('updateVideoAction: editing', () => {
  it('saves every field and refreshes the search index with normalized Persian text', async () => {
    const owner = await creator();
    const category = await createCategory('education', 'آموزش');
    const video = await createVideo(owner.channel!.id, { state: 'draft', title: 'قدیمی' });

    const result = await updateVideoAction({
      id: video.id,
      metadata: meta({
        title: '  كتاب   جدید ',
        description: 'آموزش ي ك',
        tags: ['#ایران', 'ایران', 'سفر'],
        categoryId: category.id,
        visibility: 'UNLISTED',
        commentsEnabled: false,
        ageRestricted: true,
        language: 'en',
        publishMode: 'DRAFT',
      }),
    });
    expect(result.ok).toBe(true);

    const saved = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(saved).toMatchObject({
      title: 'کتاب جدید', // Arabic kaf folded, spaces collapsed
      description: 'آموزش ی ک',
      tags: ['ایران', 'سفر'],
      categoryId: category.id,
      visibility: 'UNLISTED',
      commentsEnabled: false,
      ageRestricted: true,
      language: 'en',
      publishStatus: 'DRAFT',
    });
    expect(saved.searchTitle).toBe('کتاب جدید');
    expect(saved.searchBody).toContain('ایران');
    expect(saved.searchBody).toContain(owner.channel!.name.replace(/\s+/g, ' ').toLowerCase());
  });

  it('leaves language and age restriction untouched when the form does not send them', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    await db.video.update({ where: { id: video.id }, data: { ageRestricted: true, language: 'ar' } });
    expect((await updateVideoAction({ id: video.id, metadata: meta() })).ok).toBe(true);
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ ageRestricted: true, language: 'ar' });
  });

  it('validates input with Persian field errors', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    const bad = async (metadata: Record<string, unknown>) => fail(await updateVideoAction({ id: video.id, metadata: meta(metadata) }));

    expect((await bad({ title: '   ' })).fieldErrors).toHaveProperty('metadata.title');
    expect((await bad({ title: 'ا'.repeat(101) })).fieldErrors!['metadata.title']![0]).toContain('۱۰۰');
    expect((await bad({ description: 'ا'.repeat(5001) })).fieldErrors).toHaveProperty('metadata.description');
    expect((await bad({ visibility: 'SECRET' })).code).toBe('VALIDATION');
    expect((await bad({ language: 'xx' })).fieldErrors).toHaveProperty('metadata.language');
    expect((await bad({ categoryId: 'doesnotexist00000000' })).fieldErrors).toHaveProperty('categoryId');
    expect((await fail(await updateVideoAction({ id: 'bad', metadata: meta() }))).code).toBe('VALIDATION');
    expect((await fail(await updateVideoAction('nonsense'))).code).toBe('VALIDATION');
    // nothing was written by any of the failures
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).title).not.toBe('عنوان تازه');
  });

  it('rejects inactive categories', async () => {
    const owner = await creator();
    const category = await createCategory('old', 'قدیمی');
    await db.category.update({ where: { id: category.id }, data: { isActive: false } });
    const video = await createVideo(owner.channel!.id);
    const result = fail(await updateVideoAction({ id: video.id, metadata: meta({ categoryId: category.id }) }));
    expect(result.fieldErrors!.categoryId![0]).toContain('دسته');
  });
});

describe('updateVideoAction: who may edit', () => {
  it('visitors are asked to sign in, users without a channel are refused', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    logout();
    expect(fail(await updateVideoAction({ id: video.id, metadata: meta() })).code).toBe('UNAUTHENTICATED');
    const noChannel = await createUser();
    await loginAs(noChannel.id);
    expect(fail(await updateVideoAction({ id: video.id, metadata: meta() })).code).toBe('FORBIDDEN');
  });

  it('another creator gets NOT_FOUND (existence is not revealed) and nothing changes', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id, { title: 'اصلی' });
    await creator(); // a different creator is now signed in
    const result = fail(await updateVideoAction({ id: video.id, metadata: meta({ title: 'هک شد' }) }));
    expect(result.code).toBe('NOT_FOUND');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).title).toBe('اصلی');
    // an id that does not exist at all looks identical
    expect(fail(await updateVideoAction({ id: 'AAAAAAAAAAA', metadata: meta() })).message).toBe(result.message);
  });

  it('moderators with a channel can NOT edit other channels\u2019 videos through the studio (they use the audited staff panel)', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    const moderator = await createUser({ role: 'MODERATOR', withChannel: true });
    await loginAs(moderator.id);
    expect(await updateVideoAction({ id: video.id, metadata: meta({ title: 'ویرایش ناظر' }) })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).title).not.toBe('ویرایش ناظر');
  });

  it('is rate limited per user', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    let last: { ok: boolean; code?: string } = { ok: true };
    for (let i = 0; i < 95; i++) last = await updateVideoAction({ id: video.id, metadata: meta({ title: `عنوان ${i}` }) });
    expect(last).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('publishing from the studio', () => {
  it('publishes a ready draft, announces it once, unpublishes and schedules', async () => {
    const owner = await creator();
    const follower = await createUser();
    await db.follow.create({ data: { userId: follower.id, channelId: owner.channel!.id, notify: true } });
    const video = await createVideo(owner.channel!.id, { state: 'draft' });

    expect((await updateVideoAction({ id: video.id, metadata: meta({ publishMode: 'PUBLISH' }) })).ok).toBe(true);
    let saved = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(saved).toMatchObject({ publishStatus: 'PUBLISHED', scheduledFor: null });
    expect(saved.publishedAt).toBeInstanceOf(Date);
    expect(await db.notification.count({ where: { userId: follower.id, type: 'NEW_VIDEO', videoId: video.id } })).toBe(1);

    // saving again keeps the original publish date and does not announce twice
    const firstDate = saved.publishedAt!;
    expect((await updateVideoAction({ id: video.id, metadata: meta({ title: 'عنوان دیگر', publishMode: 'PUBLISH' }) })).ok).toBe(true);
    saved = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(saved.publishedAt).toEqual(firstDate);
    expect(await db.notification.count({ where: { type: 'NEW_VIDEO' } })).toBe(1);

    // unpublish
    expect((await updateVideoAction({ id: video.id, metadata: meta({ publishMode: 'DRAFT' }) })).ok).toBe(true);
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ publishStatus: 'DRAFT', publishedAt: null, publishOnReady: false });

    // schedule in the future
    const at = new Date(Date.now() + 2 * 3_600_000);
    const scheduled = await updateVideoAction({ id: video.id, metadata: meta({ publishMode: 'SCHEDULE', scheduledFor: at.toISOString() }) });
    expect(scheduled).toMatchObject({ ok: true, data: { publishStatus: 'SCHEDULED', scheduledFor: at.toISOString() } });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ publishStatus: 'SCHEDULED', scheduledFor: at, publishedAt: null });
  });

  it('refuses schedules in the past, beyond a year, or without a time', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id, { state: 'draft' });
    const past = fail(await updateVideoAction({ id: video.id, metadata: meta({ publishMode: 'SCHEDULE', scheduledFor: new Date(Date.now() - 60_000).toISOString() }) }));
    expect(past.fieldErrors!['scheduledFor']![0]).toContain('آینده');
    const far = fail(await updateVideoAction({ id: video.id, metadata: meta({ publishMode: 'SCHEDULE', scheduledFor: new Date(Date.now() + 400 * 86_400_000).toISOString() }) }));
    expect(far.fieldErrors!['scheduledFor']![0]).toContain('یک سال');
    expect(fail(await updateVideoAction({ id: video.id, metadata: meta({ publishMode: 'SCHEDULE' }) })).code).toBe('VALIDATION');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).publishStatus).toBe('DRAFT');
  });

  it('re-saving an already scheduled video whose time has just passed does not fail (unchanged schedule)', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id, { state: 'scheduled' });
    const at = new Date(Date.now() - 30_000);
    await db.video.update({ where: { id: video.id }, data: { scheduledFor: at } });
    const result = await updateVideoAction({ id: video.id, metadata: meta({ title: 'فقط عنوان', publishMode: 'SCHEDULE', scheduledFor: at.toISOString() }) });
    expect(result.ok).toBe(true);
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ publishStatus: 'SCHEDULED', title: 'فقط عنوان' });
  });

  it('while the video is still processing only the intent is saved — and the worker applies it', async () => {
    const owner = await creator();
    const { id } = await createUploadedVideo(owner.channel!.id, { source: 'portrait-short' });

    // the creator fills the form while the video waits in the queue: keep it a draft, and it is a normal VIDEO
    expect((await updateVideoAction({ id, metadata: meta({ title: 'در حال پردازش', publishMode: 'DRAFT', kindChoice: 'VIDEO' }) })).ok).toBe(true);
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ processingStatus: 'QUEUED', publishStatus: 'DRAFT', publishOnReady: false, kind: 'VIDEO', title: 'در حال پردازش' });

    const outcome = await processVideo(id);
    expect(outcome).toMatchObject({ status: 'ready', publishStatus: 'DRAFT', kind: 'VIDEO' }); // portrait + short, but the creator chose VIDEO
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ title: 'در حال پردازش', processingStatus: 'READY', publishStatus: 'DRAFT' });
  }, 120_000);

  it('a schedule saved while processing is honoured when processing finishes', async () => {
    const owner = await creator();
    const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p' });
    const at = new Date(Date.now() + 3_600_000);
    expect((await updateVideoAction({ id, metadata: meta({ publishMode: 'SCHEDULE', scheduledFor: at.toISOString() }) })).ok).toBe(true);
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ publishStatus: 'SCHEDULED', processingStatus: 'QUEUED' });
    expect(await processVideo(id)).toMatchObject({ status: 'ready', publishStatus: 'SCHEDULED' });
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ publishStatus: 'SCHEDULED', scheduledFor: at, publishedAt: null });
  }, 120_000);

  it('kind: an explicit choice sticks, "auto" re-detects on a ready video', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id, { width: 720, height: 1280, durationSeconds: 30, kind: 'VIDEO' });
    expect((await updateVideoAction({ id: video.id, metadata: meta({ kindChoice: 'SHORT' }) })).ok).toBe(true);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).kind).toBe('SHORT');
    expect((await updateVideoAction({ id: video.id, metadata: meta({ kindChoice: 'VIDEO' }) })).ok).toBe(true);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).kind).toBe('VIDEO');
    expect((await updateVideoAction({ id: video.id, metadata: meta({ kindChoice: 'auto' }) })).ok).toBe(true);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).kind).toBe('SHORT'); // portrait, 30 s
  });

  it('making a private video public announces it to followers (once)', async () => {
    const owner = await creator();
    const follower = await createUser();
    await db.follow.create({ data: { userId: follower.id, channelId: owner.channel!.id, notify: true } });
    const video = await createVideo(owner.channel!.id, { state: 'private' });
    expect(await db.notification.count({ where: { type: 'NEW_VIDEO' } })).toBe(0);
    expect((await updateVideoAction({ id: video.id, metadata: meta({ visibility: 'PUBLIC', publishMode: 'PUBLISH' }) })).ok).toBe(true);
    expect(await db.notification.count({ where: { type: 'NEW_VIDEO', userId: follower.id } })).toBe(1);
  });

  it('visibility changes apply to media delivery immediately (access cache invalidated)', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id, { state: 'public' });
    expect((await loadVideoAccess(video.id))?.visibility).toBe('PUBLIC'); // cached
    expect((await updateVideoAction({ id: video.id, metadata: meta({ visibility: 'PRIVATE' }) })).ok).toBe(true);
    expect((await loadVideoAccess(video.id))?.visibility).toBe('PRIVATE');
  });
});

describe('deleteVideoAction', () => {
  it('hard-deletes the rows and removes the files through a cleanup job', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id, { state: 'public' });
    await db.comment.create({ data: { videoId: video.id, authorId: owner.id, body: 'x' } });
    const storage = getStorage();
    expect(await storage.head(keys.hlsMaster(video.id))).not.toBeNull();

    expect(await deleteVideoAction({ id: video.id })).toEqual({ ok: true, data: undefined });
    expect(await db.video.findUnique({ where: { id: video.id } })).toBeNull();
    expect(await db.mediaAsset.count({ where: { videoId: video.id } })).toBe(0);
    expect(await db.comment.count({ where: { videoId: video.id } })).toBe(0);
    expect(await loadVideoAccess(video.id)).toBeNull();

    // files are removed by the queued job
    expect(await getQueue('maintenance').getJobCounts('waiting')).toEqual({ waiting: 1 });
    expect(await cleanupVideoFiles(video.id)).toEqual({ skipped: false });
    expect(await storage.list(`videos/${video.id}/`)).toHaveLength(0);
  });

  it('a video that is still uploading or processing also gets a delayed second cleanup pass', async () => {
    const owner = await creator();
    const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p' });
    expect((await deleteVideoAction({ id })).ok).toBe(true);
    expect(await getQueue('maintenance').getJobCounts('waiting', 'delayed')).toEqual({ waiting: 1, delayed: 1 });
  });

  it('only people who manage the video can delete it', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    await creator();
    expect(fail(await deleteVideoAction({ id: video.id })).code).toBe('NOT_FOUND');
    expect(await db.video.count({ where: { id: video.id } })).toBe(1);
    logout();
    expect(fail(await deleteVideoAction({ id: video.id })).code).toBe('UNAUTHENTICATED');
    expect(await db.video.count({ where: { id: video.id } })).toBe(1);
    await loginAs(owner.id);
    expect(fail(await deleteVideoAction({ id: '../etc' })).code).toBe('VALIDATION');
  });
});

describe('retryProcessingAction', () => {
  it('re-queues a FAILED video and the retry really succeeds', async () => {
    const owner = await creator();
    const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p' });
    // first run fails because the source is unreadable...
    const good = await getStorage().get(keys.upload(id));
    await getStorage().put(keys.upload(id), Buffer.from('definitely not a video'));
    expect(await processVideo(id)).toMatchObject({ status: 'failed' });
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ processingStatus: 'FAILED' });

    // ...the creator fixes nothing (the bad file is still there) but retries: it fails again deterministically
    expect(await retryProcessingAction({ id })).toEqual({ ok: true, data: undefined });
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ processingStatus: 'QUEUED', failureReason: null });
    expect(await db.transcodeJob.count({ where: { videoId: id } })).toBe(2);
    const newest = await db.transcodeJob.findFirstOrThrow({ where: { videoId: id }, orderBy: { createdAt: 'desc' } });
    expect(newest).toMatchObject({ status: 'QUEUED' });
    expect((await getQueue('video').getJob(newest.queueJobId!))?.data).toEqual({ videoId: id });
    expect(await processVideo(id)).toMatchObject({ status: 'failed' });

    // now the real source is back (e.g. the creator re-uploaded through tus) and the retry works
    const chunks: Buffer[] = [];
    for await (const c of good!.stream) chunks.push(Buffer.from(c as Uint8Array));
    await getStorage().put(keys.upload(id), Buffer.concat(chunks));
    expect((await retryProcessingAction({ id })).ok).toBe(true);
    expect(await processVideo(id)).toMatchObject({ status: 'ready', renditions: ['360p'] });
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ processingStatus: 'READY', failureReason: null, publishStatus: 'PUBLISHED' });
  }, 180_000);

  it('only FAILED videos can be retried, and only when the source still exists', async () => {
    const owner = await creator();
    const ready = await createReadyVideo(owner.channel!.id);
    expect(fail(await retryProcessingAction({ id: ready.id })).code).toBe('CONFLICT');

    const lost = await createVideo(owner.channel!.id, { state: 'failed' });
    const result = fail(await retryProcessingAction({ id: lost.id }));
    expect(result.code).toBe('BAD_REQUEST');
    expect(result.message).toContain('دوباره بارگذاری');
    expect((await db.video.findUniqueOrThrow({ where: { id: lost.id } })).processingStatus).toBe('FAILED');
  });

  it('other users cannot retry your video; retries are rate limited', async () => {
    const owner = await creator();
    const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p' });
    await db.video.update({ where: { id }, data: { processingStatus: 'FAILED' } });
    await creator();
    expect(fail(await retryProcessingAction({ id })).code).toBe('NOT_FOUND');

    await loginAs(owner.id);
    let last: { ok: boolean; code?: string } = { ok: true };
    for (let i = 0; i < 12; i++) {
      await db.video.update({ where: { id }, data: { processingStatus: 'FAILED' } });
      last = await retryProcessingAction({ id });
    }
    expect(last).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('bulkVideosAction', () => {
  it('publishes ready drafts, skips the rest with a reason, and never touches other channels', async () => {
    const owner = await creator();
    const follower = await createUser();
    await db.follow.create({ data: { userId: follower.id, channelId: owner.channel!.id, notify: true } });
    const draftA = await createVideo(owner.channel!.id, { state: 'draft' });
    const draftB = await createVideo(owner.channel!.id, { state: 'draft' });
    const scheduled = await createVideo(owner.channel!.id, { state: 'scheduled' });
    const processing = await createVideo(owner.channel!.id, { state: 'processing' });
    const published = await createVideo(owner.channel!.id, { state: 'public' });
    const stranger = await createUser({ withChannel: true });
    const foreign = await createVideo(stranger.channel!.id, { state: 'draft' });

    const result = await bulkVideosAction({ action: 'publish', ids: [draftA.id, draftB.id, scheduled.id, processing.id, published.id, foreign.id, 'AAAAAAAAAAA'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.done.sort()).toEqual([draftA.id, draftB.id, scheduled.id].sort());
    const skipped = Object.fromEntries(result.data.skipped.map((s) => [s.id, s.reason]));
    expect(skipped[processing.id]).toContain('آماده');
    expect(skipped[published.id]).toContain('منتشر شده');
    // someone else's video and a missing video are indistinguishable
    expect(skipped[foreign.id]).toBe(skipped['AAAAAAAAAAA']);

    const states = await db.video.findMany({ where: { id: { in: [draftA.id, draftB.id, scheduled.id, foreign.id, processing.id] } }, select: { id: true, publishStatus: true } });
    const byId = Object.fromEntries(states.map((s) => [s.id, s.publishStatus]));
    expect(byId).toEqual({ [draftA.id]: 'PUBLISHED', [draftB.id]: 'PUBLISHED', [scheduled.id]: 'PUBLISHED', [foreign.id]: 'DRAFT', [processing.id]: 'DRAFT' });
    expect(await db.notification.count({ where: { userId: follower.id, type: 'NEW_VIDEO' } })).toBe(3);
  });

  it('changes visibility for many videos at once', async () => {
    const owner = await creator();
    const ids = (await Promise.all([1, 2, 3].map(() => createVideo(owner.channel!.id, { state: 'public' })))).map((v) => v.id);
    const other = await createUser({ withChannel: true });
    const foreign = await createVideo(other.channel!.id, { state: 'public' });
    const result = await bulkVideosAction({ action: 'visibility', ids: [...ids, foreign.id], visibility: 'PRIVATE' });
    expect(result).toMatchObject({ ok: true, data: { done: expect.arrayContaining(ids), skipped: [{ id: foreign.id }] } });
    expect(await db.video.count({ where: { id: { in: ids }, visibility: 'PRIVATE' } })).toBe(3);
    expect((await db.video.findUniqueOrThrow({ where: { id: foreign.id } })).visibility).toBe('PUBLIC');
    expect((await loadVideoAccess(ids[0]!))?.visibility).toBe('PRIVATE');
  });

  it('deletes many videos (own only) and queues their cleanup', async () => {
    const owner = await creator();
    const mine = await Promise.all([1, 2].map(() => createVideo(owner.channel!.id)));
    const other = await createUser({ withChannel: true });
    const foreign = await createVideo(other.channel!.id);
    const result = await bulkVideosAction({ action: 'delete', ids: [...mine.map((v) => v.id), foreign.id] });
    expect(result).toMatchObject({ ok: true, data: { done: expect.arrayContaining(mine.map((v) => v.id)) } });
    expect(await db.video.count({ where: { id: { in: mine.map((v) => v.id) } } })).toBe(0);
    expect(await db.video.count({ where: { id: foreign.id } })).toBe(1);
    expect(await getQueue('maintenance').getJobCounts('waiting')).toEqual({ waiting: 2 });
  });

  it('validates its input: unknown actions, empty and oversized selections, bad ids', async () => {
    await creator();
    expect(fail(await bulkVideosAction({ action: 'ban', ids: ['aB3dE5gH7jK'] })).code).toBe('VALIDATION');
    expect(fail(await bulkVideosAction({ action: 'delete', ids: [] })).code).toBe('VALIDATION');
    expect(fail(await bulkVideosAction({ action: 'delete', ids: Array.from({ length: 51 }, (_, i) => `aB3dE5gH7j${i % 10}`) })).code).toBe('VALIDATION');
    expect(fail(await bulkVideosAction({ action: 'delete', ids: ['not an id'] })).code).toBe('VALIDATION');
    expect(fail(await bulkVideosAction({ action: 'visibility', ids: ['aB3dE5gH7jK'], visibility: 'SECRET' })).code).toBe('VALIDATION');
  });

  it('requires a signed-in creator and is rate limited', async () => {
    logout();
    expect(fail(await bulkVideosAction({ action: 'delete', ids: ['aB3dE5gH7jK'] })).code).toBe('UNAUTHENTICATED');
    const user = await createUser();
    await loginAs(user.id);
    expect(fail(await bulkVideosAction({ action: 'delete', ids: ['aB3dE5gH7jK'] })).code).toBe('FORBIDDEN');

    await creator();
    let last: { ok: boolean; code?: string } = { ok: true };
    for (let i = 0; i < 22; i++) last = await bulkVideosAction({ action: 'publish', ids: ['aB3dE5gH7jK'] });
    expect(last).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('confirmUploadAction', () => {
  it('confirms a finished upload once; strangers get NOT_FOUND', async () => {
    const owner = await creator();
    const id = (await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p', processingStatus: 'AWAITING_UPLOAD' })).id;
    await db.transcodeJob.deleteMany({ where: { videoId: id } });

    await creator();
    expect(fail(await confirmUploadAction({ id })).code).toBe('NOT_FOUND');

    await loginAs(owner.id);
    expect(await confirmUploadAction({ id })).toEqual({ ok: true, data: { status: 'queued' } });
    expect(await confirmUploadAction({ id })).toEqual({ ok: true, data: { status: 'already' } });
    expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ processingStatus: 'QUEUED' });
  });

  it('moderators cannot complete somebody else’s upload', async () => {
    const owner = await creator();
    const id = (await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p', processingStatus: 'AWAITING_UPLOAD' })).id;
    const moderator = await createUser({ role: 'MODERATOR', withChannel: true });
    await loginAs(moderator.id);
    expect(fail(await confirmUploadAction({ id })).code).toBe('NOT_FOUND');
  });
});
