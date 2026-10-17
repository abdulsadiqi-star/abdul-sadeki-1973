/**
 * The S3 path, for real: S3 storage driver, tus S3 store (multipart), the pipeline writing to a bucket and
 * `MEDIA_DELIVERY=redirect` — against an S3 emulator (moto).
 *
 *   pip install 'moto[server]' && moto_server -p 5555        (S3_TEST_ENDPOINT overrides the address)
 *
 * The whole file is skipped when no emulator answers, so the suite stays green on machines without one.
 */
import { Readable } from 'node:stream';
import { NextRequest } from 'next/server';
import {
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { ENDPOINT, BUCKET } = vi.hoisted(() => {
  const endpoint = process.env.S3_TEST_ENDPOINT ?? 'http://127.0.0.1:5555';
  const bucket = `tg-it-${process.pid}-${Date.now().toString(36)}`;
  process.env.STORAGE_DRIVER = 's3';
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_BUCKET = bucket;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY_ID = 'test';
  process.env.S3_SECRET_ACCESS_KEY = 'test';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.UPLOAD_MAX_BYTES = String(100 * 1024 * 1024);
  process.env.UPLOAD_DAILY_QUOTA_BYTES = String(500 * 1024 * 1024);
  process.env.UPLOAD_MAX_PER_DAY = '50';
  process.env.TRANSCODE_PRESET = 'ultrafast';
  return { ENDPOINT: endpoint, BUCKET: bucket };
});

import { db } from '@/lib/db';
import { resetEnvCache } from '@/lib/env';
import { closeQueues } from '@/lib/queue';
import { contentTypeForKey, getStorage, keys, type S3Storage } from '@/lib/storage';
import { closeTusServer } from '@/features/uploads/tus';
import { clearVideoAccessCache } from '@/features/videos/media-access';
import { GET as mediaGet } from '@/app/media/[...key]/route';
import { purgeStaleUploads } from '../../worker/jobs/housekeeping';
import { processVideo } from '../../worker/pipeline/process-video';
import { createUser } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { createReadyVideo, createUploadedVideo } from '../helpers/media';
import { bytesOf, tusCreate, tusDelete, tusHead, tusPatch, videoIdFrom } from '../helpers/tus';

const reachable = await fetch(ENDPOINT, { signal: AbortSignal.timeout(2_000) }).then(
  (r) => r.status < 500,
  () => false,
);

const s3 = () => getStorage() as S3Storage;
const read = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
};

describe.skipIf(!reachable)('S3 emulator', () => {
  beforeAll(async () => {
    expect(getStorage().kind).toBe('s3');
    await s3().client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }, 30_000);

  afterAll(async () => {
    try {
      await s3().deletePrefix('');
    } catch {
      /* best effort */
    }
    await s3().client.send(new DeleteBucketCommand({ Bucket: BUCKET })).catch(() => undefined);
    await closeTusServer();
    await closeQueues();
  });

  describe('storage driver', () => {
    it('stores, reads (full and ranges), lists and deletes objects with correct content types', async () => {
      const storage = getStorage();
      await storage.put('videos/AAAAAAAAAAA/hls/master.m3u8', '#EXTM3U\n');
      await storage.put('videos/AAAAAAAAAAA/hls/720p/seg_00000.ts', Buffer.from(bytesOf(2048)), { cacheControl: 'public, max-age=31536000, immutable' });
      await storage.put('videos/AAAAAAAAAAA/thumbs/auto_1.jpg', Buffer.from('jpg'));

      const master = await storage.head('videos/AAAAAAAAAAA/hls/master.m3u8');
      expect(master).toMatchObject({ size: 8, contentType: 'application/vnd.apple.mpegurl' });
      expect((await storage.head('videos/AAAAAAAAAAA/hls/720p/seg_00000.ts'))?.contentType).toBe('video/mp2t');
      expect((await storage.head('videos/AAAAAAAAAAA/thumbs/auto_1.jpg'))?.contentType).toBe('image/jpeg');
      expect(await storage.head('videos/AAAAAAAAAAA/nope')).toBeNull();
      expect(await storage.get('videos/AAAAAAAAAAA/nope')).toBeNull();

      const full = await storage.get('videos/AAAAAAAAAAA/hls/720p/seg_00000.ts');
      expect(await read(full!.stream)).toEqual(Buffer.from(bytesOf(2048)));
      const part = await storage.get('videos/AAAAAAAAAAA/hls/720p/seg_00000.ts', { start: 100, end: 199 });
      expect(part!.range).toEqual({ start: 100, end: 199, total: 2048 });
      expect(await read(part!.stream)).toEqual(Buffer.from(bytesOf(2048)).subarray(100, 200));
      await expect(storage.get('videos/AAAAAAAAAAA/hls/720p/seg_00000.ts', { start: 5000, end: 6000 })).rejects.toMatchObject({ code: 'RANGE_NOT_SATISFIABLE' });

      expect((await storage.list('videos/AAAAAAAAAAA/')).map((o) => o.key).sort()).toEqual([
        'videos/AAAAAAAAAAA/hls/720p/seg_00000.ts',
        'videos/AAAAAAAAAAA/hls/master.m3u8',
        'videos/AAAAAAAAAAA/thumbs/auto_1.jpg',
      ]);
      expect(await storage.deletePrefix('videos/AAAAAAAAAAA/hls/')).toBe(2);
      expect(await storage.list('videos/AAAAAAAAAAA/')).toHaveLength(1);
      await storage.delete('videos/AAAAAAAAAAA/thumbs/auto_1.jpg');
      await storage.delete('videos/AAAAAAAAAAA/thumbs/auto_1.jpg'); // deleting a missing key is fine
      expect(await storage.list('videos/AAAAAAAAAAA/')).toHaveLength(0);
    });

    it('uploads big files from disk / streams with multipart and downloads them back', async () => {
      const storage = getStorage();
      const big = Buffer.from(bytesOf(9 * 1024 * 1024 + 123));
      await storage.put('videos/BBBBBBBBBBB/hls/720p/big.ts', Readable.from(big));
      expect((await storage.head('videos/BBBBBBBBBBB/hls/720p/big.ts'))?.size).toBe(big.length);

      const os = await import('node:os');
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const tmp = path.join(os.tmpdir(), `tg-s3-${process.pid}.bin`);
      await storage.getToFile('videos/BBBBBBBBBBB/hls/720p/big.ts', tmp);
      expect((await fs.stat(tmp)).size).toBe(big.length);
      expect(Buffer.compare(await fs.readFile(tmp), big)).toBe(0); // (toEqual on 9 MB buffers is glacial)
      await fs.rm(tmp);
      await storage.deletePrefix('videos/BBBBBBBBBBB/');
    }, 60_000);

    it('presigned URLs fetch the object directly and carry the stored headers', async () => {
      const storage = getStorage();
      await storage.put('videos/CCCCCCCCCCC/hls/720p/seg_00000.ts', Buffer.from(bytesOf(512)), { cacheControl: 'public, max-age=31536000, immutable' });
      const url = await storage.presignGet('videos/CCCCCCCCCCC/hls/720p/seg_00000.ts', 120);
      expect(url).toContain('X-Amz-Signature');
      expect(url).toContain('X-Amz-Expires=120');
      const res = await fetch(url!);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp2t');
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(bytesOf(512)));
      const ranged = await fetch(url!, { headers: { Range: 'bytes=0-9' } });
      expect(ranged.status).toBe(206);
      await storage.deletePrefix('videos/CCCCCCCCCCC/');
    });

    it('aborts unfinished multipart uploads (S3 would keep and bill the parts)', async () => {
      const client = s3().client;
      for (const key of ['uploads/DDDDDDDDDDD', 'uploads/EEEEEEEEEEE', 'other/FFFFFFFFFFF']) {
        await client.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key }));
      }
      expect(await s3().abortIncompleteUploads('uploads/')).toBe(2);
      const left = await client.send(new ListMultipartUploadsCommand({ Bucket: BUCKET }));
      expect((left.Uploads ?? []).map((u) => u.Key)).toEqual(['other/FFFFFFFFFFF']);
      expect(await s3().abortIncompleteUploads('other/')).toBe(1);
      expect(await s3().abortIncompleteUploads('uploads/')).toBe(0); // idempotent
    });
  });

  describe('tus on the S3 store (multipart)', () => {
    async function creator() {
      const user = await createUser({ withChannel: true });
      await loginAs(user.id);
      return user;
    }

    it('uploads 13 MB in three PATCHes, resumes via HEAD and lands intact at uploads/<videoId>', async () => {
      await creator();
      const size = 13 * 1000 * 1000;
      const bytes = bytesOf(size);
      const created = await tusCreate({ size, filename: 'big.mp4', filetype: 'video/mp4' });
      expect(created.status).toBe(201);
      const id = videoIdFrom(created);

      expect((await tusPatch(id, 0, bytes.subarray(0, 6_000_000))).status).toBe(204);
      // a "returning client" asks where to continue
      const head = await tusHead(id);
      expect(head.headers.get('upload-offset')).toBe('6000000');
      expect(head.headers.get('upload-length')).toBe(String(size));
      expect((await tusPatch(id, 6_000_000, bytes.subarray(6_000_000, 12_000_000))).status).toBe(204);
      const last = await tusPatch(id, 12_000_000, bytes.subarray(12_000_000));
      expect(last.status).toBe(204);
      expect(last.headers.get('upload-offset')).toBe(String(size));

      const object = await getStorage().get(keys.upload(id));
      expect(object!.info.size).toBe(size);
      expect(Buffer.compare(await read(object!.stream), Buffer.from(bytes))).toBe(0);
      expect(await getStorage().head(`${keys.upload(id)}.info`)).not.toBeNull(); // tus state lives next to it
      expect(await db.video.findUniqueOrThrow({ where: { id } })).toMatchObject({ processingStatus: 'QUEUED', sourceKey: keys.upload(id) });
      expect(await db.transcodeJob.count({ where: { videoId: id } })).toBe(1);
      // the finished object is typed as video (tus passes our server-derived MIME to S3)
      const headObject = await s3().client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keys.upload(id) }));
      expect(headObject.ContentType).toBe('video/mp4');
    }, 120_000);

    it('handles chunks smaller than the S3 minimum part size (kept as an incomplete part, then merged)', async () => {
      await creator();
      const size = 7 * 1000 * 1000;
      const bytes = bytesOf(size);
      const id = videoIdFrom(await tusCreate({ size }));
      expect((await tusPatch(id, 0, bytes.subarray(0, 1_000_000))).status).toBe(204);
      expect((await tusHead(id)).headers.get('upload-offset')).toBe('1000000');
      expect((await tusPatch(id, 1_000_000, bytes.subarray(1_000_000, 2_500_000))).status).toBe(204);
      expect((await tusPatch(id, 2_500_000, bytes.subarray(2_500_000))).status).toBe(204);
      const object = await getStorage().get(keys.upload(id));
      expect(Buffer.compare(await read(object!.stream), Buffer.from(bytes))).toBe(0);
    }, 120_000);

    it('cancelling aborts the multipart upload and removes every object', async () => {
      await creator();
      const size = 8_000_000;
      const id = videoIdFrom(await tusCreate({ size }));
      expect((await tusPatch(id, 0, bytesOf(6_000_000))).status).toBe(204);
      expect((await tusDelete(id)).status).toBe(204);
      await vi.waitFor(async () => expect(await db.video.count({ where: { id } })).toBe(0), { timeout: 10_000 });
      const left = await s3().client.send(new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: `uploads/${id}` }));
      expect(left.Uploads ?? []).toHaveLength(0);
      expect(await getStorage().head(`${keys.upload(id)}.info`)).toBeNull();
      expect((await tusHead(id)).status).toBe(404);
    });

    it('another creator can neither read nor write somebody else’s multipart upload', async () => {
      await creator();
      const id = videoIdFrom(await tusCreate({ size: 6_000_000 }));
      expect((await tusPatch(id, 0, bytesOf(1_000_000))).status).toBe(204);
      await creator();
      expect((await tusHead(id)).status).toBe(404);
      expect((await tusPatch(id, 1_000_000, bytesOf(10))).status).toBe(404);
      expect((await tusDelete(id)).status).toBe(404);
    });

    it('stale unfinished uploads are purged and their multipart uploads aborted', async () => {
      await creator();
      const id = videoIdFrom(await tusCreate({ size: 8_000_000 }));
      expect((await tusPatch(id, 0, bytesOf(6_000_000))).status).toBe(204);
      await db.video.update({ where: { id }, data: { createdAt: new Date(Date.now() - 60 * 3_600_000) } });
      expect(await purgeStaleUploads()).toEqual({ purged: 1 });
      const left = await s3().client.send(new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: `uploads/${id}` }));
      expect(left.Uploads ?? []).toHaveLength(0);
      expect(await getStorage().head(`${keys.upload(id)}.info`)).toBeNull();
    });
  });

  describe('pipeline on S3', () => {
    it(
      'reads the source from the bucket and writes HLS with the right content types and cache headers',
      async () => {
        const owner = await createUser({ withChannel: true });
        const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-720p' });
        expect(await processVideo(id)).toMatchObject({ status: 'ready', renditions: ['720p', '480p', '360p'] });

        const head = async (key: string) => s3().client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        const master = await head(keys.hlsMaster(id));
        expect(master.ContentType).toBe('application/vnd.apple.mpegurl');
        expect(master.CacheControl).toBe('public, max-age=30');
        const playlist = await getStorage().get(keys.hlsRenditionPlaylist(id, 720));
        const segmentName = (await read(playlist!.stream)).toString().split('\n').find((l) => l.endsWith('.ts'))!;
        const segment = await head(`${keys.hlsRenditionPrefix(id, 720)}${segmentName}`);
        expect(segment.ContentType).toBe('video/mp2t');
        expect(segment.CacheControl).toBe('public, max-age=31536000, immutable');
        const video = await db.video.findUniqueOrThrow({ where: { id } });
        expect((await head(video.posterKey!)).ContentType).toBe('image/jpeg');
        expect((await getStorage().list(`videos/${id}/`)).length).toBeGreaterThan(10);
      },
      120_000,
    );
  });

  describe('media delivery on S3', () => {
    const get = (key: string, headers: Record<string, string> = {}) =>
      mediaGet(new NextRequest(`http://localhost:3000/media/${key}`, { headers }), { params: Promise.resolve({ key: key.split('/') }) });

    async function publishedVideoOnS3(state: 'public' | 'private' = 'public') {
      const owner = await createUser({ withChannel: true });
      const video = await createReadyVideo(owner.channel!.id, { state });
      const segment = Buffer.from(bytesOf(3000));
      await getStorage().put(`videos/${video.id}/hls/720p/seg_00000.ts`, segment);
      await getStorage().put(keys.hlsRenditionPlaylist(video.id, 720), '#EXTM3U\n#EXTINF:6,\nseg_00000.ts\n#EXT-X-ENDLIST\n');
      logout();
      clearVideoAccessCache();
      return { owner, video, segment, segmentKey: `videos/${video.id}/hls/720p/seg_00000.ts` };
    }

    const useMode = (mode: 'proxy' | 'redirect') => {
      process.env.MEDIA_DELIVERY = mode;
      resetEnvCache();
    };

    it('proxy mode streams everything through the app (with ranges)', async () => {
      useMode('proxy');
      const { video, segment, segmentKey } = await publishedVideoOnS3();
      const master = await get(keys.hlsMaster(video.id));
      expect(master.status).toBe(200);
      expect(master.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
      const ranged = await get(segmentKey, { range: 'bytes=10-19' });
      expect(ranged.status).toBe(206);
      expect(Buffer.from(await ranged.arrayBuffer())).toEqual(segment.subarray(10, 20));
    });

    it('redirect mode: segments are answered with a 302 to a short-lived presigned URL that really works', async () => {
      useMode('redirect');
      const { video, segment, segmentKey } = await publishedVideoOnS3();

      const res = await get(segmentKey);
      expect(res.status).toBe(302);
      const location = res.headers.get('location')!;
      expect(location.startsWith(ENDPOINT)).toBe(true);
      expect(location).toContain(segmentKey);
      expect(location).toContain('X-Amz-Signature');
      expect(location).toContain('X-Amz-Expires=300');
      expect(res.headers.get('cache-control')).toBe('private, max-age=240'); // never longer than the signature
      expect(await res.text()).toBe('');

      const followed = await fetch(location);
      expect(followed.status).toBe(200);
      expect(Buffer.from(await followed.arrayBuffer())).toEqual(segment);
      expect((await fetch(location, { headers: { Range: 'bytes=0-9' } })).status).toBe(206);

      // playlists, posters, thumbnails and subtitles are still streamed by the app
      for (const key of [keys.hlsMaster(video.id), keys.hlsRenditionPlaylist(video.id, 720), video.posterKey!, keys.autoThumb(video.id, 1)]) {
        const direct = await get(key);
        expect(direct.status, key).toBe(200);
        expect(direct.headers.get('location'), key).toBeNull();
      }
      useMode('proxy');
    });

    it('redirect mode keeps the visibility rules: nothing is presigned for videos the viewer may not see', async () => {
      useMode('redirect');
      const { owner, segmentKey } = await publishedVideoOnS3('private');

      const anonymous = await get(segmentKey);
      expect(anonymous.status).toBe(404);
      expect(anonymous.headers.get('location')).toBeNull();

      await loginAs((await createUser({ withChannel: true })).id);
      clearVideoAccessCache();
      expect((await get(segmentKey)).status).toBe(404);

      await loginAs(owner.id);
      clearVideoAccessCache();
      const mine = await get(segmentKey);
      expect(mine.status).toBe(302);
      expect(mine.headers.get('cache-control')).toBe('private, no-store');
      useMode('proxy');
    });

    it('redirect mode never exposes the raw upload either', async () => {
      useMode('redirect');
      const { video } = await publishedVideoOnS3();
      await getStorage().put(keys.upload(video.id), Buffer.from('raw'));
      expect((await get(keys.upload(video.id))).status).toBe(404);
      useMode('proxy');
    });

    it('works with a bucket CORS rule for the site origin (needed by hls.js in redirect mode)', async () => {
      await s3().client.send(
        new PutBucketCorsCommand({
          Bucket: BUCKET,
          CORSConfiguration: { CORSRules: [{ AllowedOrigins: ['http://localhost:3000'], AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['Content-Range', 'Content-Length', 'ETag'], MaxAgeSeconds: 3600 }] },
        }),
      );
      useMode('redirect');
      const { segmentKey } = await publishedVideoOnS3();
      const location = (await get(segmentKey)).headers.get('location')!;
      const res = await fetch(location, { headers: { Origin: 'http://localhost:3000' } });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(contentTypeForKey(segmentKey)).toBe('video/mp2t');
      useMode('proxy');
    });
  });
});

if (!reachable) {
  describe('S3 emulator', () => {
    it.skip(`not reachable at ${ENDPOINT} — start one with: moto_server -p 5555`, () => undefined);
  });
}
