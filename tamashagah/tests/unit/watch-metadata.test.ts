import { describe, expect, it } from 'vitest';
import { buildVideoJsonLd, buildVideoMetadata, descriptionSummary, hiddenVideoMetadata, isoDuration, jsonLdString } from '@/features/watch/metadata';
import type { WatchVideo } from '@/features/watch/queries';

const BASE = 'https://tamashagah.example';

function video(overrides: Partial<WatchVideo> = {}, access: Partial<WatchVideo['access']> = {}): WatchVideo {
  return {
    id: 'AbCdEfGhIjK',
    title: 'پلو با ته‌دیگ طلایی',
    description: 'دستور پخت\nپلو   با ته‌دیگ #آشپزی',
    tags: ['آشپزی', 'پلو'],
    kind: 'VIDEO',
    language: 'fa',
    durationSeconds: 95,
    width: 1280,
    height: 720,
    processingStatus: 'READY',
    publishStatus: 'PUBLISHED',
    visibility: 'PUBLIC',
    takedownAt: null,
    takedownReason: null,
    failureReason: null,
    commentsEnabled: true,
    commentsMode: 'OPEN',
    viewCount: 1200,
    likeCount: 30,
    commentCount: 4,
    publishedAt: '2026-10-01T10:00:00.000Z',
    posterUrl: '/media/videos/AbCdEfGhIjK/thumbs/poster_x.jpg',
    hlsUrl: '/media/videos/AbCdEfGhIjK/hls/master.m3u8',
    category: { slug: 'cooking', nameFa: 'آشپزی' },
    channel: { id: 'ch1', handle: 'sara-cooks', name: 'آشپزی با سارا', avatarUrl: null, isVerified: false, followerCount: 10, ownerId: 'u1' },
    subtitles: [],
    access: { isOwner: false, isModerator: false, publiclyWatchable: true, listed: true, ...access },
    ...overrides,
  } as WatchVideo;
}

describe('isoDuration', () => {
  it.each([
    [0, 'PT0S'],
    [5, 'PT5S'],
    [60, 'PT1M'],
    [95, 'PT1M35S'],
    [3600, 'PT1H'],
    [3725, 'PT1H2M5S'],
    [24.4, 'PT24S'],
    [-3, 'PT0S'],
  ])('%s seconds → %s', (seconds, expected) => {
    expect(isoDuration(seconds)).toBe(expected);
  });
});

describe('descriptionSummary', () => {
  it('collapses whitespace and line breaks', () => {
    expect(descriptionSummary(video())).toBe('دستور پخت پلو با ته‌دیگ #آشپزی');
  });

  it('falls back to a sentence built from the title and channel', () => {
    const text = descriptionSummary(video({ description: '  \n ' }));
    expect(text).toContain('پلو با ته‌دیگ طلایی');
    expect(text).toContain('آشپزی با سارا');
  });

  it('never exceeds the requested length', () => {
    expect(descriptionSummary(video({ description: 'الف '.repeat(300) }), 100).length).toBeLessThanOrEqual(100);
  });
});

describe('buildVideoMetadata', () => {
  it('points at the canonical watch URL and indexes only public, listed videos', () => {
    const meta = buildVideoMetadata(video(), BASE);
    expect(meta.alternates?.canonical).toBe('/watch/AbCdEfGhIjK');
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(buildVideoMetadata(video({ visibility: 'UNLISTED' }, { listed: false }), BASE).robots).toEqual({ index: false, follow: false });
  });

  it('uses absolute media URLs for the social preview', () => {
    const meta = buildVideoMetadata(video(), BASE);
    const images = meta.openGraph && 'images' in meta.openGraph ? (meta.openGraph.images as Array<{ url: string }>) : [];
    expect(images[0]?.url).toBe(`${BASE}/media/videos/AbCdEfGhIjK/thumbs/poster_x.jpg`);
  });

  it('a hidden video leaks nothing', () => {
    expect(hiddenVideoMetadata.title).toBe('ویدیو پیدا نشد');
    expect(hiddenVideoMetadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('buildVideoJsonLd', () => {
  it('describes a listed video as a schema.org VideoObject', () => {
    const ld = buildVideoJsonLd(video(), BASE)!;
    expect(ld['@type']).toBe('VideoObject');
    expect(ld.name).toBe('پلو با ته‌دیگ طلایی');
    expect(ld.duration).toBe('PT1M35S');
    expect(ld.contentUrl).toBe(`${BASE}/media/videos/AbCdEfGhIjK/hls/master.m3u8`);
    expect(ld.url).toBe(`${BASE}/watch/AbCdEfGhIjK`);
  });

  it('is not emitted for videos that are not public and listed', () => {
    expect(buildVideoJsonLd(video({}, { listed: false }), BASE)).toBeNull();
  });
});

describe('jsonLdString', () => {
  it('can never close the surrounding <script> tag', () => {
    const out = jsonLdString({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>' });
  });

  it('escapes the JS line separators and still round-trips', () => {
    const value = { text: `a b c` };
    const out = jsonLdString(value);
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out)).toEqual(value);
  });
});
