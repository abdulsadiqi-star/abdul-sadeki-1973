/**
 * Helpers for media / pipeline tests: generated fixtures (cached across runs) and "a video that has been uploaded".
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { newVideoId } from '@/lib/ids';
import { buildVideoSearchFields } from '@/lib/persian';
import { getStorage, keys } from '@/lib/storage';
import type { Prisma } from '@/generated/prisma/client';
import { generateFixture, type FixtureName } from '../../scripts/make-test-video.mjs';
import { createVideo, type VideoState } from './factories';

const execFileAsync = promisify(execFile);

/** Fixtures are small (2–4 s) and cached in the OS temp dir, so only the first run pays for ffmpeg. */
const FIXTURE_DIR = path.join(os.tmpdir(), 'tg-test-fixtures');

export function fixture(name: FixtureName, seconds = 3): Promise<string> {
  return generateFixture(name, { dir: FIXTURE_DIR, seconds });
}

export type UploadedVideoOptions = {
  title?: string;
  /** Fixture name or an absolute file path. */
  source: FixtureName | { file: string };
  publishOnReady?: boolean;
  scheduledFor?: Date | null;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  /** Creator's explicit kind choice (stored where the worker reads it). */
  kindChoice?: 'auto' | 'VIDEO' | 'SHORT';
  processingStatus?: 'QUEUED' | 'AWAITING_UPLOAD';
  /** Skip writing the source object (simulates a lost upload). */
  withoutSource?: boolean;
};

/**
 * A video as it looks right after the upload finished: row QUEUED, source object in storage at `uploads/<id>`,
 * a QUEUED TranscodeJob — i.e. exactly what the worker is handed.
 */
export async function createUploadedVideo(channelId: string, options: UploadedVideoOptions) {
  const file = typeof options.source === 'string' ? await fixture(options.source) : options.source.file;
  const id = newVideoId();
  const title = options.title ?? `ویدیوی آزمایشی ${id}`;
  const stat = await fs.stat(file);
  const channel = await db.channel.findUniqueOrThrow({ where: { id: channelId }, select: { name: true } });

  const data: Prisma.VideoUncheckedCreateInput = {
    id,
    channelId,
    title,
    processingStatus: options.processingStatus ?? 'QUEUED',
    publishStatus: options.scheduledFor ? 'SCHEDULED' : 'DRAFT',
    visibility: options.visibility ?? 'PUBLIC',
    publishOnReady: options.publishOnReady ?? true,
    scheduledFor: options.scheduledFor ?? null,
    originalFilename: path.basename(file),
    sourceKey: keys.upload(id),
    sourceSizeBytes: BigInt(stat.size),
    sourceMime: 'video/mp4',
    ...buildVideoSearchFields({ title, channelName: channel.name }),
  };
  await db.video.create({ data });
  if (!options.withoutSource) await getStorage().putFile(keys.upload(id), file);
  await db.transcodeJob.create({ data: { videoId: id, status: 'QUEUED' } });
  if (options.kindChoice && options.kindChoice !== 'auto') {
    await db.mediaAsset.create({
      data: { videoId: id, kind: 'SOURCE', storageKey: keys.upload(id), meta: { kindChoice: options.kindChoice } },
    });
  }
  return { id, file, title };
}

/** `ffprobe -show_streams` of a local file or playlist, as parsed JSON. */
export async function ffprobeJson(file: string): Promise<{
  streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string; avg_frame_rate?: string; channels?: number; profile?: string }>;
  format: { duration?: string; format_name: string };
}> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return JSON.parse(stdout);
}

/** Absolute path of a storage key when the test storage is the file system driver. */
export function storagePath(key: string): string {
  const root = process.env.STORAGE_FS_ROOT!;
  return path.join(root, key);
}


/** A solid-colour JPEG of the given size (stand-in for a generated thumbnail). */
export function solidJpeg(width: number, height: number, shade: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: shade, g: 90, b: 160 } } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/**
 * A READY video with the assets the pipeline would have produced (3 candidate thumbnails, a poster, a master
 * playlist) written to the real test storage — without running ffmpeg, so studio tests stay fast.
 */
export async function createReadyVideo(
  channelId: string,
  options: { state?: VideoState; title?: string; width?: number; height?: number; kind?: 'VIDEO' | 'SHORT'; durationSeconds?: number } = {},
) {
  const video = await createVideo(channelId, { state: options.state ?? 'draft', title: options.title, kind: options.kind, durationSeconds: options.durationSeconds });
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const storage = getStorage();
  const id = video.id;
  for (const n of [1, 2, 3]) await storage.put(keys.autoThumb(id, n), await solidJpeg(width, height, n * 60), { contentType: 'image/jpeg' });
  const posterKey = keys.poster(id, 'initialtoken');
  await storage.put(posterKey, await solidJpeg(width, height, 120), { contentType: 'image/jpeg' });
  await storage.put(keys.hlsMaster(id), '#EXTM3U\n#EXT-X-VERSION:3\n', { contentType: 'application/vnd.apple.mpegurl' });
  await db.mediaAsset.createMany({
    data: [
      { videoId: id, kind: 'HLS_MASTER', storageKey: keys.hlsMaster(id) },
      ...[1, 2, 3].map((n) => ({ videoId: id, kind: 'THUMBNAIL' as const, storageKey: keys.autoThumb(id, n), mimeType: 'image/jpeg', width, height, label: String(n) })),
      { videoId: id, kind: 'POSTER', storageKey: posterKey, mimeType: 'image/jpeg', width, height, isDefault: true, meta: { source: 'auto', index: 2 } },
    ],
  });
  return db.video.update({ where: { id }, data: { posterKey, hlsMasterKey: keys.hlsMaster(id), width, height } });
}
