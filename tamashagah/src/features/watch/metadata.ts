/**
 * Page metadata and structured data for /watch/[id]. Pure builders (no I/O) so they are unit-tested
 * (tests/unit/watch-metadata.test.ts).
 */
import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';
import { truncate } from '@/lib/persian';
import type { WatchVideo } from './queries';

/** Hidden / unknown videos get this: it must not reveal whether the video exists. */
export const hiddenVideoMetadata: Metadata = {
  title: 'ویدیو پیدا نشد',
  robots: { index: false, follow: false },
};

/** Plain-text summary for meta descriptions (no line breaks, no hashtags noise, ≤ 160 characters). */
export function descriptionSummary(video: Pick<WatchVideo, 'title' | 'description' | 'channel'>, max = 160): string {
  const text = video.description.replace(/\s+/g, ' ').trim();
  return truncate(text || `تماشای «${video.title}» از ${video.channel.name} در ${siteConfig.name}`, max);
}

/** Seconds → ISO 8601 duration ("PT1M30S"), as schema.org expects. */
export function isoDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${sec || (!h && !m) ? `${sec}S` : ''}`;
}

const absolute = (baseUrl: string, path: string | null) => (path ? new URL(path, baseUrl).toString() : null);

export function buildVideoMetadata(video: WatchVideo, baseUrl: string): Metadata {
  const description = descriptionSummary(video);
  const url = `/watch/${video.id}`;
  const poster = absolute(baseUrl, video.posterUrl);
  return {
    title: video.title,
    description,
    alternates: { canonical: url },
    // Only public, listed videos belong in search engines (unlisted = "anyone with the link", never indexed).
    robots: video.access.listed ? { index: true, follow: true } : { index: false, follow: false },
    keywords: video.tags.length ? video.tags : undefined,
    openGraph: {
      type: 'video.other',
      title: video.title,
      description,
      url,
      siteName: siteConfig.name,
      locale: 'fa_IR',
      images: poster ? [{ url: poster, width: 1280, height: 720, alt: video.title }] : undefined,
      videos: video.access.publiclyWatchable
        ? [{ url: absolute(baseUrl, video.hlsUrl)!, type: 'application/vnd.apple.mpegurl', width: video.width ?? undefined, height: video.height ?? undefined }]
        : undefined,
    },
    twitter: { card: poster ? 'summary_large_image' : 'summary', title: video.title, description, images: poster ? [poster] : undefined },
  };
}

/** schema.org VideoObject — emitted only for public, listed videos. */
export function buildVideoJsonLd(video: WatchVideo, baseUrl: string): Record<string, unknown> | null {
  if (!video.access.listed) return null;
  const watchUrl = absolute(baseUrl, `/watch/${video.id}`)!;
  const poster = absolute(baseUrl, video.posterUrl);
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: descriptionSummary(video, 300),
    url: watchUrl,
    ...(poster ? { thumbnailUrl: [poster] } : {}),
    uploadDate: video.publishedAt,
    ...(video.durationSeconds ? { duration: isoDuration(video.durationSeconds) } : {}),
    contentUrl: absolute(baseUrl, video.hlsUrl),
    inLanguage: video.language,
    ...(video.category ? { genre: video.category.nameFa } : {}),
    ...(video.tags.length ? { keywords: video.tags.join('، ') } : {}),
    author: { '@type': 'Person', name: video.channel.name, url: absolute(baseUrl, `/channel/${video.channel.handle}`) },
    publisher: { '@type': 'Organization', name: siteConfig.name, url: baseUrl },
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: video.viewCount },
      { '@type': 'InteractionCounter', interactionType: { '@type': 'LikeAction' }, userInteractionCount: video.likeCount },
      { '@type': 'InteractionCounter', interactionType: { '@type': 'CommentAction' }, userInteractionCount: video.commentCount },
    ],
  };
}

/** Serialize JSON-LD for an inline <script>: `<` and the JS line separators are escaped so the data can never close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
}
