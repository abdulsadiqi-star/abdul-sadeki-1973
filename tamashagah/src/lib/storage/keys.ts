/**
 * Storage key layout. ALWAYS build keys with these helpers — never from raw
 * user input — and validate keys that arrive from the outside with `assertSafeKey`.
 *
 *   uploads/<videoId>                       raw upload (PRIVATE, never served)
 *   videos/<videoId>/hls/master.m3u8        HLS master playlist
 *   videos/<videoId>/hls/<h>p/index.m3u8    one variant playlist per rendition
 *   videos/<videoId>/hls/<h>p/seg_00001.ts  segments
 *   videos/<videoId>/thumbs/auto_N.jpg      generated candidate frames
 *   videos/<videoId>/thumbs/poster_<t>.jpg  active poster (token changes ⇒ cache-safe)
 *   videos/<videoId>/subs/<lang>.vtt        subtitles
 *   images/avatars/<ownerId>/<token>.webp   channel/user avatars (public)
 *   images/banners/<channelId>/<token>.webp channel banners (public)
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/=]*$/;

export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.length > 512 ||
    !SAFE_KEY.test(key) ||
    key.includes('..') ||
    key.includes('//') ||
    key.endsWith('/.')
  ) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key.slice(0, 80))}`);
  }
}

export const keys = {
  upload: (videoId: string) => `uploads/${videoId}`,
  videoPrefix: (videoId: string) => `videos/${videoId}/`,
  hlsMaster: (videoId: string) => `videos/${videoId}/hls/master.m3u8`,
  hlsRenditionPrefix: (videoId: string, height: number) => `videos/${videoId}/hls/${height}p/`,
  hlsRenditionPlaylist: (videoId: string, height: number) => `videos/${videoId}/hls/${height}p/index.m3u8`,
  autoThumb: (videoId: string, n: number) => `videos/${videoId}/thumbs/auto_${n}.jpg`,
  poster: (videoId: string, token: string) => `videos/${videoId}/thumbs/poster_${token}.jpg`,
  subtitle: (videoId: string, lang: string) => `videos/${videoId}/subs/${lang}.vtt`,
  avatar: (ownerId: string, token: string, ext = 'webp') => `images/avatars/${ownerId}/${token}.${ext}`,
  banner: (channelId: string, token: string, ext = 'webp') => `images/banners/${channelId}/${token}.${ext}`,
} as const;

/** Keys the public `/media/*` route may serve (everything else is private). */
export function isPublicMediaKey(key: string): { videoId: string } | { public: true } | null {
  if (/^images\/(avatars|banners)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/.test(key)) {
    return { public: true };
  }
  const m = /^videos\/([0-9A-Za-z]{11})\/(hls\/.+|thumbs\/[A-Za-z0-9_.-]+\.jpg|subs\/[A-Za-z-]+\.vtt)$/.exec(key);
  return m ? { videoId: m[1]! } : null;
}
