/**
 * Development / test fixtures for the discovery pages (no transcoding pipeline needed):
 *
 *  - abstract poster JPEGs rendered with sharp (SVG → JPEG) and written through the storage driver
 *  - REAL playable HLS clips rendered with ffmpeg from the SAME artwork as the poster (slow zoom/pan + a quiet sine tone):
 *    6–8 s landscape with 360p + 240p renditions for videos, 5 s portrait for shorts. H.264/AAC in MPEG-TS by default.
 *  - `createMediaVideo()` which inserts a READY/PUBLISHED video row (searchable, with poster and optional HLS) and stores the
 *    REAL duration/size of the clip it rendered (the duration badge always equals the HLS duration)
 *
 * Used by `scripts/seed-discovery.ts`, the e2e specs and the screenshot runs. Not imported by application code.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { Prisma } from '../src/generated/prisma/client';
import type { VideoKind } from '../src/generated/prisma/enums';
import { db } from '../src/lib/db';
import { env } from '../src/lib/env';
import { newVideoId, randomToken } from '../src/lib/ids';
import { buildVideoSearchFields } from '../src/lib/persian';
import { contentTypeForKey, getStorage, keys } from '../src/lib/storage';

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** mulberry32 seeded from any string — same seed, same sequence. */
export function seededRng(seed: string): Rng {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 11-char base62 video id from a seed string (keeps the seed idempotent). */
export function stableVideoId(seed: string): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = createHash('sha256').update(`video:${seed}`).digest();
  let out = '';
  for (let i = 0; i < 11; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// Posters and channel images
// ---------------------------------------------------------------------------

function posterSvg(width: number, height: number, rng: Rng): string {
  const hue = Math.floor(rng() * 360);
  const hue2 = (hue + 35 + Math.floor(rng() * 90)) % 360;
  const c1 = hslToHex(hue, 62, 34);
  const c2 = hslToHex(hue2, 70, 52);
  const shapes: string[] = [];
  const base = Math.min(width, height);
  for (let i = 0; i < 5; i++) {
    const cx = Math.round(rng() * width);
    const cy = Math.round(rng() * height);
    const r = Math.round(base * (0.18 + rng() * 0.42));
    const fill = rng() > 0.5 ? '#ffffff' : hslToHex((hue + 180 + Math.floor(rng() * 60)) % 360, 80, 70);
    const opacity = (0.07 + rng() * 0.16).toFixed(2);
    shapes.push(
      rng() > 0.35
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" fill-opacity="${opacity}"/>`
        : `<rect x="${cx - r}" y="${cy - r / 2}" width="${r * 2}" height="${r}" rx="${Math.round(r / 3)}" fill="${fill}" fill-opacity="${opacity}" transform="rotate(${Math.floor(rng() * 50 - 25)} ${cx} ${cy})"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  ${shapes.join('\n  ')}
  <rect width="100%" height="100%" fill="url(#shade)"/>
</svg>`;
}

/** An abstract poster (16:9 by default, pass 360×640 for shorts), ~15–30 kB. */
export async function renderPoster(seed: string, size: { width: number; height: number } = { width: 640, height: 360 }): Promise<Buffer> {
  const svg = posterSvg(size.width, size.height, seededRng(`poster:${seed}`));
  return sharp(Buffer.from(svg)).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
}

/** Square avatar (webp) for a channel. */
export async function renderAvatar(seed: string, size = 256): Promise<Buffer> {
  const svg = posterSvg(size, size, seededRng(`avatar:${seed}`));
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

/** Wide channel banner (webp, 1280×300). */
export async function renderBanner(seed: string, size: { width: number; height: number } = { width: 1280, height: 300 }): Promise<Buffer> {
  const svg = posterSvg(size.width, size.height, seededRng(`banner:${seed}`));
  return sharp(Buffer.from(svg)).webp({ quality: 78 }).toBuffer();
}

const safeToken = () => randomToken(6).replace(/[^A-Za-z0-9]/g, 'x');

/** Store avatar/banner images for a channel and return their keys for `Channel.avatarKey` / `bannerKey`. */
export async function storeChannelImages(channelId: string, ownerId: string, seed: string): Promise<{ avatarKey: string; bannerKey: string }> {
  const storage = getStorage();
  const avatarKey = keys.avatar(ownerId, safeToken());
  const bannerKey = keys.banner(channelId, safeToken());
  await storage.put(avatarKey, await renderAvatar(seed), { contentType: 'image/webp' });
  await storage.put(bannerKey, await renderBanner(seed), { contentType: 'image/webp' });
  return { avatarKey, bannerKey };
}

/** Write a poster for `videoId` through the storage driver; returns the storage key to put in `Video.posterKey`. */
export async function storePoster(videoId: string, jpeg: Buffer): Promise<string> {
  const storage = getStorage();
  await storage.deletePrefix(`${keys.videoPrefix(videoId)}thumbs/`); // keep re-runs idempotent (no orphaned posters)
  const key = keys.poster(videoId, safeToken());
  await storage.put(key, jpeg, { contentType: 'image/jpeg' });
  return key;
}

// ---------------------------------------------------------------------------
// HLS clips (videos and shorts)
// ---------------------------------------------------------------------------

export type HlsFixture = { dir: string; files: string[] };

/** A rendered clip plus the facts measured from its own playlists (so the database can store real values). */
export type ClipFixture = HlsFixture & { durationSeconds: number; width: number; height: number };

export type ClipKind = 'VIDEO' | 'SHORT';

/**
 * `h264`: MPEG-TS + H.264/AAC (what the real pipeline produces; plays in every normal browser).
 * `vp9`: fragmented-MP4 + VP9/Opus — only for headless Chromium builds without proprietary codecs (the sandbox's
 * Playwright Chromium cannot decode H.264), so playback can still be verified end to end.
 */
export type HlsCodec = 'h264' | 'vp9';

export function defaultHlsCodec(): HlsCodec {
  return process.env.SEED_HLS_CODEC === 'vp9' ? 'vp9' : 'h264';
}

const clipCache = new Map<string, Promise<ClipFixture>>();

async function listFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, next)));
    else out.push(next);
  }
  return out.sort();
}

/** Clip length: 6–8 s for videos (stable per artwork, so the demo shows a few different badges), 5 s for shorts. */
export function clipSeconds(artwork: string, kind: ClipKind): number {
  return kind === 'SHORT' ? 5 : 6 + Math.floor(seededRng(`clip-length:${artwork}`)() * 3);
}

/** Read the highest-bandwidth variant of a master playlist: its resolution and the summed `#EXTINF` duration. */
async function inspectHls(dir: string): Promise<{ durationSeconds: number; width: number; height: number }> {
  const master = await fs.readFile(path.join(dir, 'master.m3u8'), 'utf8');
  const lines = master.split('\n');
  let best: { bandwidth: number; width: number; height: number; uri: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const info = /^#EXT-X-STREAM-INF:.*BANDWIDTH=(\d+).*RESOLUTION=(\d+)x(\d+)/.exec(lines[i]!);
    const uri = lines[i + 1]?.trim();
    if (!info || !uri) continue;
    const candidate = { bandwidth: Number(info[1]), width: Number(info[2]), height: Number(info[3]), uri };
    if (!best || candidate.bandwidth > best.bandwidth) best = candidate;
  }
  if (!best) throw new Error('rendered master playlist has no variants');
  const media = await fs.readFile(path.join(dir, best.uri), 'utf8');
  const durationSeconds = [...media.matchAll(/^#EXTINF:([\d.]+)/gm)].reduce((sum, m) => sum + Number(m[1]), 0);
  if (!(durationSeconds > 0)) throw new Error('rendered media playlist has no duration');
  return { durationSeconds: Math.round(durationSeconds * 1000) / 1000, width: best.width, height: best.height };
}

/**
 * Render an HLS clip from the poster artwork `artwork` (the very same SVG art `renderPoster(artwork)` draws, just larger):
 * a slow zoom/pan over it with a quiet sine tone, two renditions (landscape 640×360 + 426×240, portrait 360×640 + 240×426),
 * master.m3u8 + `<rendition>/index.m3u8` + segments. Cached per artwork/kind/length/codec for the lifetime of the process,
 * so a clip is encoded once however many videos share it.
 */
export function renderClip(opts: { artwork: string; kind?: ClipKind; seconds?: number; codec?: HlsCodec }): Promise<ClipFixture> {
  const kind = opts.kind ?? 'VIDEO';
  const seconds = opts.seconds ?? clipSeconds(opts.artwork, kind);
  const codec = opts.codec ?? defaultHlsCodec();
  const cacheKey = `${opts.artwork}:${kind}:${seconds}:${codec}`;
  let promise = clipCache.get(cacheKey);
  if (!promise) {
    promise = encodeClip(opts.artwork, kind, seconds, codec);
    clipCache.set(cacheKey, promise);
  }
  return promise;
}

async function encodeClip(artwork: string, kind: ClipKind, seconds: number, codec: HlsCodec): Promise<ClipFixture> {
  const portrait = kind === 'SHORT';
  const fps = 24;
  const frames = seconds * fps;
  const [w0, h0, w1, h1] = portrait ? [360, 640, 240, 426] : [640, 360, 426, 240];
  const rng = seededRng(`clip:${artwork}`);

  // Ken Burns: zoom in or out and drift, differently per artwork so neighbouring tiles do not all move the same way.
  const zoomIn = rng() > 0.4;
  const [z0, z1] = zoomIn ? [1, 1.16] : [1.16, 1];
  const [px0, px1, py0, py1] = [rng(), rng(), rng(), rng()];
  const lerp = (a: number, b: number) => `${a.toFixed(3)}+(${(b - a).toFixed(3)})*on/${frames}`;
  const zoompan = `zoompan=z='${lerp(z0, z1)}':x='(iw-iw/zoom)*(${lerp(px0, px1)})':y='(ih-ih/zoom)*(${lerp(py0, py1)})':d=${frames}:s=${w0}x${h0}:fps=${fps}`;
  const tone = 180 + Math.floor(rng() * 200);
  const graph = [
    `[0:v]${zoompan},format=yuv420p,split=2[a][b]`,
    '[a]null[v0]',
    `[b]scale=${w1}:${h1}[v1]`,
    `[1:a]volume=0.06,afade=t=in:st=0:d=0.3,afade=t=out:st=${seconds - 0.4}:d=0.4,asplit=2[a0][a1]`,
  ].join(';');

  const encode =
    codec === 'vp9'
      ? ['-c:v', 'libvpx-vp9', '-b:v:0', '420k', '-b:v:1', '180k', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-g', '48', '-keyint_min', '48', '-c:a', 'libopus', '-b:a', '48k', '-ac', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-b:v:0', '420k', '-maxrate:v:0', '500k', '-bufsize:v:0', '900k', '-b:v:1', '180k', '-maxrate:v:1', '220k', '-bufsize:v:1', '400k', '-c:a', 'aac', '-b:a', '48k', '-ac', '1'];

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-clip-src-'));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-hls-'));
  try {
    await Promise.all([fs.mkdir(path.join(dir, '360p'), { recursive: true }), fs.mkdir(path.join(dir, '240p'), { recursive: true })]);
    // rendition directories are named by their short edge, whatever the orientation
    const names = ['360p', '240p'];
    const source = path.join(work, 'artwork.jpg');
    await fs.writeFile(source, await sharp(Buffer.from(posterSvg(w0 * 2, h0 * 2, seededRng(`poster:${artwork}`)))).jpeg({ quality: 90 }).toBuffer());
    const segments =
      codec === 'vp9'
        ? ['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', path.join(dir, '%v/seg_%05d.m4s')]
        : ['-hls_segment_filename', path.join(dir, '%v/seg_%05d.ts')];
    await run(env.FFMPEG_PATH, [
      '-v', 'error', '-y', '-threads', '2',
      '-i', source,
      '-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=${seconds}:sample_rate=48000`,
      '-filter_complex', graph,
      '-map', '[v0]', '-map', '[v1]', '-map', '[a0]', '-map', '[a1]',
      ...encode,
      '-threads', '2',
      '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
      ...segments,
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', `v:0,a:0,name:${names[0]} v:1,a:1,name:${names[1]}`,
      path.join(dir, '%v/index.m3u8'),
    ]);
    return { dir, files: await listFiles(dir), ...(await inspectHls(dir)) };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/** Copy an HLS fixture under `videos/<id>/hls/`; returns the master playlist key for `Video.hlsMasterKey`. */
export async function storeHls(videoId: string, fixture: HlsFixture): Promise<string> {
  const storage = getStorage();
  await storage.deletePrefix(`${keys.videoPrefix(videoId)}hls/`);
  for (const rel of fixture.files) {
    const key = `${keys.videoPrefix(videoId)}hls/${rel.split(path.sep).join('/')}`;
    await storage.putFile(key, path.join(fixture.dir, rel), { contentType: contentTypeForKey(key) });
  }
  return keys.hlsMaster(videoId);
}

/** Remove the temp directories of every rendered clip. */
export async function disposeFixtures(): Promise<void> {
  const all = await Promise.allSettled([...clipCache.values()]);
  clipCache.clear();
  await Promise.all(all.map((r) => (r.status === 'fulfilled' ? fs.rm(r.value.dir, { recursive: true, force: true }) : undefined)));
}

/** Run `fn` over `items` with at most `limit` in flight (results keep the input order). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]!, i);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Video rows
// ---------------------------------------------------------------------------

export type MediaVideoInput = {
  id?: string;
  channelId: string;
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string | null;
  kind?: VideoKind;
  /** Only used when no HLS is rendered (a poster-only fixture); with HLS the real duration of the clip is stored. */
  durationSeconds?: number;
  publishedAt?: Date;
  viewCount?: number;
  /**
   * Render real playable HLS from the poster artwork (default: shorts only). With it, `durationSeconds`/`width`/`height`
   * are the REAL values of the rendered clip, so the duration badge equals what the player shows.
   */
  withHls?: boolean;
  hlsCodec?: HlsCodec;
  /** Clip length in seconds (default: 6–8 s for videos, 5 s for shorts). */
  clipSeconds?: number;
  /** Re-render poster and media even when the row already has `hlsMasterKey` (by default such a video is left untouched). */
  regenerateMedia?: boolean;
  /** Lifecycle shortcut for hidden-state fixtures. */
  state?: 'public' | 'unlisted' | 'private' | 'draft' | 'takedown';
  /** Point `hlsMasterKey` at a playlist that does not exist (broken short). */
  brokenHls?: boolean;
  /** Artwork seed shared by the poster and the clip (default: the video id). */
  posterSeed?: string;
  /** Leave `posterKey` empty (a video whose thumbnail was never produced). */
  noPoster?: boolean;
};

/**
 * Insert a READY/PUBLISHED video with a poster (and optionally playable HLS). Idempotent when `id` is given: media is only
 * rendered when the row has none yet (or `regenerateMedia` is set); the textual fields are always refreshed.
 */
export async function createMediaVideo(input: MediaVideoInput) {
  const id = input.id ?? newVideoId();
  const kind = input.kind ?? 'VIDEO';
  const channel = await db.channel.findUniqueOrThrow({ where: { id: input.channelId }, select: { name: true } });
  const search = buildVideoSearchFields({ title: input.title, description: input.description, tags: input.tags, channelName: channel.name });
  const publishedAt = input.publishedAt ?? new Date();
  const wantsHls = !input.brokenHls && (input.withHls ?? kind === 'SHORT');
  const artwork = input.posterSeed ?? id;

  const existing = await db.video.findUnique({ where: { id }, select: { posterKey: true, hlsMasterKey: true } });
  const reuseMedia = !!existing && !input.regenerateMedia && !input.brokenHls && !input.noPoster && !!existing.posterKey && (!wantsHls || !!existing.hlsMasterKey);

  const media: Pick<Prisma.VideoUncheckedCreateInput, 'posterKey' | 'hlsMasterKey' | 'durationSeconds' | 'width' | 'height'> = {
    posterKey: null,
    hlsMasterKey: null,
    durationSeconds: input.durationSeconds ?? (kind === 'SHORT' ? 5 : 180),
    width: kind === 'SHORT' ? 360 : 1280,
    height: kind === 'SHORT' ? 640 : 720,
  };
  if (!reuseMedia) {
    if (input.noPoster) await getStorage().deletePrefix(`${keys.videoPrefix(id)}thumbs/`);
    else media.posterKey = await storePoster(id, await renderPoster(artwork, kind === 'SHORT' ? { width: 360, height: 640 } : { width: 640, height: 360 }));
    if (input.brokenHls) media.hlsMasterKey = keys.hlsMaster(id);
    else if (wantsHls) {
      const clip = await renderClip({ artwork, kind, seconds: input.clipSeconds, codec: input.hlsCodec });
      media.hlsMasterKey = await storeHls(id, clip);
      media.durationSeconds = clip.durationSeconds;
      media.width = clip.width;
      media.height = clip.height;
    }
  }

  const data: Prisma.VideoUncheckedCreateInput = {
    id,
    channelId: input.channelId,
    categoryId: input.categoryId ?? null,
    kind,
    title: input.title,
    description: input.description ?? '',
    tags: input.tags ?? [],
    processingStatus: 'READY',
    publishStatus: 'PUBLISHED',
    visibility: 'PUBLIC',
    publishedAt,
    createdAt: publishedAt,
    ...media,
    viewCount: input.viewCount ?? 0,
    ...search,
  };
  switch (input.state) {
    case 'unlisted':
      data.visibility = 'UNLISTED';
      break;
    case 'private':
      data.visibility = 'PRIVATE';
      break;
    case 'draft':
      data.publishStatus = 'DRAFT';
      data.publishedAt = null;
      break;
    case 'takedown':
      data.takedownAt = new Date();
      data.takedownReason = 'fixture';
      break;
  }
  const { id: _id, ...rest } = data;
  void _id;
  // media that was kept must not be overwritten by the placeholders in `media`
  if (reuseMedia) for (const key of ['posterKey', 'hlsMasterKey', 'durationSeconds', 'width', 'height'] as const) delete rest[key];
  return db.video.upsert({ where: { id }, create: data, update: rest });
}
