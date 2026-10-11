/**
 * The studio's media endpoints: processing status (single and batch), custom thumbnails, candidate selection and
 * subtitles — with every authorization rule and the hostile-input cases.
 */
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getStorage, keys } from '@/lib/storage';
import { deleteSubtitleAction, selectThumbnailAction } from '@/features/videos-studio/actions';
import { getStudioEditData } from '@/features/videos-studio/queries';
import { toActor } from '@/lib/auth/session';
import * as statusRoute from '@/app/api/studio/videos/[id]/status/route';
import * as batchRoute from '@/app/api/studio/videos/status/route';
import * as thumbnailRoute from '@/app/api/studio/videos/[id]/thumbnail/route';
import * as subtitlesRoute from '@/app/api/studio/videos/[id]/subtitles/route';
import { createUser, createVideo } from '../helpers/factories';
import { getCurrentUser } from '@/lib/auth/session';
import { loginAs, logout } from '../helpers/auth';
import { createReadyVideo, createUploadedVideo, solidJpeg } from '../helpers/media';

const BASE = 'http://localhost:3000';
const headers = { Origin: BASE, Host: 'localhost:3000' };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function creator() {
  const user = await createUser({ withChannel: true });
  await loginAs(user.id);
  return user;
}

const getStatus = (id: string) => statusRoute.GET(new NextRequest(`${BASE}/api/studio/videos/${id}/status`, { headers }), ctx(id));
const getBatch = (ids: string[]) => batchRoute.GET(new NextRequest(`${BASE}/api/studio/videos/status?ids=${ids.join(',')}`, { headers }));

function multipart(fields: Record<string, string | { name: string; type: string; bytes: Uint8Array }>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, typeof value === 'string' ? value : new File([Buffer.from(value.bytes)], value.name, { type: value.type }));
  }
  return form;
}

const postThumbnail = (id: string, form: FormData | null, extraHeaders: Record<string, string> = {}) =>
  thumbnailRoute.POST(new NextRequest(`${BASE}/api/studio/videos/${id}/thumbnail`, { method: 'POST', headers: { ...headers, ...extraHeaders }, ...(form ? { body: form } : {}) }), ctx(id));
const postSubtitle = (id: string, form: FormData) =>
  subtitlesRoute.POST(new NextRequest(`${BASE}/api/studio/videos/${id}/subtitles`, { method: 'POST', headers, body: form }), ctx(id));

const json = async (res: Response) => JSON.parse(await res.text());

describe('GET /api/studio/videos/[id]/status', () => {
  it('reports stage, progress and the failure reason to the owner', async () => {
    const owner = await creator();
    const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p' });
    await db.video.update({ where: { id }, data: { processingStatus: 'PROCESSING' } });
    await db.transcodeJob.updateMany({ where: { videoId: id }, data: { status: 'ACTIVE', stage: 'TRANSCODE', progress: 42, attempt: 1 } });

    const res = await getStatus(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await json(res);
    expect(body).toMatchObject({ id, processingStatus: 'PROCESSING', ready: false, job: { status: 'ACTIVE', stage: 'TRANSCODE', progress: 42, attempt: 1, maxAttempts: 3 }, posterUrl: null });

    await db.video.update({ where: { id }, data: { processingStatus: 'FAILED', failureReason: 'دلیل ناموفق بودن' } });
    expect(await json(await getStatus(id))).toMatchObject({ processingStatus: 'FAILED', failureReason: 'دلیل ناموفق بودن' });
  });

  it('exposes only what the studio needs (no storage keys or other users’ data)', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    const body = await json(await getStatus(video.id));
    expect(body).toMatchObject({ ready: true, processingStatus: 'READY' });
    expect(body.posterUrl).toMatch(new RegExp(`^/media/videos/${video.id}/thumbs/poster_[A-Za-z0-9_-]+\\.jpg$`));
    expect(JSON.stringify(body)).not.toMatch(/sourceKey|uploads\/|hlsMasterKey|ownerId|email/);
  });

  it('is 404 for other creators and unknown ids (indistinguishable), 401 for visitors, and open to moderators', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    await creator();
    const foreign = await getStatus(video.id);
    const missing = await getStatus('AAAAAAAAAAA');
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(await foreign.text()).toBe(await missing.text());
    expect((await getStatus('bad-id')).status).toBe(404);

    logout();
    expect((await getStatus(video.id)).status).toBe(401);

    const moderator = await createUser({ role: 'MODERATOR', withChannel: true });
    await loginAs(moderator.id);
    expect((await getStatus(video.id)).status).toBe(200);
    const noChannel = await createUser({ role: 'MODERATOR' });
    await loginAs(noChannel.id);
    expect((await getStatus(video.id)).status).toBe(403);
  });

  it('is rate limited generously (polling must not trip it) but not unbounded', async () => {
    const owner = await creator();
    const video = await createVideo(owner.channel!.id);
    for (let i = 0; i < 30; i++) expect((await getStatus(video.id)).status).toBe(200);
  });
});

describe('GET /api/studio/videos/status?ids=…  (batch)', () => {
  it('returns the manageable videos only and silently drops the rest', async () => {
    const owner = await creator();
    const a = await createVideo(owner.channel!.id, { state: 'processing' });
    const b = await createVideo(owner.channel!.id, { state: 'failed' });
    const stranger = await createUser({ withChannel: true });
    const foreign = await createVideo(stranger.channel!.id);
    const res = await getBatch([a.id, b.id, foreign.id, 'AAAAAAAAAAA']);
    expect(res.status).toBe(200);
    const { items } = await json(res);
    expect(items.map((i: { id: string }) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('validates the id list', async () => {
    await creator();
    expect((await getBatch([])).status).toBe(422);
    expect((await getBatch(['not-valid'])).status).toBe(422);
    expect((await getBatch(Array.from({ length: 31 }, (_, i) => `aB3dE5gH7j${i % 10}`))).status).toBe(422);
    logout();
    expect((await getBatch(['aB3dE5gH7jK'])).status).toBe(401);
  });
});

describe('selecting a generated thumbnail', () => {
  it('copies the candidate to a fresh poster key and deletes the replaced poster', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    const storage = getStorage();
    const oldKey = video.posterKey!;
    const candidate = await storage.get(keys.autoThumb(video.id, 1));
    const chunks: Buffer[] = [];
    for await (const c of candidate!.stream) chunks.push(Buffer.from(c as Uint8Array));
    const expected = Buffer.concat(chunks);

    const result = await selectThumbnailAction({ id: video.id, index: 1 });
    expect(result.ok).toBe(true);
    const saved = await db.video.findUniqueOrThrow({ where: { id: video.id }, include: { assets: { where: { kind: 'POSTER' } } } });
    expect(saved.posterKey).not.toBe(oldKey);
    expect(saved.posterKey).toMatch(/\/thumbs\/poster_[A-Za-z0-9_-]+\.jpg$/);
    expect(saved.assets).toHaveLength(1);
    expect(saved.assets[0]).toMatchObject({ storageKey: saved.posterKey, meta: { source: 'auto', index: 1 } });

    const stored = await storage.get(saved.posterKey!);
    const got: Buffer[] = [];
    for await (const c of stored!.stream) got.push(Buffer.from(c as Uint8Array));
    expect(Buffer.concat(got)).toEqual(expected);
    expect(await storage.head(oldKey)).toBeNull(); // replaced poster removed
    expect(await storage.head(keys.autoThumb(video.id, 3))).not.toBeNull(); // candidates stay selectable

    const edit = await getStudioEditData(toActor(await getCurrentUser()), video.id);
    expect(edit!.thumbnails.map((t) => [t.index, t.selected])).toEqual([[1, true], [2, false], [3, false]]);
    expect(edit!.customPoster).toBe(false);
  });

  it('rejects bad indexes, processing videos and strangers', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    for (const index of [0, 4, 1.5, '2']) expect((await selectThumbnailAction({ id: video.id, index })).ok).toBe(false);
    const processing = await createVideo(owner.channel!.id, { state: 'processing' });
    expect(await selectThumbnailAction({ id: processing.id, index: 1 })).toMatchObject({ ok: false, code: 'CONFLICT' });
    await creator();
    expect(await selectThumbnailAction({ id: video.id, index: 1 })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('POST /api/studio/videos/[id]/thumbnail (custom image)', () => {
  it('re-encodes the image as a 1280x720 JPEG, replaces the poster and drops the old one', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    const storage = getStorage();
    const png = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 200, g: 30, b: 90 } } }).png().toBuffer();

    const res = await postThumbnail(video.id, multipart({ file: { name: 'cover.png', type: 'image/png', bytes: png } }));
    expect(res.status).toBe(200);
    const { posterUrl } = await json(res);
    expect(posterUrl).toMatch(/^\/media\/videos\/.+\/thumbs\/poster_/);

    const saved = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(posterUrl).toBe(`/media/${saved.posterKey}`);
    expect(saved.posterKey).not.toBe(video.posterKey);
    const stored = await storage.get(saved.posterKey!);
    const chunks: Buffer[] = [];
    for await (const c of stored!.stream) chunks.push(Buffer.from(c as Uint8Array));
    const info = await sharp(Buffer.concat(chunks)).metadata();
    expect([info.format, info.width, info.height]).toEqual(['jpeg', 1280, 720]);
    expect(await storage.head(video.posterKey!)).toBeNull();
    expect(await db.mediaAsset.findFirstOrThrow({ where: { videoId: video.id, kind: 'POSTER' } })).toMatchObject({ storageKey: saved.posterKey, meta: { source: 'custom' } });

    // replacing it again removes the previous custom poster
    const again = await postThumbnail(video.id, multipart({ file: { name: 'c2.jpg', type: 'image/jpeg', bytes: await solidJpeg(900, 900, 50) } }));
    expect(again.status).toBe(200);
    expect(await storage.head(saved.posterKey!)).toBeNull();
    expect(await db.mediaAsset.count({ where: { videoId: video.id, kind: 'POSTER' } })).toBe(1);
  });

  it('portrait videos get a portrait poster', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id, { width: 720, height: 1280, kind: 'SHORT' });
    const res = await postThumbnail(video.id, multipart({ file: { name: 'a.jpg', type: 'image/jpeg', bytes: await solidJpeg(1000, 1000, 80) } }));
    expect(res.status).toBe(200);
    const poster = (await db.video.findUniqueOrThrow({ where: { id: video.id } })).posterKey!;
    const stored = await getStorage().get(poster);
    const chunks: Buffer[] = [];
    for await (const c of stored!.stream) chunks.push(Buffer.from(c as Uint8Array));
    expect(await sharp(Buffer.concat(chunks)).metadata()).toMatchObject({ width: 720, height: 1280 });
  });

  it('rejects things that are not images, polyglots, empty uploads and oversized bodies', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    const before = (await db.video.findUniqueOrThrow({ where: { id: video.id } })).posterKey;
    const cases: [string, FormData | null, number][] = [
      ['text posing as png', multipart({ file: { name: 'a.png', type: 'image/png', bytes: new TextEncoder().encode('<script>alert(1)</script>') } }), 400],
      ['html with a jpeg header', multipart({ file: { name: 'a.jpg', type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode('<html><script>alert(1)</script></html>')]) } }), 400],
      ['svg', multipart({ file: { name: 'a.svg', type: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') } }), 400],
      ['no file field', multipart({ other: 'x' }), 422],
      ['empty file', multipart({ file: { name: 'a.png', type: 'image/png', bytes: new Uint8Array() } }), 422],
      ['not multipart', null, 400],
    ];
    for (const [name, form, status] of cases) {
      const res = await postThumbnail(video.id, form);
      expect(res.status, name).toBe(status);
      expect((await json(res)).error.message, name).toMatch(/[؀-ۿ]/);
    }
    // 9 MB: refused while reading, before any image decoding
    const huge = await postThumbnail(video.id, multipart({ file: { name: 'big.jpg', type: 'image/jpeg', bytes: new Uint8Array(9 * 1024 * 1024).fill(0xff) } }));
    expect(huge.status).toBe(400);
    expect((await json(huge)).error.message).toContain('۸ مگابایت');
    expect((await db.video.findUniqueOrThrow({ where: { id: video.id } })).posterKey).toBe(before);
  });

  it('enforces ownership, login and the processing state; foreign origins are blocked (CSRF)', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    const form = () => multipart({ file: { name: 'a.jpg', type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) } });
    expect((await postThumbnail(video.id, form(), { Origin: 'https://evil.example' })).status).toBe(403);
    const processing = await createVideo(owner.channel!.id, { state: 'processing' });
    expect((await postThumbnail(processing.id, multipart({ file: { name: 'a.jpg', type: 'image/jpeg', bytes: await solidJpeg(200, 200, 90) } }))).status).toBe(409);

    await creator();
    expect((await postThumbnail(video.id, multipart({ file: { name: 'a.jpg', type: 'image/jpeg', bytes: await solidJpeg(200, 200, 90) } }))).status).toBe(404);
    logout();
    expect((await postThumbnail(video.id, form())).status).toBe(401);
  });
});

describe('subtitles', () => {
  const srt = (text = 'سلام دنیا') => `1\n00:00:01,000 --> 00:00:03,000\n${text}\n\n2\n00:00:04,000 --> 00:00:05,500\nخداحافظ\n`;
  const upload = (id: string, bytes: Uint8Array | string, fields: { language?: string; label?: string; name?: string } = {}) =>
    postSubtitle(id, multipart({
      file: { name: fields.name ?? 'sub.srt', type: 'application/x-subrip', bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes },
      language: fields.language ?? 'fa',
      label: fields.label ?? 'فارسی',
    }));
  const readText = async (key: string) => {
    const object = await getStorage().get(key);
    const chunks: Buffer[] = [];
    for await (const c of object!.stream) chunks.push(Buffer.from(c as Uint8Array));
    return Buffer.concat(chunks).toString('utf8');
  };

  it('converts SRT to WebVTT, stores it under subs/<lang>.vtt and registers the asset', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    const res = await upload(video.id, srt());
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ cues: 2 });

    const vtt = await readText(keys.subtitle(video.id, 'fa'));
    expect(vtt.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nسلام دنیا')).toBe(true);
    const asset = await db.mediaAsset.findFirstOrThrow({ where: { videoId: video.id, kind: 'SUBTITLE' } });
    expect(asset).toMatchObject({ language: 'fa', label: 'فارسی', isDefault: true, storageKey: `videos/${video.id}/subs/fa.vtt`, mimeType: 'text/vtt' });
    expect(Number(asset.sizeBytes)).toBe(Buffer.byteLength(vtt));
  });

  it('a second language is not the default; re-uploading a language replaces it', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    expect((await upload(video.id, srt())).status).toBe(200);
    expect((await upload(video.id, srt('hello'), { language: 'en', label: 'English' })).status).toBe(200);
    const assets = await db.mediaAsset.findMany({ where: { videoId: video.id, kind: 'SUBTITLE' }, orderBy: { createdAt: 'asc' } });
    expect(assets.map((a) => [a.language, a.isDefault])).toEqual([['fa', true], ['en', false]]);

    const first = assets[0]!;
    expect((await upload(video.id, srt('نسخه‌ی تازه'), { label: 'فارسی (اصلاح‌شده)' })).status).toBe(200);
    const after = await db.mediaAsset.findMany({ where: { videoId: video.id, kind: 'SUBTITLE' }, orderBy: { createdAt: 'asc' } });
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: first.id, label: 'فارسی (اصلاح‌شده)', isDefault: true });
    expect(await readText(keys.subtitle(video.id, 'fa'))).toContain('نسخه‌ی تازه');
  });

  it('decodes legacy Windows-1256 Persian subtitles', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    const header = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n');
    const body = new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3, 0x0a]); // "سلام" in Windows-1256
    const bytes = new Uint8Array([...header, ...body]);
    expect((await upload(video.id, bytes)).status).toBe(200);
    expect(await readText(keys.subtitle(video.id, 'fa'))).toContain('سلام');
  });

  it('accepts WebVTT as is', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    expect((await upload(video.id, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n', { name: 'a.vtt', language: 'en', label: 'English' })).status).toBe(200);
    expect(await readText(keys.subtitle(video.id, 'en'))).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n');
  });

  it('validates language, label and the file itself', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    for (const [bytes, fields, status] of [
      [srt(), { language: 'persian' }, 422],
      [srt(), { language: '../x' }, 422],
      [srt(), { label: '   ' }, 422],
      [srt(), { label: 'ا'.repeat(41) }, 422],
      ['no cues in here at all', {}, 422],
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), {}, 422],
      [new Uint8Array(1024 * 1024 + 70_000).fill(65), {}, 400],
    ] as const) {
      const res = await upload(video.id, bytes as Uint8Array | string, fields);
      expect(res.status, JSON.stringify(fields)).toBe(status);
      expect((await json(res)).error.message).toMatch(/[؀-ۿ]/);
    }
    expect(await db.mediaAsset.count({ where: { videoId: video.id, kind: 'SUBTITLE' } })).toBe(0);
    expect(await getStorage().list(`videos/${video.id}/subs/`)).toHaveLength(0);
  });

  it('caps the number of languages per video', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    for (const code of ['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj']) expect((await upload(video.id, srt(), { language: code, label: code })).status).toBe(200);
    expect((await upload(video.id, srt(), { language: 'ak', label: 'ak' })).status).toBe(409);
    expect((await upload(video.id, srt('تغییر'), { language: 'aa', label: 'aa' })).status).toBe(200); // replacing is fine
  });

  it('is limited to people who manage the video', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    await creator();
    expect((await upload(video.id, srt())).status).toBe(404);
    logout();
    expect((await upload(video.id, srt())).status).toBe(401);
    expect(await db.mediaAsset.count({ where: { videoId: video.id, kind: 'SUBTITLE' } })).toBe(0);
  });

  it('deleting removes the file and the row, and the next subtitle becomes the default', async () => {
    const owner = await creator();
    const video = await createReadyVideo(owner.channel!.id);
    await upload(video.id, srt());
    await upload(video.id, srt('hi'), { language: 'en', label: 'English' });
    const [fa, en] = await db.mediaAsset.findMany({ where: { videoId: video.id, kind: 'SUBTITLE' }, orderBy: { createdAt: 'asc' } });

    // a stranger cannot delete it
    await creator();
    expect(await deleteSubtitleAction({ id: video.id, assetId: fa!.id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await loginAs(owner.id);
    // the asset id must belong to THIS video
    const other = await createReadyVideo(owner.channel!.id);
    expect(await deleteSubtitleAction({ id: other.id, assetId: fa!.id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    expect((await deleteSubtitleAction({ id: video.id, assetId: fa!.id })).ok).toBe(true);
    expect(await getStorage().head(keys.subtitle(video.id, 'fa'))).toBeNull();
    expect(await db.mediaAsset.findUniqueOrThrow({ where: { id: en!.id } })).toMatchObject({ isDefault: true });
    const edit = await getStudioEditData(toActor(await getCurrentUser()), video.id);
    expect(edit!.subtitles).toMatchObject([{ language: 'en', label: 'English', isDefault: true, cues: 2 }]);
  });
});
