import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { parseRangeHeader } from '@/lib/http-range';
import { logger } from '@/lib/logger';
import { canViewVideo } from '@/lib/permissions';
import { assertSafeKey, getStorage, isPublicMediaKey } from '@/lib/storage';
import { loadVideoAccess } from '@/features/videos/media-access';

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
 *  - MEDIA_DELIVERY=redirect (s3 only): playlists, posters and subtitles are still streamed by the app, but HLS
 *    SEGMENTS are answered with a 302 to a short-lived presigned URL, so the heavy bytes never pass through Node.
 *    The visibility check above has already happened by then, so the rules are unchanged. The bucket needs a CORS
 *    rule for the site origin (hls.js fetches segments with XHR) — see docs/features/media.md.
 */

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

type Mode = 'public-asset' | 'open' | 'unlisted' | 'restricted';

/** HLS media segments (the bulk of the bytes). Everything else is small and stays behind the app. */
const SEGMENT_KEY = /\/hls\/[^/]+\/[^/]+\.(?:ts|m4s|mp4|aac)$/;

/** Lifetime of a presigned segment URL. Players request segments right after the redirect, so a few minutes suffice. */
const PRESIGN_SECONDS = 300;

function cacheControlFor(key: string, mode: Mode): string {
  if (mode === 'restricted') return 'private, no-store';
  if (mode === 'unlisted') return 'private, max-age=300';
  if (key.endsWith('.m3u8')) return 'public, max-age=30, stale-while-revalidate=60';
  // Subtitles can be replaced under the same key: keep them fresh (ETag revalidation handles the rest).
  if (key.endsWith('.vtt')) return 'public, max-age=60';
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

  let mode: Mode = 'public-asset';
  if ('videoId' in target) {
    const access = await loadVideoAccess(target.videoId);
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
    if (env.MEDIA_DELIVERY === 'redirect' && storage.kind === 's3' && SEGMENT_KEY.test(key)) {
      const url = await storage.presignGet(key, PRESIGN_SECONDS);
      if (url) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: url,
            // The redirect may be reused by the browser cache, but never longer than the signature lives.
            'Cache-Control': mode === 'restricted' ? 'private, no-store' : `private, max-age=${PRESIGN_SECONDS - 60}`,
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
    }

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
