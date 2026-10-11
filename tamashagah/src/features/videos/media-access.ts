/**
 * Visibility facts the media route needs about a video, with a tiny in-process cache (media requests are bursty:
 * one playback fires dozens of segment requests). Runtime-agnostic: no `next/*`.
 *
 * The cache is per process and short-lived on purpose. Code that changes visibility / publishing / processing state
 * in the SAME process calls `invalidateVideoAccess` so the change applies immediately; other processes (the worker,
 * other instances) converge within `ACCESS_TTL_MS`.
 */
import { db } from '@/lib/db';
import type { VideoAccessInfo } from '@/lib/permissions';

const ACCESS_TTL_MS = 10_000;
const MAX_ENTRIES = 5_000;

const cache = new Map<string, { at: number; value: VideoAccessInfo | null }>();

export async function loadVideoAccess(videoId: string): Promise<VideoAccessInfo | null> {
  const hit = cache.get(videoId);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.value;
  const row = await db.video.findUnique({
    where: { id: videoId },
    select: {
      channelId: true,
      visibility: true,
      publishStatus: true,
      processingStatus: true,
      takedownAt: true,
      channel: { select: { suspendedAt: true } },
    },
  });
  const value: VideoAccessInfo | null = row
    ? {
        channelId: row.channelId,
        visibility: row.visibility,
        publishStatus: row.publishStatus,
        processingStatus: row.processingStatus,
        takedownAt: row.takedownAt,
        channelSuspendedAt: row.channel.suspendedAt,
      }
    : null;
  if (cache.size > MAX_ENTRIES) cache.clear();
  cache.set(videoId, { at: Date.now(), value });
  return value;
}

/** Forget a video's cached access info (call after changing its visibility / publish / processing state). */
export function invalidateVideoAccess(videoId: string): void {
  cache.delete(videoId);
}

/** Test helper. */
export function clearVideoAccessCache(): void {
  cache.clear();
}
