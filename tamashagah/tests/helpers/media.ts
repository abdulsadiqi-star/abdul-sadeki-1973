/**
 * Helpers for media / pipeline tests: generated fixtures (cached across runs) and "a video that has been uploaded".
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { db } from '@/lib/db';
import { newVideoId } from '@/lib/ids';
import { buildVideoSearchFields } from '@/lib/persian';
import { getStorage, keys } from '@/lib/storage';
import type { Prisma } from '@/generated/prisma/client';
import { generateFixture, type FixtureName } from '../../scripts/make-test-video.mjs';

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
