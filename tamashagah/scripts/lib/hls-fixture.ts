/**
 * Tiny HLS fixtures for the watch feature (tests, e2e and manual runs).
 *
 * Until the real upload/transcoding pipeline is merged this is the way to get a READY + PUBLISHED video with
 * real adaptive-bitrate HLS into the configured storage driver and the database. The output uses exactly the
 * layout the pipeline documents in `src/lib/storage/keys.ts`:
 *
 *   videos/<id>/hls/master.m3u8
 *   videos/<id>/hls/<h>p/index.m3u8 + seg_00000.m4s (+ init.mp4)  — or seg_00000.ts with `codec: 'h264'`
 *   videos/<id>/thumbs/auto_N.jpg, poster_<token>.jpg
 *   videos/<id>/subs/<lang>.vtt
 *
 * Sources are ffmpeg `lavfi` generators (a moving test pattern with a running clock + a quiet tone), so no
 * third-party media is needed and seeking is visually verifiable (the clock in the picture jumps with the
 * playhead).
 *
 * Codec: the Chromium that ships with Playwright (and every other open-source Chromium build) has NO H.264 / AAC
 * decoder, so the default fixture is VP9 + Opus in fragmented MP4 — playable in every Chromium and Firefox.
 * `codec: 'h264'` writes what the production pipeline emits (H.264 + AAC in MPEG-TS) for real-browser checks.
 *
 * Runtime: Node + ffmpeg only (no Next.js imports) — it runs under tsx and inside Vitest.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { db } from '@/lib/db';
import { newVideoId, randomBase62 } from '@/lib/ids';
import { buildVideoSearchFields } from '@/lib/persian';
import { getStorage, keys } from '@/lib/storage';
import type { Visibility } from '@/generated/prisma/enums';

const execFileAsync = promisify(execFile);

export type FixtureCodec = 'vp9' | 'h264';

export type HlsFixtureOptions = {
  channelId: string;
  /** Defaults to a fresh 11-char id. */
  id?: string;
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string | null;
  /** Total length in seconds (default 24 → six 4-second segments). */
  durationSeconds?: number;
  /** Rendition ladder (default 360p + 240p so quality switching can be tested). */
  heights?: number[];
  segmentSeconds?: number;
  /** `vp9` (default): VP9 + Opus in fMP4, decodable everywhere incl. Playwright's Chromium. `h264`: H.264 + AAC in MPEG-TS. */
  codec?: FixtureCodec;
  /** Write fa/en WebVTT tracks + SUBTITLE assets (default true). */
  subtitles?: boolean;
  visibility?: Visibility;
  kind?: 'VIDEO' | 'SHORT';
  viewCount?: number;
  ffmpegPath?: string;
};

export type HlsFixtureResult = {
  id: string;
  title: string;
  durationSeconds: number;
  heights: number[];
  masterKey: string;
  posterKey: string;
};

const widthFor = (height: number) => Math.round((height * 16) / 9 / 2) * 2;
const bitrateFor = (height: number) => (height >= 1080 ? 4_500 : height >= 720 ? 2_200 : height >= 480 ? 1_100 : height >= 360 ? 650 : 350);
/** RFC 6381 codec string(s) of a rendition for the master playlist. */
const codecsFor = (height: number, codec: FixtureCodec) =>
  codec === 'vp9'
    ? `${height >= 1080 ? 'vp09.00.41.08' : height >= 720 ? 'vp09.00.31.08' : height >= 360 ? 'vp09.00.30.08' : 'vp09.00.21.08'},opus`
    : `${height >= 1080 ? 'avc1.4d4028' : height >= 720 ? 'avc1.4d401f' : 'avc1.4d401e'},mp4a.40.2`;

async function ffmpeg(bin: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`ffmpeg failed: ${stderr || (error as Error).message}`);
  }
}

async function renderRendition(opts: {
  bin: string;
  dir: string;
  height: number;
  duration: number;
  segmentSeconds: number;
  codec: FixtureCodec;
}): Promise<void> {
  const { bin, dir, height, duration, segmentSeconds, codec } = opts;
  const fps = 25;
  await fs.mkdir(dir, { recursive: true });
  // Keyframes on the segment boundary in EVERY rendition so adaptive switching is seamless.
  const gop = ['-g', String(fps * segmentSeconds), '-keyint_min', String(fps * segmentSeconds)];
  const hls = ['-f', 'hls', '-hls_time', String(segmentSeconds), '-hls_playlist_type', 'vod'];

  if (codec === 'vp9') {
    await ffmpeg(bin, [
      '-f', 'lavfi', '-i', `testsrc2=size=${widthFor(height)}x${height}:rate=${fps}:duration=${duration}`,
      '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=48000:duration=${duration}`,
      '-af', 'volume=0.04',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', `${bitrateFor(height)}k`,
      '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-lag-in-frames', '0', '-auto-alt-ref', '0',
      ...gop,
      '-c:a', 'libopus', '-b:a', '32k', '-ac', '2',
      ...hls, '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4', '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(dir, 'seg_%05d.m4s'), path.join(dir, 'index.m3u8'),
    ]);
    return;
  }

  await ffmpeg(bin, [
    '-f', 'lavfi', '-i', `testsrc2=size=${widthFor(height)}x${height}:rate=${fps}:duration=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:duration=${duration}`,
    '-af', 'volume=0.04',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-b:v', `${bitrateFor(height)}k`, '-maxrate', `${Math.round(bitrateFor(height) * 1.2)}k`, '-bufsize', `${bitrateFor(height) * 2}k`,
    ...gop, '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '48k', '-ac', '2',
    ...hls, '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'), path.join(dir, 'index.m3u8'),
  ]);
}

async function renderStill(bin: string, file: string, height: number, atFrame: number): Promise<void> {
  await ffmpeg(bin, [
    '-f', 'lavfi', '-i', `testsrc2=size=${widthFor(height)}x${height}:rate=25:duration=6`,
    '-vf', `select=eq(n\\,${atFrame})`, '-frames:v', '1', '-q:v', '4', file,
  ]);
}

function vttFor(lang: 'fa' | 'en', duration: number): string {
  const lines =
    lang === 'fa'
      ? ['این یک زیرنویس آزمایشی فارسی است.', 'ببینید، متن از راست به چپ نمایش داده می‌شود.', 'پخش‌کننده‌ی تماشاگاه زیرنویس را پشتیبانی می‌کند.', 'سلام دنیا! ۱۲۳ — حالا انگلیسی: Hello']
      : ['This is a test English subtitle.', 'Cue two appears a few seconds later.', 'The player supports multiple subtitle tracks.', 'Goodbye!'];
  const ts = (s: number) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = (s % 60).toFixed(3).padStart(6, '0');
    return `${h}:${m}:${sec}`;
  };
  const cues: string[] = [];
  for (let start = 1, i = 0; start + 3 < duration; start += 5, i++) {
    cues.push(`${i + 1}\n${ts(start)} --> ${ts(start + 3)}\n${lines[i % lines.length]}\n`);
  }
  return `WEBVTT\n\n${cues.join('\n')}`;
}

/** Create a READY + PUBLISHED video with real HLS renditions in storage and the matching DB rows. */
export async function createHlsFixtureVideo(options: HlsFixtureOptions): Promise<HlsFixtureResult> {
  const bin = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const duration = options.durationSeconds ?? 24;
  const segmentSeconds = options.segmentSeconds ?? 4;
  const heights = [...new Set(options.heights ?? [360, 240])].sort((a, b) => b - a);
  const id = options.id ?? newVideoId();
  const title = options.title ?? `ویدیوی آزمایشی ${id.slice(0, 4)}`;
  const withSubtitles = options.subtitles ?? true;
  const codec = options.codec ?? 'vp9';

  const channel = await db.channel.findUniqueOrThrow({ where: { id: options.channelId }, select: { name: true } });
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-hls-'));
  const storage = getStorage();

  try {
    for (const height of heights) {
      await renderRendition({ bin, dir: path.join(work, `${height}p`), height, duration, segmentSeconds, codec });
    }
    const posterHeight = Math.max(...heights);
    await fs.mkdir(path.join(work, 'thumbs'), { recursive: true });
    const posterToken = randomBase62(8).toLowerCase();
    const posterFile = path.join(work, 'thumbs', 'poster.jpg');
    await renderStill(bin, posterFile, posterHeight, 75);
    const autoFiles: string[] = [];
    for (const [n, frame] of [[1, 25], [2, 100], [3, 140]] as const) {
      const file = path.join(work, 'thumbs', `auto_${n}.jpg`);
      await renderStill(bin, file, Math.min(posterHeight, 360), frame);
      autoFiles.push(file);
    }

    // Master playlist (highest rendition first is fine: players sort by bandwidth).
    const master = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      ...heights.flatMap((h) => [
        `#EXT-X-STREAM-INF:BANDWIDTH=${Math.round(bitrateFor(h) * 1.1 * 1000) + 48_000},AVERAGE-BANDWIDTH=${bitrateFor(h) * 1000 + 48_000},RESOLUTION=${widthFor(h)}x${h},CODECS="${codecsFor(h, codec)}",FRAME-RATE=25.000`,
        `${h}p/index.m3u8`,
      ]),
      '',
    ].join('\n');

    // Upload everything with the documented key layout.
    const masterKey = keys.hlsMaster(id);
    await storage.put(masterKey, master, { contentType: 'application/vnd.apple.mpegurl' });
    for (const height of heights) {
      const prefix = keys.hlsRenditionPrefix(id, height);
      for (const name of await fs.readdir(path.join(work, `${height}p`))) {
        await storage.putFile(`${prefix}${name}`, path.join(work, `${height}p`, name));
      }
    }
    const posterKey = keys.poster(id, posterToken);
    await storage.putFile(posterKey, posterFile, { contentType: 'image/jpeg' });
    for (const [i, file] of autoFiles.entries()) await storage.putFile(keys.autoThumb(id, i + 1), file, { contentType: 'image/jpeg' });
    if (withSubtitles) {
      await storage.put(keys.subtitle(id, 'fa'), vttFor('fa', duration), { contentType: 'text/vtt' });
      await storage.put(keys.subtitle(id, 'en'), vttFor('en', duration), { contentType: 'text/vtt' });
    }

    const search = buildVideoSearchFields({
      title,
      description: options.description,
      tags: options.tags,
      channelName: channel.name,
    });
    const biggest = heights[0]!;
    await db.video.create({
      data: {
        id,
        channelId: options.channelId,
        categoryId: options.categoryId ?? null,
        kind: options.kind ?? 'VIDEO',
        title,
        description: options.description ?? '',
        tags: options.tags ?? [],
        processingStatus: 'READY',
        publishStatus: 'PUBLISHED',
        visibility: options.visibility ?? 'PUBLIC',
        publishedAt: new Date(),
        durationSeconds: duration,
        width: widthFor(biggest),
        height: biggest,
        posterKey,
        hlsMasterKey: masterKey,
        viewCount: options.viewCount ?? 0,
        ...search,
        assets: {
          create: [
            { kind: 'HLS_MASTER', storageKey: masterKey, mimeType: 'application/vnd.apple.mpegurl' },
            ...heights.map((h) => ({
              kind: 'RENDITION' as const,
              storageKey: keys.hlsRenditionPrefix(id, h),
              mimeType: 'application/vnd.apple.mpegurl',
              width: widthFor(h),
              height: h,
              bitrateKbps: bitrateFor(h),
              codec: codec === 'vp9' ? 'vp9' : 'h264',
              label: `${h}p`,
            })),
            ...autoFiles.map((_, i) => ({ kind: 'THUMBNAIL' as const, storageKey: keys.autoThumb(id, i + 1), mimeType: 'image/jpeg' })),
            { kind: 'POSTER', storageKey: posterKey, mimeType: 'image/jpeg' },
            ...(withSubtitles
              ? [
                  { kind: 'SUBTITLE' as const, storageKey: keys.subtitle(id, 'fa'), mimeType: 'text/vtt', language: 'fa', label: 'فارسی', isDefault: true },
                  { kind: 'SUBTITLE' as const, storageKey: keys.subtitle(id, 'en'), mimeType: 'text/vtt', language: 'en', label: 'English' },
                ]
              : []),
          ],
        },
      },
    });

    return { id, title, durationSeconds: duration, heights, masterKey, posterKey };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
