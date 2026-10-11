/**
 * The transcoding pipeline with REAL ffmpeg/ffprobe on 2–4 second generated clips, real PostgreSQL and the file
 * storage driver. No mocks: what the worker writes is read back from storage and probed.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // Short segments (so a 3 s clip yields several) and the fastest encoder preset keep the tests quick.
  process.env.HLS_SEGMENT_SECONDS = '2';
  process.env.TRANSCODE_PRESET = 'ultrafast';
});

import { db } from '@/lib/db';
import { getStorage, keys, type StorageDriver } from '@/lib/storage';
import { failureMessages } from '@/features/transcoding/errors';
import { runningChildCount } from '../../worker/pipeline/exec';
import { processVideo, type ProcessOutcome } from '../../worker/pipeline/process-video';
import { generateFixture } from '../../scripts/make-test-video.mjs';
import { createUser } from '../helpers/factories';
import { createUploadedVideo, ffprobeJson, fixture, storagePath } from '../helpers/media';

const PIPELINE_TIMEOUT = 120_000;

async function setup() {
  const owner = await createUser({ withChannel: true });
  return { owner, channelId: owner.channel!.id };
}

async function renditionDirs(videoId: string): Promise<string[]> {
  const entries = await fs.readdir(storagePath(`videos/${videoId}/hls`), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

const expectReady = (outcome: ProcessOutcome) => {
  expect(outcome.status).toBe('ready');
  if (outcome.status !== 'ready') throw new Error('not ready');
  return outcome;
};

beforeAll(async () => {
  // Generate the fixtures once, in this order, so the tests below do not race each other.
  for (const name of ['landscape-1080p', 'landscape-360p', 'landscape-240p', 'portrait-short', 'silent-720p', 'rotated-portrait', 'webm-no-duration', 'corrupt', 'truncated'] as const) {
    await fixture(name);
  }
}, 120_000);

describe('video.process: a real 1080p clip', () => {
  it(
    'produces an adaptive HLS ladder, thumbnails and consistent database state',
    async () => {
      const { owner, channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-1080p' });
      const percents: number[] = [];

      const outcome = expectReady(await processVideo(id, { onPercent: (p) => percents.push(p) }));
      expect(outcome.renditions).toEqual(['1080p', '720p', '480p', '360p']);
      expect(outcome.publishStatus).toBe('PUBLISHED'); // publishOnReady defaults to true
      expect(outcome.kind).toBe('VIDEO');

      // progress: monotonic and covers every stage window
      expect(percents).toEqual([...percents].sort((a, b) => a - b));
      expect(percents[0]).toBeLessThanOrEqual(4);
      expect(percents.some((p) => p >= 86 && p < 90)).toBe(true);
      expect(percents.some((p) => p >= 90 && p < 98)).toBe(true);
      expect(percents.at(-1)).toBe(100);

      // database
      const video = await db.video.findUniqueOrThrow({ where: { id }, include: { assets: true, jobs: true } });
      expect(video).toMatchObject({
        processingStatus: 'READY',
        publishStatus: 'PUBLISHED',
        width: 1920,
        height: 1080,
        failureReason: null,
        hlsMasterKey: `videos/${id}/hls/master.m3u8`,
      });
      expect(video.durationSeconds).toBeGreaterThan(2.5);
      expect(video.durationSeconds).toBeLessThan(3.5);
      expect(video.publishedAt).toBeInstanceOf(Date);
      expect(video.posterKey).toMatch(new RegExp(`^videos/${id}/thumbs/poster_[A-Za-z0-9_-]+\\.jpg$`));

      const byKind = (kind: string) => video.assets.filter((a) => a.kind === kind);
      expect(byKind('HLS_MASTER')).toHaveLength(1);
      expect(byKind('RENDITION').map((a) => [a.label, a.width, a.height]).sort()).toEqual(
        [
          ['1080p', 1920, 1080],
          ['360p', 640, 360],
          ['480p', 854, 480],
          ['720p', 1280, 720],
        ].sort(),
      );
      for (const r of byKind('RENDITION')) {
        expect(r.bitrateKbps).toBeGreaterThan(0);
        expect(r.codec).toMatch(/^avc1\.6400[0-9a-f]{2},mp4a\.40\.2$/);
        expect(Number(r.sizeBytes)).toBeGreaterThan(0);
      }
      expect(byKind('THUMBNAIL')).toHaveLength(3);
      expect(byKind('POSTER')).toHaveLength(1);
      expect(byKind('POSTER')[0]!.storageKey).toBe(video.posterKey);
      expect(byKind('SOURCE')).toHaveLength(0);

      const job = video.jobs[0]!;
      expect(job).toMatchObject({ status: 'COMPLETED', progress: 100, stage: 'FINALIZE', attempt: 1 });
      expect(job.finishedAt).toBeInstanceOf(Date);
      expect(job.probe).toMatchObject({ width: 1920, height: 1080, hasAudio: true });
      expect(Array.isArray(job.renditionPlan)).toBe(true);

      // storage: master playlist, every rendition playlist, segments, thumbnails, poster
      const storage = getStorage();
      const master = await fs.readFile(storagePath(`videos/${id}/hls/master.m3u8`), 'utf8');
      expect(master).toContain('#EXTM3U');
      for (const [label, resolution] of [
        ['360p', '640x360'],
        ['480p', '854x480'],
        ['720p', '1280x720'],
        ['1080p', '1920x1080'],
      ] as const) {
        expect(master).toMatch(new RegExp(`BANDWIDTH=\\d+,AVERAGE-BANDWIDTH=\\d+,RESOLUTION=${resolution},FRAME-RATE=30\\.000,CODECS="avc1\\.6400[0-9a-f]{2},mp4a\\.40\\.2",NAME="${label}"\\n${label}/index\\.m3u8`));
      }
      expect(await renditionDirs(id)).toEqual(['1080p', '360p', '480p', '720p']);
      for (const label of ['1080p', '720p', '480p', '360p']) {
        const playlist = await fs.readFile(storagePath(`videos/${id}/hls/${label}/index.m3u8`), 'utf8');
        const segments = playlist.split('\n').filter((l) => l.endsWith('.ts'));
        expect(segments.length).toBeGreaterThanOrEqual(2); // 3 s clip, 2 s segments
        for (const segment of segments) expect(await storage.head(`videos/${id}/hls/${label}/${segment}`)).not.toBeNull();
      }
      for (const n of [1, 2, 3]) expect(await storage.head(keys.autoThumb(id, n))).not.toBeNull();
      expect(await storage.head(video.posterKey!)).not.toBeNull();
      // the original is kept by default and stays private
      expect(await storage.head(keys.upload(id))).not.toBeNull();

      // the output is REALLY playable: ffprobe opens the playlist and reads video + audio from the segments
      for (const [label, w, h] of [
        ['1080p', 1920, 1080],
        ['720p', 1280, 720],
        ['480p', 854, 480],
        ['360p', 640, 360],
      ] as const) {
        const probe = await ffprobeJson(storagePath(`videos/${id}/hls/${label}/index.m3u8`));
        const v = probe.streams.find((s) => s.codec_type === 'video')!;
        const a = probe.streams.find((s) => s.codec_type === 'audio')!;
        expect([v.codec_name, v.width, v.height, v.pix_fmt, v.avg_frame_rate]).toEqual(['h264', w, h, 'yuv420p', '30/1']);
        // ultrafast disables CABAC/B-frames, so x264 writes the lowest profile that fits (never above the declared High)
        expect(['Constrained Baseline', 'Baseline', 'Main', 'High']).toContain(v.profile);
        expect([a.codec_name, a.channels]).toEqual(['aac', 2]);
        expect(Number(probe.format.duration)).toBeGreaterThan(2.5);
      }
      const poster = await ffprobeJson(storagePath(video.posterKey!));
      expect(poster.streams[0]).toMatchObject({ width: 1280, height: 720 });

      // notifications: VIDEO_READY for the owner (the video went live)
      const notes = await db.notification.findMany({ where: { userId: owner.id } });
      expect(notes.map((n) => n.type)).toEqual(['VIDEO_READY']);
      expect(notes[0]).toMatchObject({ videoId: id, href: `/watch/${id}` });
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a second run for a READY video is a no-op (idempotent)',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p' });
      expectReady(await processVideo(id));
      expect(await processVideo(id)).toEqual({ status: 'skipped', reason: 'already-ready' });
      expect(await processVideo('doesNotExist')).toEqual({ status: 'skipped', reason: 'not-found' });
    },
    PIPELINE_TIMEOUT,
  );
});

describe('video.process: rendition planning on real files (never upscale)', () => {
  it(
    'a 360p source yields exactly ONE 360p rendition',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p' });
      expect(expectReady(await processVideo(id)).renditions).toEqual(['360p']);
      expect(await renditionDirs(id)).toEqual(['360p']);
      const probe = await ffprobeJson(storagePath(`videos/${id}/hls/360p/index.m3u8`));
      expect(probe.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 640, height: 360 });
      const master = await fs.readFile(storagePath(`videos/${id}/hls/master.m3u8`), 'utf8');
      expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(1);
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a 240p source gets a single rendition at its own size',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-240p' });
      expect(expectReady(await processVideo(id)).renditions).toEqual(['240p']);
      const probe = await ffprobeJson(storagePath(`videos/${id}/hls/240p/index.m3u8`));
      expect(probe.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 426, height: 240 });
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a portrait short is classified SHORT and keeps its orientation',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'portrait-short' });
      const outcome = expectReady(await processVideo(id));
      expect(outcome.kind).toBe('SHORT');
      expect(outcome.renditions).toEqual(['720p', '480p', '360p']);
      expect((await db.video.findUniqueOrThrow({ where: { id } })).kind).toBe('SHORT');
      const probe = await ffprobeJson(storagePath(`videos/${id}/hls/480p/index.m3u8`));
      expect(probe.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 480, height: 854 });
      const poster = await ffprobeJson(storagePath((await db.video.findUniqueOrThrow({ where: { id } })).posterKey!));
      expect(poster.streams[0]).toMatchObject({ width: 720, height: 1280 });
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'an explicit creator choice of VIDEO beats the automatic SHORT detection',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'portrait-short', kindChoice: 'VIDEO' });
      expect(expectReady(await processVideo(id)).kind).toBe('VIDEO');
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'audio-less sources work: no audio stream, video-only CODECS',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'silent-720p' });
      expectReady(await processVideo(id));
      const probe = await ffprobeJson(storagePath(`videos/${id}/hls/720p/index.m3u8`));
      expect(probe.streams.some((s) => s.codec_type === 'audio')).toBe(false);
      const master = await fs.readFile(storagePath(`videos/${id}/hls/master.m3u8`), 'utf8');
      expect(master).toMatch(/CODECS="avc1\.6400[0-9a-f]{2}"/);
      expect(master).not.toContain('mp4a');
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'honours rotation metadata (640x360 coded + 90° → 360x640 on screen)',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'rotated-portrait' });
      const outcome = expectReady(await processVideo(id));
      expect(outcome.renditions).toEqual(['360p']);
      expect(outcome.kind).toBe('SHORT');
      const probe = await ffprobeJson(storagePath(`videos/${id}/hls/360p/index.m3u8`));
      expect(probe.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 360, height: 640 });
      expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ width: 360, height: 640 });
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'measures the duration of containers that do not carry one (browser-recorded WebM)',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'webm-no-duration' });
      expectReady(await processVideo(id));
      const video = await db.video.findUniqueOrThrow({ where: { id } });
      // the fixture is 3 s long; the last packet starts a frame or two before the end
      expect(video.durationSeconds).toBeGreaterThan(2.5);
      expect(video.durationSeconds).toBeLessThan(3.2);
    },
    PIPELINE_TIMEOUT,
  );
});

describe('video.process: failures', () => {
  it(
    'a corrupt file FAILS with a Persian reason, a notification and no leftovers',
    async () => {
      const { owner, channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'corrupt' });
      const outcome = await processVideo(id, { attempt: 1, maxAttempts: 3 });
      // deterministic failures are final immediately: retrying a broken file is pointless
      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') throw new Error('unreachable');
      expect(outcome.error.code).toBe('UNREADABLE');
      expect(outcome.reason).toBe(failureMessages.UNREADABLE);

      const video = await db.video.findUniqueOrThrow({ where: { id }, include: { jobs: true, assets: true } });
      expect(video).toMatchObject({ processingStatus: 'FAILED', failureReason: failureMessages.UNREADABLE, publishStatus: 'DRAFT' });
      expect(video.failureReason).toMatch(/[\u0600-\u06FF]/);
      expect(video.jobs[0]).toMatchObject({ status: 'FAILED' });
      expect(video.jobs[0]!.error).toContain('UNREADABLE');
      expect(video.jobs[0]!.error).not.toMatch(/\/tmp|\/var/); // no paths leak into the record
      expect(video.assets.filter((a) => a.kind !== 'SOURCE')).toHaveLength(0);
      expect(await getStorage().list(`videos/${id}/`)).toHaveLength(0);

      const notes = await db.notification.findMany({ where: { userId: owner.id } });
      expect(notes.map((n) => n.type)).toEqual(['VIDEO_FAILED']);
      expect(notes[0]!.body).toBe(failureMessages.UNREADABLE);
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a truncated file (missing index) fails the same way',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'truncated' });
      const outcome = await processVideo(id);
      expect(outcome).toMatchObject({ status: 'failed', error: { code: 'UNREADABLE' } });
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a non-video file is refused (no video stream or unreadable)',
    async () => {
      const { channelId } = await setup();
      const file = (await fixture('landscape-360p')).replace(/\.mp4$/, '.txt');
      await fs.writeFile(file, 'this is not a video at all, just text '.repeat(50));
      const { id } = await createUploadedVideo(channelId, { source: { file } });
      const outcome = await processVideo(id);
      expect(outcome.status).toBe('failed');
      expect(['UNREADABLE', 'NO_VIDEO_STREAM']).toContain((outcome as { error: { code: string } }).error.code);
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a missing source object fails with SOURCE_MISSING (not retried)',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p', withoutSource: true });
      const outcome = await processVideo(id, { attempt: 1, maxAttempts: 3 });
      expect(outcome).toMatchObject({ status: 'failed', error: { code: 'SOURCE_MISSING' } });
      expect((await db.video.findUniqueOrThrow({ where: { id } })).failureReason).toBe(failureMessages.SOURCE_MISSING);
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'transient storage failures are retried with attempts left and fail for good on the last attempt',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p' });
      const real = getStorage();
      // A storage whose reads fail like a network outage.
      const broken = new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'getToFile') return async () => { throw new Error('ECONNRESET to /secret/endpoint'); };
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as StorageDriver;

      const first = await processVideo(id, { storage: broken, attempt: 1, maxAttempts: 3 });
      expect(first).toMatchObject({ status: 'retry', error: { code: 'STORAGE_FAILED' } });
      let video = await db.video.findUniqueOrThrow({ where: { id }, include: { jobs: true } });
      expect(video.processingStatus).toBe('QUEUED'); // waiting for the retry
      expect(video.failureReason).toBeNull();
      expect(video.jobs[0]).toMatchObject({ status: 'QUEUED', attempt: 1 });
      expect(video.jobs[0]!.error).toContain('STORAGE_FAILED');
      expect(video.jobs[0]!.error).not.toContain('/secret');

      const last = await processVideo(id, { storage: broken, attempt: 3, maxAttempts: 3 });
      expect(last).toMatchObject({ status: 'failed', error: { code: 'STORAGE_FAILED' } });
      video = await db.video.findUniqueOrThrow({ where: { id }, include: { jobs: true } });
      expect(video).toMatchObject({ processingStatus: 'FAILED', failureReason: failureMessages.STORAGE_FAILED });
      expect(video.jobs[0]).toMatchObject({ status: 'FAILED', attempt: 3 });

      // ...and once storage works again a retry (new run) succeeds
      await db.video.update({ where: { id }, data: { processingStatus: 'QUEUED', failureReason: null } });
      await db.transcodeJob.create({ data: { videoId: id, status: 'QUEUED' } });
      expectReady(await processVideo(id));
    },
    PIPELINE_TIMEOUT,
  );
});

describe('video.process: shutdown and deletion', () => {
  it(
    'a shutdown interrupts the run: the video is QUEUED again and nothing partial is left; the next run succeeds',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-720p' });
      const controller = new AbortController();
      const outcome = await processVideo(id, {
        signal: controller.signal,
        // fire "SIGTERM" the moment the transcode stage starts
        onPercent: (p) => {
          if (p >= 4) controller.abort('shutdown');
        },
      });
      expect(outcome).toEqual({ status: 'interrupted' });
      const video = await db.video.findUniqueOrThrow({ where: { id }, include: { jobs: true } });
      expect(video.processingStatus).toBe('QUEUED');
      expect(video.jobs[0]).toMatchObject({ status: 'QUEUED' });
      expect(await getStorage().list(`videos/${id}/`)).toHaveLength(0);

      expectReady(await processVideo(id));
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a video deleted while its files are being stored cancels the run (checked again when finalizing)',
    async () => {
      const { channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-720p' });
      const real = getStorage();
      let deleted = false;
      // The creator deletes the video exactly when the first output file is uploaded.
      const storage = new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'putFile') {
            return async (...args: Parameters<StorageDriver['putFile']>) => {
              if (!deleted) {
                deleted = true;
                await db.video.delete({ where: { id } });
              }
              return target.putFile(...args);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as StorageDriver;

      expect(await processVideo(id, { storage })).toEqual({ status: 'cancelled' });
      expect(await db.video.findUnique({ where: { id } })).toBeNull();
      expect(await real.list(`videos/${id}/`)).toHaveLength(0); // the partial outputs were removed again
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a video deleted in the middle of a long transcode stops ffmpeg promptly',
    async () => {
      const { channelId } = await setup();
      const longClip = await generateFixture('landscape-720p', { dir: path.join(os.tmpdir(), 'tg-test-fixtures-long'), seconds: 40 });
      const { id } = await createUploadedVideo(channelId, { source: { file: longClip } });
      let deleted: Promise<unknown> | null = null;
      const started = Date.now();
      const outcome = await processVideo(id, {
        onPercent: (p) => {
          // first progress report from inside the transcode (p > 4): the creator hits "delete"
          // (Prisma queries are lazy: `.then` is what actually sends it)
          if (p > 4 && p < 86 && !deleted) deleted = db.video.delete({ where: { id } }).then(() => true);
        },
      });
      await deleted;
      expect(outcome).toEqual({ status: 'cancelled' });
      // noticed on the next progress write (about a second later), not after the whole encode
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(runningChildCount()).toBe(0);
      expect(await getStorage().list(`videos/${id}/`)).toHaveLength(0);
    },
    PIPELINE_TIMEOUT,
  );
});

describe('video.process: publishing rules when processing finishes', () => {
  it(
    'publishOnReady=false keeps the video a DRAFT; the creator is told it is ready',
    async () => {
      const { owner, channelId } = await setup();
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p', publishOnReady: false });
      expect(expectReady(await processVideo(id)).publishStatus).toBe('DRAFT');
      const video = await db.video.findUniqueOrThrow({ where: { id } });
      expect(video).toMatchObject({ processingStatus: 'READY', publishStatus: 'DRAFT', publishedAt: null });
      const note = await db.notification.findFirstOrThrow({ where: { userId: owner.id } });
      expect(note).toMatchObject({ type: 'VIDEO_READY', href: `/studio/videos/${id}/edit` });
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a future schedule becomes SCHEDULED, a past one is published right away',
    async () => {
      const { channelId } = await setup();
      const future = new Date(Date.now() + 3 * 3_600_000);
      const a = await createUploadedVideo(channelId, { source: 'landscape-360p', scheduledFor: future, publishOnReady: false });
      expect(expectReady(await processVideo(a.id)).publishStatus).toBe('SCHEDULED');
      expect(await db.video.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ publishStatus: 'SCHEDULED', publishedAt: null, scheduledFor: future });

      const b = await createUploadedVideo(channelId, { source: 'landscape-360p', scheduledFor: new Date(Date.now() - 60_000), publishOnReady: false });
      expect(expectReady(await processVideo(b.id)).publishStatus).toBe('PUBLISHED');
      expect(await db.video.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ publishStatus: 'PUBLISHED', scheduledFor: null });
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'a publicly published video notifies followers who kept notifications on (and only them)',
    async () => {
      const { owner, channelId } = await setup();
      const loud = await createUser();
      const quiet = await createUser();
      const stranger = await createUser();
      await db.follow.create({ data: { userId: loud.id, channelId, notify: true } });
      await db.follow.create({ data: { userId: quiet.id, channelId, notify: false } });
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p', title: 'ویدیوی تازه' });
      expectReady(await processVideo(id));

      const fanOut = await db.notification.findMany({ where: { type: 'NEW_VIDEO' } });
      expect(fanOut).toHaveLength(1);
      expect(fanOut[0]).toMatchObject({ userId: loud.id, videoId: id, channelId, href: `/watch/${id}`, actorId: owner.id, body: 'ویدیوی تازه' });
      expect(await db.notification.count({ where: { userId: { in: [quiet.id, stranger.id] } } })).toBe(0);
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'unlisted and private videos are published but NOT announced to followers',
    async () => {
      const { channelId } = await setup();
      const follower = await createUser();
      await db.follow.create({ data: { userId: follower.id, channelId, notify: true } });
      for (const visibility of ['UNLISTED', 'PRIVATE'] as const) {
        const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p', visibility });
        expect(expectReady(await processVideo(id)).publishStatus).toBe('PUBLISHED');
      }
      expect(await db.notification.count({ where: { type: 'NEW_VIDEO' } })).toBe(0);
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'fan-out reaches every follower in batches',
    async () => {
      const { channelId } = await setup();
      const followers = await Promise.all(Array.from({ length: 12 }, () => createUser()));
      await db.follow.createMany({ data: followers.map((f) => ({ userId: f.id, channelId, notify: true })) });
      const { id } = await createUploadedVideo(channelId, { source: 'landscape-360p' });
      expectReady(await processVideo(id));
      expect(await db.notification.count({ where: { type: 'NEW_VIDEO', videoId: id } })).toBe(12);
    },
    PIPELINE_TIMEOUT,
  );
});

describe('video.process: temp files', () => {
  it(
    'always removes its scratch directory, on success and on failure',
    async () => {
      const { channelId } = await setup();
      const ok = await createUploadedVideo(channelId, { source: 'landscape-360p' });
      const bad = await createUploadedVideo(channelId, { source: 'corrupt' });
      await processVideo(ok.id);
      await processVideo(bad.id);
      const leftovers = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith(`tg-${ok.id}-`) || n.startsWith(`tg-${bad.id}-`));
      expect(leftovers).toEqual([]);
    },
    PIPELINE_TIMEOUT,
  );
});
