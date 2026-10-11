/**
 * Development / test fixtures for the discovery pages (no transcoding pipeline needed):
 *
 *  - abstract poster JPEGs rendered with sharp (SVG → JPEG) and written through the storage driver
 *  - a REAL playable portrait HLS clip rendered with ffmpeg `lavfi` (5 s, one 640p-style rendition) for the shorts feed
 *  - `createMediaVideo()` which inserts a READY/PUBLISHED video row (searchable, with poster and optional HLS)
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
// Posters
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

/** Store avatar/banner images for a channel and return their keys for `Channel.avatarKey` / `bannerKey`. */
export async function storeChannelImages(channelId: string, ownerId: string, seed: string): Promise<{ avatarKey: string; bannerKey: string }> {
  const storage = getStorage();
  const avatarKey = keys.avatar(ownerId, randomToken(6).replace(/[^A-Za-z0-9]/g, 'x'));
  const bannerKey = keys.banner(channelId, randomToken(6).replace(/[^A-Za-z0-9]/g, 'x'));
  await storage.put(avatarKey, await renderAvatar(seed), { contentType: 'image/webp' });
  await storage.put(bannerKey, await renderBanner(seed), { contentType: 'image/webp' });
  return { avatarKey, bannerKey };
}

/** Write a poster for `videoId` through the storage driver; returns the storage key to put in `Video.posterKey`. */
export async function storePoster(videoId: string, jpeg: Buffer): Promise<string> {
  const storage = getStorage();
  await storage.deletePrefix(`${keys.videoPrefix(videoId)}thumbs/`); // keep re-runs idempotent (no orphaned posters)
  const key = keys.poster(videoId, randomToken(6).replace(/[^A-Za-z0-9]/g, 'x'));
  await storage.put(key, jpeg, { contentType: 'image/jpeg' });
  return key;
}

// ---------------------------------------------------------------------------
// HLS (shorts)
// ---------------------------------------------------------------------------

export type HlsFixture = { dir: string; files: string[] };

const fixtureCache = new Map<string, Promise<HlsFixture>>();

async function listFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, next)));
    else out.push(next);
  }
  return out.sort();
}

/**
 * Render a portrait (360×640) HLS clip with audio using ffmpeg `lavfi`: master.m3u8 + `640p/index.m3u8` + segments.
 * Cached per seed for the lifetime of the process (a fixture is copied under many video ids).
 */
export function renderShortHls(seed: string, seconds = 5): Promise<HlsFixture> {
  const cacheKey = `${seed}:${seconds}`;
  let promise = fixtureCache.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const rng = seededRng(`hls:${seed}`);
      const color = () => hslToHex(Math.floor(rng() * 360), 70, 45).replace('#', '0x');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-hls-'));
      await fs.mkdir(path.join(dir, '640p'), { recursive: true });
      await run(env.FFMPEG_PATH, [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `gradients=s=360x640:r=24:d=${seconds}:speed=0.04:c0=${color()}:c1=${color()}:c2=${color()}:nb_colors=3:seed=${Math.floor(rng() * 1000)}`,
        '-f', 'lavfi', '-i', `sine=frequency=${180 + Math.floor(rng() * 200)}:duration=${seconds}:sample_rate=44100`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-b:v', '420k', '-maxrate', '480k', '-bufsize', '900k',
        '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-shortest',
        '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(dir, '%v/seg_%05d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', 'v:0,a:0,name:640p',
        path.join(dir, '%v/index.m3u8'),
      ]);
      return { dir, files: await listFiles(dir) };
    })();
    fixtureCache.set(cacheKey, promise);
  }
  return promise;
}

/** Copy an HLS fixture under `videos/<id>/hls/`; returns the master playlist key for `Video.hlsMasterKey`. */
export async function storeHls(videoId: string, fixture: HlsFixture): Promise<string> {
  const storage = getStorage();
  for (const rel of fixture.files) {
    const key = `${keys.videoPrefix(videoId)}hls/${rel.split(path.sep).join('/')}`;
    await storage.putFile(key, path.join(fixture.dir, rel), { contentType: contentTypeForKey(key) });
  }
  return keys.hlsMaster(videoId);
}

/** Remove the temp directories of every rendered fixture. */
export async function disposeFixtures(): Promise<void> {
  const all = await Promise.allSettled([...fixtureCache.values()]);
  fixtureCache.clear();
  await Promise.all(all.map((r) => (r.status === 'fulfilled' ? fs.rm(r.value.dir, { recursive: true, force: true }) : undefined)));
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
  durationSeconds?: number;
  publishedAt?: Date;
  viewCount?: number;
  /** Real playable HLS (shorts need it; regular videos usually do not for discovery pages). */
  withHls?: boolean;
  hlsSeed?: string;
  /** Lifecycle shortcut for hidden-state fixtures. */
  state?: 'public' | 'unlisted' | 'private' | 'draft' | 'takedown';
  /** Point `hlsMasterKey` at a playlist that does not exist (broken short). */
  brokenHls?: boolean;
  posterSeed?: string;
};

/** Insert a READY/PUBLISHED video with a poster (and optionally playable HLS). Idempotent when `id` is given. */
export async function createMediaVideo(input: MediaVideoInput) {
  const id = input.id ?? newVideoId();
  const kind = input.kind ?? 'VIDEO';
  const channel = await db.channel.findUniqueOrThrow({ where: { id: input.channelId }, select: { name: true } });
  const search = buildVideoSearchFields({ title: input.title, description: input.description, tags: input.tags, channelName: channel.name });
  const publishedAt = input.publishedAt ?? new Date();

  const poster = await renderPoster(input.posterSeed ?? id, kind === 'SHORT' ? { width: 360, height: 640 } : { width: 640, height: 360 });
  const posterKey = await storePoster(id, poster);
  let hlsMasterKey: string | null = null;
  if (input.brokenHls) hlsMasterKey = keys.hlsMaster(id);
  else if (input.withHls ?? kind === 'SHORT') hlsMasterKey = await storeHls(id, await renderShortHls(input.hlsSeed ?? id));

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
    durationSeconds: input.durationSeconds ?? (kind === 'SHORT' ? 5 : 180),
    width: kind === 'SHORT' ? 360 : 1280,
    height: kind === 'SHORT' ? 640 : 720,
    posterKey,
    hlsMasterKey,
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
  return db.video.upsert({ where: { id }, create: data, update: rest });
}
