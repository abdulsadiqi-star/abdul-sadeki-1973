/**
 * Public URL helpers for stored media. Everything is served by the
 * `/media/[...key]` route handler, which enforces visibility rules.
 *
 *   mediaUrl('images/avatars/u1/abc.webp') → '/media/images/avatars/u1/abc.webp'
 */
export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export const hlsMasterUrl = (videoId: string) => `/media/videos/${videoId}/hls/master.m3u8`;

/** Initials for avatar fallbacks ("علی رضایی" → "ع‌ر", "john doe" → "JD"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0] ?? '?';
  const second = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
  const joined = /[؀-ۿ]/.test(first) && second ? `${first}‌${second}` : `${first}${second}`;
  return joined.toUpperCase();
}
