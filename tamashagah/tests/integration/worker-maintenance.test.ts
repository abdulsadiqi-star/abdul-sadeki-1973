/**
 * Maintenance jobs: scheduled publishing, stale uploads, auth purge, counter reconciliation, cleanup, orphaned
 * queue jobs, and the BullMQ scheduler registration.
 */
import fs from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import type { Job } from 'bullmq';
import { db, type Prisma } from '@/lib/db';
import { newVideoId, randomToken, sha256Hex } from '@/lib/ids';
import { closeQueues, enqueueVideoProcessing, getQueue, JOB_NAMES } from '@/lib/queue';
import { getStorage, keys } from '@/lib/storage';
import { publishDueScheduledVideos } from '@/features/videos-studio/publishing';
import { cleanupVideoFiles, purgeExpiredAuth, purgeStaleUploads, requeueOrphanedVideos } from '../../worker/jobs/housekeeping';
import { MAINTENANCE_SCHEDULES, processMaintenanceJob, registerMaintenanceSchedulers } from '../../worker/jobs/maintenance';
import { reconcileCounters } from '../../worker/jobs/reconcile';
import { createUser, createVideo } from '../helpers/factories';
import { storagePath } from '../helpers/media';

afterAll(async () => {
  await closeQueues();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const hoursAgo = (h: number) => minutesAgo(h * 60);

describe('scheduled publishing', () => {
  async function scheduled(channelId: string, scheduledFor: Date, extra: Parameters<typeof db.video.update>[0]['data'] = {}) {
    const video = await createVideo(channelId, { state: 'scheduled' });
    return db.video.update({ where: { id: video.id }, data: { scheduledFor, ...extra } });
  }

  it('flips due, READY videos to PUBLISHED exactly once and notifies the creator and the followers', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const follower = await createUser();
    const muted = await createUser();
    await db.follow.create({ data: { userId: follower.id, channelId, notify: true } });
    await db.follow.create({ data: { userId: muted.id, channelId, notify: false } });

    const due = await scheduled(channelId, minutesAgo(1)); // "past + 1 minute"
    const later = await scheduled(channelId, new Date(Date.now() + 3_600_000));
    const stillProcessing = await scheduled(channelId, minutesAgo(5), { processingStatus: 'PROCESSING' });

    expect(await publishDueScheduledVideos()).toBe(1);

    const flipped = await db.video.findUniqueOrThrow({ where: { id: due.id } });
    expect(flipped).toMatchObject({ publishStatus: 'PUBLISHED', scheduledFor: null });
    expect(Math.abs(flipped.publishedAt!.getTime() - Date.now())).toBeLessThan(10_000);
    expect((await db.video.findUniqueOrThrow({ where: { id: later.id } })).publishStatus).toBe('SCHEDULED');
    expect((await db.video.findUniqueOrThrow({ where: { id: stillProcessing.id } })).publishStatus).toBe('SCHEDULED');

    const ownerNotes = await db.notification.findMany({ where: { userId: owner.id } });
    expect(ownerNotes).toMatchObject([{ type: 'VIDEO_PUBLISHED', videoId: due.id, href: `/watch/${due.id}` }]);
    const followerNotes = await db.notification.findMany({ where: { userId: follower.id } });
    expect(followerNotes).toMatchObject([{ type: 'NEW_VIDEO', videoId: due.id, channelId }]);
    expect(await db.notification.count({ where: { userId: muted.id } })).toBe(0);

    // idempotent: a second run (or a concurrent one) does nothing
    expect(await publishDueScheduledVideos()).toBe(0);
    expect(await db.notification.count({ where: { type: 'NEW_VIDEO' } })).toBe(1);
  });

  it('a private scheduled video is published but not announced', async () => {
    const owner = await createUser({ withChannel: true });
    const follower = await createUser();
    await db.follow.create({ data: { userId: follower.id, channelId: owner.channel!.id, notify: true } });
    const video = await scheduled(owner.channel!.id, minutesAgo(2), { visibility: 'PRIVATE' });
    expect(await publishDueScheduledVideos()).toBe(1);
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).publishStatus).toBe('PUBLISHED');
    expect(await db.notification.count({ where: { userId: follower.id } })).toBe(0);
  });

  it('handles more than one batch of due videos', async () => {
    const owner = await createUser({ withChannel: true });
    for (let i = 0; i < 5; i++) await scheduled(owner.channel!.id, minutesAgo(10 - i));
    expect(await publishDueScheduledVideos(new Date(), 3)).toBe(3);
    expect(await publishDueScheduledVideos(new Date(), 3)).toBe(2);
    expect(await db.video.count({ where: { publishStatus: 'PUBLISHED' } })).toBe(5);
  });
});

describe('stale uploads', () => {
  it('purges abandoned AWAITING_UPLOAD videos older than UPLOAD_STALE_HOURS, with their files', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const storage = getStorage();

    const mk = async (state: 'AWAITING_UPLOAD' | 'QUEUED', createdAt: Date) => {
      const id = newVideoId();
      await db.video.create({
        data: { id, channelId, title: 'x', processingStatus: state, publishStatus: 'DRAFT', createdAt },
      });
      await storage.put(keys.upload(id), Buffer.from('partial bytes'));
      await storage.put(`${keys.upload(id)}.json`, '{}');
      return id;
    };
    const stale = await mk('AWAITING_UPLOAD', hoursAgo(49));
    const fresh = await mk('AWAITING_UPLOAD', hoursAgo(47));
    const oldButQueued = await mk('QUEUED', hoursAgo(100)); // finished uploads are never purged

    expect(await purgeStaleUploads()).toEqual({ purged: 1 });
    expect(await db.video.findUnique({ where: { id: stale } })).toBeNull();
    await expect(fs.stat(storagePath(keys.upload(stale)))).rejects.toThrow();
    await expect(fs.stat(storagePath(`${keys.upload(stale)}.json`))).rejects.toThrow();
    expect(await db.video.findUnique({ where: { id: fresh } })).not.toBeNull();
    expect(await db.video.findUnique({ where: { id: oldButQueued } })).not.toBeNull();
    expect(await storage.head(keys.upload(fresh))).not.toBeNull();
    expect(await purgeStaleUploads()).toEqual({ purged: 0 });
  });
});

describe('auth tables', () => {
  it('purges expired / revoked sessions and expired / used e-mail tokens, keeps live ones', async () => {
    const user = await createUser();
    const session = (over: Partial<Prisma.SessionUncheckedCreateInput>) =>
      db.session.create({
        data: { userId: user.id, tokenHash: sha256Hex(randomToken()), expiresAt: new Date(Date.now() + 86_400_000), ...over },
      });
    const live = await session({});
    await session({ expiresAt: minutesAgo(5) });
    await session({ revokedAt: minutesAgo(5) });
    await session({ createdAt: new Date(Date.now() - 200 * 86_400_000) }); // beyond the absolute lifetime

    const token = (over: Partial<Prisma.EmailTokenUncheckedCreateInput>) =>
      db.emailToken.create({
        data: { userId: user.id, type: 'VERIFY_EMAIL', tokenHash: sha256Hex(randomToken()), expiresAt: new Date(Date.now() + 86_400_000), ...over },
      });
    const liveToken = await token({});
    await token({ expiresAt: new Date(Date.now() - 3 * 86_400_000) });
    await token({ usedAt: new Date(Date.now() - 10 * 86_400_000) });
    const justExpired = await token({ expiresAt: minutesAgo(30) }); // kept for a day so the UI can say "expired"

    expect(await purgeExpiredAuth()).toEqual({ sessions: 3, emailTokens: 2 });
    expect((await db.session.findMany()).map((s) => s.id)).toEqual([live.id]);
    expect((await db.emailToken.findMany({ orderBy: { createdAt: 'asc' } })).map((t) => t.id)).toEqual([liveToken.id, justExpired.id]);
  });
});

describe('counter reconciliation', () => {
  it('fixes manually corrupted counters from the rows (approved comments only)', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const viewer = await createUser();
    const video = await createVideo(channelId);
    const other = await createVideo(channelId);

    // real rows: 3 likes, 2 followers, 4 views, comments: 2 approved top-level + 1 approved reply + pending/spam/deleted
    const likers = await Promise.all([createUser(), createUser(), createUser()]);
    await db.videoLike.createMany({ data: likers.map((u) => ({ userId: u.id, videoId: video.id })) });
    await db.follow.createMany({ data: [viewer.id, likers[0]!.id].map((userId) => ({ userId, channelId })) });
    await db.viewEvent.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({ videoId: video.id, channelId, viewerKey: `k${i}`, source: i === 0 ? ('SEED' as const) : ('REAL' as const) })),
    });
    const root = await db.comment.create({ data: { videoId: video.id, authorId: viewer.id, body: 'اول' } });
    await db.comment.create({ data: { videoId: video.id, authorId: viewer.id, body: 'دوم' } });
    await db.comment.create({ data: { videoId: video.id, authorId: likers[0]!.id, body: 'پاسخ', parentId: root.id, rootId: root.id } });
    for (const status of ['PENDING', 'SPAM', 'DELETED', 'REJECTED'] as const) {
      await db.comment.create({ data: { videoId: video.id, authorId: viewer.id, body: status, status, parentId: root.id, rootId: root.id } });
    }

    // corrupt everything (and give the untouched video wrong numbers too)
    await db.video.update({ where: { id: video.id }, data: { likeCount: 99, commentCount: 99, viewCount: 99 } });
    await db.video.update({ where: { id: other.id }, data: { likeCount: 5, commentCount: 7, viewCount: 11 } });
    await db.comment.update({ where: { id: root.id }, data: { replyCount: 42 } });
    await db.channel.update({ where: { id: channelId }, data: { followerCount: 1000 } });

    const report = await reconcileCounters();
    expect(report).toEqual({ videoLikes: 2, videoComments: 2, videoViews: 2, commentReplies: 1, channelFollowers: 1 });

    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ likeCount: 3, commentCount: 3, viewCount: 4 });
    expect(await db.video.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ likeCount: 0, commentCount: 0, viewCount: 0 });
    expect((await db.comment.findUniqueOrThrow({ where: { id: root.id } })).replyCount).toBe(1);
    expect((await db.channel.findUniqueOrThrow({ where: { id: channelId } })).followerCount).toBe(2);

    // second run: nothing left to fix
    expect(await reconcileCounters()).toEqual({ videoLikes: 0, videoComments: 0, videoViews: 0, commentReplies: 0, channelFollowers: 0 });
  });
});

describe('video.cleanup', () => {
  it('deletes the processed outputs and the raw upload of a deleted video', async () => {
    const storage = getStorage();
    const id = newVideoId();
    await storage.put(keys.hlsMaster(id), '#EXTM3U\n');
    await storage.put(keys.hlsRenditionPlaylist(id, 720), '#EXTM3U\n');
    await storage.put(keys.autoThumb(id, 1), Buffer.from('jpg'));
    await storage.put(keys.upload(id), Buffer.from('source'));
    await storage.put(`${keys.upload(id)}.json`, '{}');
    const bystander = newVideoId();
    await storage.put(keys.hlsMaster(bystander), '#EXTM3U\n');

    expect(await cleanupVideoFiles(id)).toEqual({ skipped: false });
    expect(await storage.list(`videos/${id}/`)).toHaveLength(0);
    expect(await storage.head(keys.upload(id))).toBeNull();
    expect(await storage.head(`${keys.upload(id)}.json`)).toBeNull();
    expect(await storage.head(keys.hlsMaster(bystander))).not.toBeNull(); // other videos untouched
    expect(await cleanupVideoFiles(id)).toEqual({ skipped: false }); // idempotent
  });

  it('refuses to touch a video that still exists', async () => {
    const owner = await createUser({ withChannel: true });
    const video = await createVideo(owner.channel!.id);
    const storage = getStorage();
    await storage.put(keys.hlsMaster(video.id), '#EXTM3U\n');
    expect(await cleanupVideoFiles(video.id)).toEqual({ skipped: true });
    expect(await storage.head(keys.hlsMaster(video.id))).not.toBeNull();
  });
});

describe('orphaned queue jobs', () => {
  async function queuedVideo(channelId: string, updatedAt: Date) {
    const video = await createVideo(channelId, { state: 'processing' });
    await db.video.update({ where: { id: video.id }, data: { processingStatus: 'QUEUED' } });
    await db.$executeRaw`UPDATE "Video" SET "updatedAt" = ${updatedAt} WHERE "id" = ${video.id}`;
    return video;
  }

  it('enqueues QUEUED videos whose queue job is gone, and leaves healthy ones alone', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const lost = await queuedVideo(channelId, minutesAgo(30)); // upload finished, enqueue failed
    const healthy = await queuedVideo(channelId, minutesAgo(30));
    const recent = await queuedVideo(channelId, minutesAgo(1)); // not old enough to judge

    const queueJobId = await enqueueVideoProcessing(healthy.id);
    await db.transcodeJob.create({ data: { videoId: healthy.id, status: 'QUEUED', queueJobId } });

    expect(await requeueOrphanedVideos()).toEqual({ requeued: 1 });
    const job = await db.transcodeJob.findFirstOrThrow({ where: { videoId: lost.id } });
    expect(job.status).toBe('QUEUED');
    const queued = await getQueue('video').getJob(job.queueJobId!);
    expect(queued?.data).toEqual({ videoId: lost.id });
    expect(await db.transcodeJob.count({ where: { videoId: healthy.id } })).toBe(1);
    expect(await db.transcodeJob.count({ where: { videoId: recent.id } })).toBe(0);

    // the row was touched, so a second run does not enqueue it again
    expect(await requeueOrphanedVideos()).toEqual({ requeued: 0 });
    expect(await getQueue('video').getJobCounts('waiting')).toEqual({ waiting: 2 });
  });
});

describe('maintenance queue', () => {
  it('registers every scheduler (idempotently) with the documented cadence', async () => {
    const queue = getQueue('maintenance');
    await registerMaintenanceSchedulers(queue);
    await registerMaintenanceSchedulers(queue);
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual(MAINTENANCE_SCHEDULES.map((s) => s.id).sort());
    const byName = Object.fromEntries(schedulers.map((s) => [s.name, s]));
    expect(byName[JOB_NAMES.publishScheduled]!.every).toBe(60_000);
    expect(byName[JOB_NAMES.reconcileCounters]!.pattern).toBe('30 3 * * *');
    expect(byName[JOB_NAMES.purgeExpiredAuth]!.pattern).toBe('15 3 * * *');
    expect(byName[JOB_NAMES.cleanupStaleUploads]!.every).toBe(3_600_000);
  });

  it('dispatches jobs by name', async () => {
    const owner = await createUser({ withChannel: true });
    const video = await createVideo(owner.channel!.id, { state: 'scheduled' });
    await db.video.update({ where: { id: video.id }, data: { scheduledFor: minutesAgo(1) } });
    const run = (name: string, data: unknown = {}) => processMaintenanceJob({ name, data } as Job);
    expect(await run(JOB_NAMES.publishScheduled)).toEqual({ published: 1 });
    expect(await run(JOB_NAMES.reconcileCounters)).toMatchObject({ videoLikes: 0 });
    expect(await run(JOB_NAMES.cleanupVideo, { videoId: newVideoId() })).toEqual({ skipped: false });
    expect(await run('something.else')).toEqual({ ignored: true });
  });
});
