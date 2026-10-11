/**
 * `/media/*` delivery through the real route handler: content types, caching, Range, ETag, and the visibility rules
 * for every combination of viewer and video state.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getStorage, keys } from '@/lib/storage';
import { clearVideoAccessCache } from '@/features/videos/media-access';
import { GET } from '@/app/media/[...key]/route';
import { createUser } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { createReadyVideo } from '../helpers/media';

beforeEach(() => clearVideoAccessCache());

const get = (key: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:3000/media/${key}`, { headers }), { params: Promise.resolve({ key: key.split('/') }) });

const SEGMENT = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

async function publishedVideo(options: Parameters<typeof createReadyVideo>[1] = {}) {
  const owner = await createUser({ withChannel: true });
  const video = await createReadyVideo(owner.channel!.id, { state: 'public', ...options });
  const storage = getStorage();
  await storage.put(keys.hlsRenditionPlaylist(video.id, 720), '#EXTM3U\n#EXTINF:6,\nseg_00000.ts\n#EXT-X-ENDLIST\n');
  await storage.put(`${keys.hlsRenditionPrefix(video.id, 720)}seg_00000.ts`, SEGMENT);
  await storage.put(keys.subtitle(video.id, 'fa'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nسلام\n', { contentType: 'text/vtt; charset=utf-8' });
  logout();
  return { owner, video };
}

const keysOf = (id: string) => ({
  master: `videos/${id}/hls/master.m3u8`,
  playlist: `videos/${id}/hls/720p/index.m3u8`,
  segment: `videos/${id}/hls/720p/seg_00000.ts`,
  thumb: `videos/${id}/thumbs/auto_1.jpg`,
  subtitle: `videos/${id}/subs/fa.vtt`,
});

describe('headers of delivered media', () => {
  it('serves HLS with the right content types and cache policies', async () => {
    const { video } = await publishedVideo();
    const k = keysOf(video.id);

    const master = await get(k.master);
    expect(master.status).toBe(200);
    expect(master.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(master.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=60');
    expect(master.headers.get('accept-ranges')).toBe('bytes');
    expect(master.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await master.text()).toContain('#EXTM3U');

    const playlist = await get(k.playlist);
    expect(playlist.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');

    const segment = await get(k.segment);
    expect(segment.headers.get('content-type')).toBe('video/mp2t');
    expect(segment.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(segment.headers.get('content-length')).toBe(String(SEGMENT.length));
    expect(Buffer.from(await segment.arrayBuffer())).toEqual(SEGMENT);

    const thumb = await get(k.thumb);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(thumb.headers.get('cache-control')).toBe('public, max-age=3600');
    const poster = await get(video.posterKey!);
    expect(poster.headers.get('cache-control')).toBe('public, max-age=31536000, immutable'); // token in the key ⇒ cache-safe

    const subtitle = await get(k.subtitle);
    expect(subtitle.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(subtitle.headers.get('cache-control')).toBe('public, max-age=60'); // replaceable under the same key
    expect(await subtitle.text()).toContain('WEBVTT');
  });

  it('supports byte ranges (seeking) with correct 206 / 416 responses', async () => {
    const { video } = await publishedVideo();
    const { segment } = keysOf(video.id);

    const first = await get(segment, { range: 'bytes=0-99' });
    expect(first.status).toBe(206);
    expect(first.headers.get('content-range')).toBe(`bytes 0-99/${SEGMENT.length}`);
    expect(first.headers.get('content-length')).toBe('100');
    expect(Buffer.from(await first.arrayBuffer())).toEqual(SEGMENT.subarray(0, 100));

    const open = await get(segment, { range: 'bytes=4000-' });
    expect(open.status).toBe(206);
    expect(Buffer.from(await open.arrayBuffer())).toEqual(SEGMENT.subarray(4000));

    const suffix = await get(segment, { range: 'bytes=-16' });
    expect(suffix.status).toBe(206);
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(SEGMENT.subarray(SEGMENT.length - 16));

    const beyond = await get(segment, { range: 'bytes=99999-' });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${SEGMENT.length}`);
  });

  it('answers conditional requests with 304', async () => {
    const { video } = await publishedVideo();
    const { master } = keysOf(video.id);
    const first = await get(master);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const again = await get(master, { 'if-none-match': etag! });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect((await get(master, { 'if-none-match': '"something-else"' })).status).toBe(200);
  });
});

describe('what is never served', () => {
  it('the raw upload, unknown key shapes and traversal attempts are plain 404s', async () => {
    const { video } = await publishedVideo();
    await getStorage().put(keys.upload(video.id), Buffer.from('raw source'));
    await getStorage().put(`${keys.upload(video.id)}.json`, '{}');
    for (const key of [
      `uploads/${video.id}`,
      `uploads/${video.id}.json`,
      `videos/${video.id}/source.mp4`,
      `videos/${video.id}/hls`,
      `videos/${video.id}/thumbs/../../uploads/${video.id}`,
      `videos/${video.id}/hls/../../../etc/passwd`,
      'videos/short/hls/master.m3u8',
      'private/anything.bin',
      '..%2F..%2Fetc%2Fpasswd',
    ]) {
      const res = await get(key);
      expect(res.status, key).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('missing objects of an existing, visible video are 404', async () => {
    const { video } = await publishedVideo();
    expect((await get(`videos/${video.id}/hls/360p/seg_00099.ts`)).status).toBe(404);
    expect((await get(`videos/AAAAAAAAAAA/hls/master.m3u8`)).status).toBe(404);
  });
});

describe('visibility rules', () => {
  const cases = async (video: { id: string }) => {
    const k = keysOf(video.id);
    return [k.master, k.playlist, k.segment, k.thumb, k.subtitle];
  };

  async function statuses(video: { id: string; posterKey: string | null }) {
    const out: number[] = [];
    for (const key of [...(await cases(video)), video.posterKey!]) out.push((await get(key)).status);
    return [...new Set(out)];
  }

  it('PUBLIC + published + ready is open to anonymous visitors', async () => {
    const { video } = await publishedVideo();
    expect(await statuses(video)).toEqual([200]);
  });

  it('UNLISTED is open (by link) with a private, short cache policy', async () => {
    const { video } = await publishedVideo({ state: 'unlisted' });
    expect(await statuses(video)).toEqual([200]);
    expect((await get(keysOf(video.id).master)).headers.get('cache-control')).toBe('private, max-age=300');
  });

  it('PRIVATE: anonymous and other creators get 404; the owner and moderators are served (uncacheable)', async () => {
    const { owner, video } = await publishedVideo({ state: 'private' });
    expect(await statuses(video)).toEqual([404]);

    const other = await createUser({ withChannel: true });
    await loginAs(other.id);
    clearVideoAccessCache();
    expect(await statuses(video)).toEqual([404]);

    await loginAs(owner.id);
    expect(await statuses(video)).toEqual([200]);
    const res = await get(keysOf(video.id).master);
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    const moderator = await createUser({ role: 'MODERATOR' });
    await loginAs(moderator.id);
    expect(await statuses(video)).toEqual([200]);
  });

  it('a DRAFT is only visible to its owner, even though its files exist', async () => {
    const { owner, video } = await publishedVideo({ state: 'draft' });
    expect(await statuses(video)).toEqual([404]);
    await loginAs(owner.id);
    expect(await statuses(video)).toEqual([200]);
  });

  it('a video that is not READY is not served to the public', async () => {
    const { video } = await publishedVideo();
    await db.video.update({ where: { id: video.id }, data: { processingStatus: 'PROCESSING' } });
    clearVideoAccessCache();
    expect(await statuses(video)).toEqual([404]);
  });

  it('taken-down videos and suspended channels disappear for the public but not for the owner', async () => {
    const { owner, video } = await publishedVideo();
    await db.video.update({ where: { id: video.id }, data: { takedownAt: new Date() } });
    clearVideoAccessCache();
    expect(await statuses(video)).toEqual([404]);
    await loginAs(owner.id);
    expect(await statuses(video)).toEqual([200]);

    logout();
    await db.video.update({ where: { id: video.id }, data: { takedownAt: null } });
    await db.channel.update({ where: { id: owner.channel!.id }, data: { suspendedAt: new Date() } });
    clearVideoAccessCache();
    expect(await statuses(video)).toEqual([404]);
  });

  it('avatars and banners are public assets with immutable caching', async () => {
    const owner = await createUser({ withChannel: true });
    const key = `images/avatars/${owner.id}/abc123.webp`;
    await getStorage().put(key, Buffer.from('webp-bytes'));
    const res = await get(key);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });
});
