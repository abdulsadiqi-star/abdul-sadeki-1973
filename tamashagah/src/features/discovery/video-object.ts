/**
 * schema.org `VideoObject` for a PUBLIC video (rich results in search engines). Pure: the caller decides whether the video
 * may be indexed (public, not taken down) and serialises the result with `JsonLd` (JSON only, `<` escaped).
 */

/** ISO 8601 duration for a number of seconds: 0 → PT0S, 90 → PT1M30S, 3661 → PT1H1M1S. */
export function isoDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `PT${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${seconds || (!hours && !minutes) ? `${seconds}S` : ''}`;
}

export type VideoObjectInput = {
  /** Absolute origin without a trailing slash, e.g. `https://tamashagah.example`. */
  base: string;
  id: string;
  title: string;
  description: string;
  /** Site-relative media URL (`/media/...`) or null. */
  posterUrl: string | null;
  /** Site-relative HLS master URL or null. */
  hlsUrl: string | null;
  uploadDate: Date;
  durationSeconds: number | null;
  viewCount: number;
  channel: { name: string; handle: string };
};

export function videoObjectJsonLd(v: VideoObjectInput): Record<string, unknown> {
  const description = v.description.replace(/\s+/g, ' ').trim();
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: v.title,
    description: description || v.title,
    url: `${v.base}/watch/${v.id}`,
    inLanguage: 'fa-IR',
    uploadDate: v.uploadDate.toISOString(),
    ...(v.posterUrl ? { thumbnailUrl: [`${v.base}${v.posterUrl}`] } : {}),
    ...(v.durationSeconds && v.durationSeconds > 0 ? { duration: isoDuration(v.durationSeconds) } : {}),
    ...(v.hlsUrl ? { contentUrl: `${v.base}${v.hlsUrl}` } : {}),
    author: { '@type': 'Organization', name: v.channel.name, url: `${v.base}/channel/${v.channel.handle}` },
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'WatchAction' },
      userInteractionCount: v.viewCount,
    },
  };
}
