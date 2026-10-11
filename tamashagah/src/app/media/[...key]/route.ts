import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { parseRangeHeader } from '@/lib/http-range';
import { logger } from '@/lib/logger';
import { canViewVideo, type VideoAccessInfo } from '@/lib/permissions';
import { assertSafeKey, getStorage, isPublicMediaKey } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Media delivery: GET /media/<storage key>
 *
 *  - Only allow-listed key shapes are ever served (see isPublicMediaKey). The raw
 *    upload (`uploads/…`) and anything else in the bucket is unreachable.
 *  - Video assets (HLS, thumbnails, subtitles) obey the video's visibility:
 *    listed/unlisted videos are open, drafts/private/taken-down videos are only
 *    served to the owner and moderators. Everyone else gets a plain 404.
 *  - Supports HTTP Range and ETag/If-None-Match (required for HLS + seeking).
 */

type Access = VideoAccessInfo;
const accessCache = new Map<string, { at: number; value: Access | null }>();
const ACCESS_TTL_MS = 10_000;

async function loadAccess(videoId: string): Promise<Access | null> {
  const hit = accessCache.get(videoId);
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
  const value: Access | null = row
    ? {
        channelId: row.channelId,
        visibility: row.visibility,
        publishStatus: row.publishStatus,
        processingStatus: row.processingStatus,
        takedownAt: row.takedownAt,
        channelSuspendedAt: row.channel.suspendedAt,
      }
    : null;
  if (accessCache.size > 5_000) accessCache.clear();
  accessCache.set(videoId, { at: Date.now(), value });
  return value;
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

function cacheControlFor(key: string, mode: 'public-asset' | 'open' | 'unlisted' | 'restricted'): string {
  if (mode === 'restricted') return 'private, no-store';
  if (mode === 'unlisted') return 'private, max-age=300';
  if (key.endsWith('.m3u8')) return 'public, max-age=30, stale-while-revalidate=60';
  if (mode === 'public-asset' || /\/(seg_|init|poster_)/.test(key)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.join('/');
  try {
    assertSafeKey(key);
  } catch {
    return notFound();
  }

  const target = isPublicMediaKey(key);
  if (!target) return notFound();

  let mode: 'public-asset' | 'open' | 'unlisted' | 'restricted' = 'public-asset';
  if ('videoId' in target) {
    const access = await loadAccess(target.videoId);
    if (!access) return notFound();
    if (canViewVideo(null, access)) {
      mode = access.visibility === 'PUBLIC' ? 'open' : 'unlisted';
    } else {
      const user = await getCurrentUser();
      if (!canViewVideo(toActor(user), access)) return notFound();
      mode = 'restricted';
    }
  }

  const storage = getStorage();
  try {
    const head = await storage.head(key);
    if (!head) return notFound();

    const baseHeaders: Record<string, string> = {
      'Content-Type': head.contentType ?? 'application/octet-stream',
      'Cache-Control': cacheControlFor(key, mode),
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    };
    if (head.etag) baseHeaders.ETag = head.etag;
    if (head.lastModified) baseHeaders['Last-Modified'] = head.lastModified.toUTCString();

    if (head.etag && req.headers.get('if-none-match') === head.etag) {
      return new Response(null, { status: 304, headers: baseHeaders });
    }

    const range = parseRangeHeader(req.headers.get('range'), head.size);
    if (range.type === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${head.size}` } });
    }

    const result =
      range.type === 'partial' ? await storage.get(key, { start: range.start, end: range.end }) : await storage.get(key);
    if (!result) return notFound();

    const body = Readable.toWeb(result.stream) as ReadableStream;
    if (range.type === 'partial') {
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${head.size}`,
        },
      });
    }
    return new Response(body, { status: 200, headers: { ...baseHeaders, 'Content-Length': String(head.size) } });
  } catch (err) {
    logger.error({ err, key }, 'media delivery failed');
    return new Response('Media unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
