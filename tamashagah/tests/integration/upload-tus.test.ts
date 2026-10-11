/**
 * Resumable uploads (tus) through the real route handlers: protocol, authorization, ownership, validation, quotas,
 * limits, completion → queue, cancellation. Storage is the file driver; Redis (locks, rate limits, queue) is real.
 */
import fs from 'node:fs/promises';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.UPLOAD_MAX_BYTES = '5000000'; // 5 MB
  process.env.UPLOAD_DAILY_QUOTA_BYTES = '12000000'; // 12 MB / 24 h
  process.env.UPLOAD_MAX_PER_DAY = '4';
});

import { db } from '@/lib/db';
import { closeQueues, getQueue } from '@/lib/queue';
import { getStorage, keys } from '@/lib/storage';
import { closeTusServer } from '@/features/uploads/tus';
import { completeUpload } from '@/features/uploads/service';
import { createUser } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { storagePath } from '../helpers/media';
import { bytesOf, tusCreate, tusDelete, tusGet, tusHead, tusOptions, tusPatch, uploadWholeFile, videoIdFrom } from '../helpers/tus';

afterAll(async () => {
  await closeTusServer();
  await closeQueues();
});

const body = async (res: Response) => JSON.parse(await res.text()) as { error: { code: string; message: string; retryAfterSeconds?: number } };

async function signedInCreator() {
  const user = await createUser({ withChannel: true });
  await loginAs(user.id);
  return user;
}

describe('tus: protocol basics', () => {
  it('OPTIONS advertises the protocol and the size limit without needing a session', async () => {
    const res = await tusOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('tus-version')).toBe('1.0.0');
    expect(res.headers.get('tus-max-size')).toBe('5000000');
    expect(res.headers.get('tus-extension')).toContain('creation');
    expect(res.headers.get('tus-extension')).toContain('termination');
  });

  it('creates an upload, accepts chunks in order and answers HEAD with the offset', async () => {
    const user = await signedInCreator();
    const created = await tusCreate({ size: 3000, filename: 'سفر به شمال_۱.mp4', filetype: 'video/mp4' });
    expect(created.status).toBe(201);
    expect(created.headers.get('tus-resumable')).toBe('1.0.0');
    const id = videoIdFrom(created);
    expect(created.headers.get('location')).toBe(`/api/upload/${id}`); // relative, only the 11-char video id

    // the database record exists right away and carries sane defaults
    const video = await db.video.findUniqueOrThrow({ where: { id } });
    expect(video).toMatchObject({
      channelId: user.channel!.id,
      processingStatus: 'AWAITING_UPLOAD',
      publishStatus: 'DRAFT',
      visibility: 'PUBLIC',
      publishOnReady: true,
      originalFilename: 'سفر به شمال_۱.mp4',
      title: 'سفر به شمال ۱',
      sourceMime: 'video/mp4',
    });
    expect(video.sourceSizeBytes).toBe(3000n);
    expect(video.searchTitle).toContain('سفر');

    const bytes = bytesOf(3000);
    const first = await tusPatch(id, 0, bytes.subarray(0, 1200));
    expect(first.status).toBe(204);
    expect(first.headers.get('upload-offset')).toBe('1200');

    const head = await tusHead(id);
    expect(head.status).toBe(200);
    expect(head.headers.get('upload-offset')).toBe('1200');
    expect(head.headers.get('upload-length')).toBe('3000');
    expect(head.headers.get('cache-control')).toBe('no-store');
    expect((await db.video.findUniqueOrThrow({ where: { id } })).processingStatus).toBe('AWAITING_UPLOAD');

    const second = await tusPatch(id, 1200, bytes.subarray(1200));
    expect(second.status).toBe(204);
    expect(second.headers.get('upload-offset')).toBe('3000');
    // the bytes in private storage are exactly what was sent
    expect(Buffer.from(await fs.readFile(storagePath(keys.upload(id))))).toEqual(Buffer.from(bytes));
  });

  it('rejects a chunk at the wrong offset (409) and keeps the upload intact', async () => {
    await signedInCreator();
    const id = videoIdFrom(await tusCreate({ size: 2000 }));
    const bytes = bytesOf(2000);
    expect((await tusPatch(id, 0, bytes.subarray(0, 500))).status).toBe(204);
    const wrong = await tusPatch(id, 100, bytes.subarray(100, 600));
    expect(wrong.status).toBe(409);
    expect((await tusHead(id)).headers.get('upload-offset')).toBe('500');
    // continuing from the true offset works
    expect((await tusPatch(id, 500, bytes.subarray(500))).status).toBe(204);
  });

  it('refuses more bytes than declared', async () => {
    await signedInCreator();
    const id = videoIdFrom(await tusCreate({ size: 1000 }));
    const res = await tusPatch(id, 0, bytesOf(1500));
    expect(res.status).toBe(413);
    expect((await tusHead(id)).headers.get('upload-offset')).toBe('0');
  });

  it('never serves the raw upload: GET is a 404 even for the owner', async () => {
    await signedInCreator();
    const { id } = await uploadWholeFile(1000);
    const res = await tusGet(id);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('\u0000');
  });
});

describe('tus: completion', () => {
  it('the last chunk queues the video for processing (QUEUED + TranscodeJob + queue job)', async () => {
    const user = await signedInCreator();
    const { id, last } = await uploadWholeFile(4000, { chunks: 4 });
    expect(last.headers.get('upload-offset')).toBe('4000');

    const video = await db.video.findUniqueOrThrow({ where: { id }, include: { jobs: true, assets: true } });
    expect(video).toMatchObject({ processingStatus: 'QUEUED', sourceKey: keys.upload(id), failureReason: null, channelId: user.channel!.id });
    expect(video.sourceSizeBytes).toBe(4000n);
    expect(video.jobs).toHaveLength(1);
    expect(video.jobs[0]).toMatchObject({ status: 'QUEUED', maxAttempts: 3 });
    expect(video.jobs[0]!.queueJobId).toBeTruthy();
    expect(video.assets).toMatchObject([{ kind: 'SOURCE', storageKey: keys.upload(id), mimeType: 'video/mp4', meta: { kindChoice: 'auto' } }]);

    const job = await getQueue('video').getJob(video.jobs[0]!.queueJobId!);
    expect(job?.name).toBe('video.process');
    expect(job?.data).toEqual({ videoId: id });
    expect(await job?.getState()).toBe('waiting');
  });

  it('is idempotent: confirming a finished upload again changes nothing', async () => {
    await signedInCreator();
    const { id } = await uploadWholeFile(1500);
    expect(await completeUpload(id)).toBe('already');
    expect(await db.transcodeJob.count({ where: { videoId: id } })).toBe(1);
    expect(await getQueue('video').getJobCounts('waiting')).toEqual({ waiting: 1 });
  });

  it('completeUpload heals a lost final response: all bytes present but the video still AWAITING_UPLOAD', async () => {
    await signedInCreator();
    const id = videoIdFrom(await tusCreate({ size: 2500 }));
    expect(await completeUpload(id)).toBe('incomplete'); // nothing uploaded yet
    // bytes arrive out of band (as if the final PATCH was processed but its hook never ran)
    await fs.writeFile(storagePath(keys.upload(id)), bytesOf(2500));
    expect(await completeUpload(id)).toBe('queued');
    expect((await db.video.findUniqueOrThrow({ where: { id } })).processingStatus).toBe('QUEUED');
    expect(await completeUpload(id)).toBe('already');
    expect(await completeUpload('missingvideo')).toBe('missing');
  });

  it('a finished upload cannot be patched, terminated or re-created through tus', async () => {
    await signedInCreator();
    const { id } = await uploadWholeFile(1200);
    const patch = await tusPatch(id, 1200, bytesOf(10));
    expect(patch.status).toBe(409);
    expect((await body(patch)).error.message).toMatch(/[؀-ۿ]/);
    const del = await tusDelete(id);
    expect(del.status).toBe(409);
    expect(await db.video.count({ where: { id } })).toBe(1);
    expect((await tusHead(id)).status).toBe(200); // the owner can still ask (a resuming client sees "complete")
  });
});

describe('tus: who may start an upload', () => {
  it('anonymous visitors get 401 with a Persian message', async () => {
    logout();
    const res = await tusCreate({ size: 1000 });
    expect(res.status).toBe(401);
    const { error } = await body(res);
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toMatch(/[؀-ۿ]/);
    expect(await db.video.count()).toBe(0);
  });

  it('users with an unverified e-mail get 403', async () => {
    const user = await createUser({ withChannel: true, verified: false });
    await loginAs(user.id);
    const res = await tusCreate({ size: 1000 });
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await db.video.count()).toBe(0);
  });

  it('users without a channel get 403', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const res = await tusCreate({ size: 1000 });
    expect(res.status).toBe(403);
    expect((await body(res)).error.message).toContain('کانال');
  });

  it('suspended channels cannot upload', async () => {
    const user = await signedInCreator();
    await db.channel.update({ where: { id: user.channel!.id }, data: { suspendedAt: new Date() } });
    const res = await tusCreate({ size: 1000 });
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe('BLOCKED');
    expect(await db.video.count()).toBe(0);
  });

  it('requests from a foreign origin are rejected (CSRF) before anything is created', async () => {
    await signedInCreator();
    const res = await tusCreate({ size: 1000, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await db.video.count()).toBe(0);
    const noOrigin = await tusCreate({ size: 1000, origin: null });
    expect(noOrigin.status).toBe(403);
  });

  it('new uploads take the channel default visibility', async () => {
    const user = await signedInCreator();
    await db.channel.update({ where: { id: user.channel!.id }, data: { defaultVisibility: 'UNLISTED' } });
    const id = videoIdFrom(await tusCreate({ size: 1000 }));
    expect((await db.video.findUniqueOrThrow({ where: { id } })).visibility).toBe('UNLISTED');
  });
});

describe('tus: another user can never touch your upload', () => {
  async function victimUpload() {
    const owner = await signedInCreator();
    const id = videoIdFrom(await tusCreate({ size: 2000 }));
    const bytes = bytesOf(2000);
    expect((await tusPatch(id, 0, bytes.subarray(0, 800))).status).toBe(204);
    return { owner, id, bytes };
  }

  it('HEAD, PATCH and DELETE by another creator are plain 404s and change nothing', async () => {
    const { id, bytes } = await victimUpload();
    const other = await createUser({ withChannel: true });
    await loginAs(other.id);

    for (const res of [await tusHead(id), await tusPatch(id, 800, bytes.subarray(800, 1000)), await tusDelete(id)]) {
      expect(res.status).toBe(404);
      expect(res.headers.get('upload-offset')).toBeNull();
    }
    expect((await body(await tusHead(id))).error.code).toBe('NOT_FOUND');
    expect(await db.video.count({ where: { id } })).toBe(1);
    expect((await fs.stat(storagePath(keys.upload(id)))).size).toBe(800);

    // the owner still sees the upload exactly where they left it
    const owner = await db.channel.findFirstOrThrow({ where: { videos: { some: { id } } }, select: { ownerId: true } });
    await loginAs(owner.ownerId);
    expect((await tusHead(id)).headers.get('upload-offset')).toBe('800');
  });

  it('moderators and admins have no special access to somebody else’s unfinished upload', async () => {
    const { id } = await victimUpload();
    for (const role of ['MODERATOR', 'ADMIN'] as const) {
      const staff = await createUser({ role, withChannel: true });
      await loginAs(staff.id);
      expect((await tusHead(id)).status).toBe(404);
      expect((await tusDelete(id)).status).toBe(404);
    }
  });

  it('anonymous requests are rejected before the upload is even looked up (401, same for unknown ids)', async () => {
    const { id } = await victimUpload();
    logout();
    expect((await tusHead(id)).status).toBe(401);
    expect((await tusPatch(id, 800, bytesOf(10))).status).toBe(401);
    expect((await tusDelete(id)).status).toBe(401);
  });

  it('unknown and malformed ids look exactly like somebody else’s upload', async () => {
    await signedInCreator();
    const unknown = await tusHead('AAAAAAAAAAA');
    expect(unknown.status).toBe(404);
    expect((await tusHead('..%2F..%2Fetc')).status).toBe(404);
    expect((await tusHead('short')).status).toBe(404);
    expect((await body(unknown)).error.code).toBe('NOT_FOUND');
  });

  it('a user without a verified e-mail cannot continue an upload either', async () => {
    const owner = await createUser({ withChannel: true });
    await loginAs(owner.id);
    const id = videoIdFrom(await tusCreate({ size: 1000 }));
    await db.user.update({ where: { id: owner.id }, data: { emailVerifiedAt: null } });
    expect((await tusPatch(id, 0, bytesOf(100))).status).toBe(403);
  });
});

describe('tus: validation of what the client declares', () => {
  it('rejects unsupported extensions and non-video types with a Persian message', async () => {
    await signedInCreator();
    for (const [filename, filetype] of [
      ['virus.exe', 'application/octet-stream'],
      ['notes.txt', 'text/plain'],
      ['archive.zip', 'application/zip'],
      ['photo.mp4', 'image/png'],
      ['noextension', 'video/mp4'],
      ['double.mp4.exe', 'video/mp4'],
    ] as const) {
      const res = await tusCreate({ size: 1000, filename, filetype });
      expect(res.status, filename).toBe(422);
      const { error } = await body(res);
      expect(error.code).toBe('VALIDATION');
      expect(error.message).toMatch(/[؀-ۿ]/);
    }
    expect(await db.video.count()).toBe(0);
  });

  it('accepts every documented container, including browsers that send no (or a generic) MIME type', async () => {
    const user = await signedInCreator();
    // quota is 4 per day: use several users
    void user;
    for (const [filename, filetype] of [
      ['a.mkv', ''],
      ['b.MOV', 'video/quicktime'],
      ['c.webm', 'application/octet-stream'],
      ['d.avi', 'video/x-msvideo'],
    ] as const) {
      const u = await createUser({ withChannel: true });
      await loginAs(u.id);
      const res = await tusCreate({ size: 1000, filename, filetype });
      expect(res.status, filename).toBe(201);
    }
  });

  it('stores the SANITIZED name and a server-derived MIME type, not what the client claimed', async () => {
    await signedInCreator();
    const id = videoIdFrom(await tusCreate({ size: 1000, filename: '../../etc/passwd\u0000/clip.mkv', filetype: 'video/x-weird' }));
    const video = await db.video.findUniqueOrThrow({ where: { id } });
    expect(video.originalFilename).toBe('clip.mkv');
    expect(video.sourceMime).toBe('video/x-matroska');
    expect(video.title).toBe('clip');
  });

  it('empty files, oversize files and deferred lengths are refused', async () => {
    await signedInCreator();
    expect((await tusCreate({ size: 0 })).status).toBe(422);
    const tooBig = await tusCreate({ size: 6_000_000 });
    expect(tooBig.status).toBe(413); // above UPLOAD_MAX_BYTES (5 MB), refused by tus itself
    const deferred = await tusCreate({ size: 0, deferLength: true });
    expect(deferred.status).toBe(400); // the stores allow it, but we need the size up front to enforce quotas
    expect(await db.video.count()).toBe(0);
  });

  it('a missing file name is refused', async () => {
    await signedInCreator();
    const res = await tusCreate({ size: 1000, metadata: 'filetype dmlkZW8vbXA0' });
    expect(res.status).toBe(422);
  });
});

describe('tus: quotas and rate limits (enforced on the server)', () => {
  it('the daily COUNT limit applies per channel over the last 24 hours', async () => {
    const user = await signedInCreator();
    for (let i = 0; i < 4; i++) expect((await tusCreate({ size: 1000 })).status).toBe(201);
    const fifth = await tusCreate({ size: 1000 });
    expect(fifth.status).toBe(413);
    const { error } = await body(fifth);
    expect(error.code).toBe('QUOTA_EXCEEDED');
    expect(error.message).toMatch(/[؀-ۿ]/);
    expect(await db.video.count({ where: { channelId: user.channel!.id } })).toBe(4);

    // another channel is unaffected
    await loginAs((await createUser({ withChannel: true })).id);
    expect((await tusCreate({ size: 1000 })).status).toBe(201);

    // rows older than 24 hours no longer count
    await db.video.updateMany({ where: { channelId: user.channel!.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await loginAs(user.id);
    expect((await tusCreate({ size: 1000 })).status).toBe(201);
  });

  it('the daily BYTES quota counts what was already declared', async () => {
    await signedInCreator();
    expect((await tusCreate({ size: 4_500_000 })).status).toBe(201);
    expect((await tusCreate({ size: 4_500_000 })).status).toBe(201);
    const third = await tusCreate({ size: 4_500_000 }); // 13.5 MB > 12 MB
    expect(third.status).toBe(413);
    expect((await body(third)).error.code).toBe('QUOTA_EXCEEDED');
    // a small file still fits
    expect((await tusCreate({ size: 2_000_000 })).status).toBe(201);
  });

  it('parallel creations cannot overshoot the quota (serialized per channel)', async () => {
    await signedInCreator();
    const results = await Promise.all(Array.from({ length: 10 }, () => tusCreate({ size: 1000 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status === 413)).toHaveLength(6);
    expect(await db.video.count()).toBe(4);
  });

  it('creating uploads is rate limited per user (429 with Retry-After information)', async () => {
    await signedInCreator();
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await tusCreate({ size: 1000 });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 4)).toEqual([201, 201, 201, 201]);
    expect(statuses.at(-1)).toBe(429);
    const { error } = await body(last!);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(last!.headers.get('retry-after')).toBeNull(); // tus responses carry the hint in the JSON body
  });
});

describe('tus: cancelling', () => {
  it('DELETE removes the unfinished upload, its record and its files', async () => {
    await signedInCreator();
    const id = videoIdFrom(await tusCreate({ size: 3000 }));
    expect((await tusPatch(id, 0, bytesOf(1000))).status).toBe(204);
    expect((await fs.stat(storagePath(keys.upload(id)))).size).toBe(1000);

    const res = await tusDelete(id);
    expect(res.status).toBe(204);
    // the row disappears (asynchronously, right after the response) and the file is gone
    await vi.waitFor(async () => expect(await db.video.count({ where: { id } })).toBe(0), { timeout: 5_000 });
    await expect(fs.stat(storagePath(keys.upload(id)))).rejects.toThrow();
    expect((await tusHead(id)).status).toBe(404);
    // a cleanup job sweeps whatever else the protocol left behind
    expect(await getQueue('maintenance').getJobCounts('waiting', 'delayed')).toMatchObject({ waiting: 1 });
  });

  it('after a cancel the quota slot is free again', async () => {
    await signedInCreator();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(videoIdFrom(await tusCreate({ size: 1000 })));
    expect((await tusCreate({ size: 1000 })).status).toBe(413);
    expect((await tusDelete(ids[0]!)).status).toBe(204);
    await vi.waitFor(async () => expect(await db.video.count()).toBe(3));
    expect((await tusCreate({ size: 1000 })).status).toBe(201);
  });
});

describe('tus: storage layout', () => {
  it('writes under uploads/<videoId> and keeps nothing in the public namespace', async () => {
    await signedInCreator();
    const { id } = await uploadWholeFile(2048);
    const storage = getStorage();
    expect((await storage.head(keys.upload(id)))?.size).toBe(2048);
    expect(await storage.list(`videos/${id}/`)).toHaveLength(0);
  });
});
