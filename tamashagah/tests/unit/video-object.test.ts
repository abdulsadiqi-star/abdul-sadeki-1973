import { describe, expect, it } from 'vitest';
import { jsonLdString } from '@/features/discovery/components/json-ld';
import { isoDuration, videoObjectJsonLd } from '@/features/discovery/video-object';

describe('isoDuration', () => {
  it('formats seconds as an ISO 8601 duration', () => {
    expect(isoDuration(0)).toBe('PT0S');
    expect(isoDuration(7)).toBe('PT7S');
    expect(isoDuration(60)).toBe('PT1M');
    expect(isoDuration(90)).toBe('PT1M30S');
    expect(isoDuration(3600)).toBe('PT1H');
    expect(isoDuration(3661)).toBe('PT1H1M1S');
    expect(isoDuration(6.6)).toBe('PT7S');
    expect(isoDuration(-5)).toBe('PT0S');
  });
});

describe('videoObjectJsonLd', () => {
  const base = 'https://tamashagah.example';
  const input = {
    base,
    id: 'aB3dE5gH7jK',
    title: 'آموزش پایتون',
    description: '  جلسه‌ی اول\n\nنصب و شروع ',
    posterUrl: '/media/videos/aB3dE5gH7jK/thumbs/p.jpg',
    hlsUrl: '/media/videos/aB3dE5gH7jK/hls/master.m3u8',
    uploadDate: new Date('2026-10-01T10:00:00Z'),
    durationSeconds: 1110,
    viewCount: 42,
    channel: { name: 'آرمان تک', handle: 'arman-tech' },
  };

  it('describes a public video with absolute URLs, ISO date and duration', () => {
    const ld = videoObjectJsonLd(input);
    expect(ld).toMatchObject({
      '@type': 'VideoObject',
      name: 'آموزش پایتون',
      description: 'جلسه‌ی اول نصب و شروع',
      url: `${base}/watch/aB3dE5gH7jK`,
      uploadDate: '2026-10-01T10:00:00.000Z',
      duration: 'PT18M30S',
      thumbnailUrl: [`${base}/media/videos/aB3dE5gH7jK/thumbs/p.jpg`],
      contentUrl: `${base}/media/videos/aB3dE5gH7jK/hls/master.m3u8`,
      author: { name: 'آرمان تک', url: `${base}/channel/arman-tech` },
      interactionStatistic: { userInteractionCount: 42 },
    });
  });

  it('omits what it does not have instead of inventing it', () => {
    const ld = videoObjectJsonLd({ ...input, posterUrl: null, hlsUrl: null, durationSeconds: null, description: '' });
    expect(ld).not.toHaveProperty('thumbnailUrl');
    expect(ld).not.toHaveProperty('contentUrl');
    expect(ld).not.toHaveProperty('duration');
    expect(ld.description).toBe('آموزش پایتون');
  });

  it('serialises as JSON that cannot close the script element', () => {
    const text = jsonLdString(videoObjectJsonLd({ ...input, title: '</script><script>alert(1)</script>' }));
    expect(text).not.toContain('</script>');
    expect(text).toContain('\\u003c/script>');
    expect(JSON.parse(text).name).toBe('</script><script>alert(1)</script>');
  });
});
