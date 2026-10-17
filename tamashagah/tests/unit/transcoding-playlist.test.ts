import { describe, expect, it } from 'vitest';
import { analyzeMediaPlaylist, bandwidthOf, buildMasterPlaylist, type MasterVariant } from '@/features/transcoding/playlist';

const variant = (over: Partial<MasterVariant> = {}): MasterVariant => ({
  name: '720p',
  uri: '720p/index.m3u8',
  width: 1280,
  height: 720,
  bandwidth: 2_800_000,
  codecs: 'avc1.64001f,mp4a.40.2',
  ...over,
});

describe('master playlist builder', () => {
  it('writes BANDWIDTH, RESOLUTION, CODECS and NAME for every variant', () => {
    const text = buildMasterPlaylist([variant({ averageBandwidth: 2_400_000, frameRate: 29.97 })]);
    expect(text.startsWith('#EXTM3U\n')).toBe(true);
    expect(text).toContain('#EXT-X-INDEPENDENT-SEGMENTS');
    expect(text).toContain(
      '#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE-BANDWIDTH=2400000,RESOLUTION=1280x720,FRAME-RATE=29.970,CODECS="avc1.64001f,mp4a.40.2",NAME="720p"\n720p/index.m3u8\n',
    );
    expect(text.endsWith('\n')).toBe(true);
  });

  it('lists the lowest bandwidth first and keeps every variant', () => {
    const text = buildMasterPlaylist([
      variant({ name: '1080p', uri: '1080p/index.m3u8', width: 1920, height: 1080, bandwidth: 5_100_000 }),
      variant({ name: '360p', uri: '360p/index.m3u8', width: 640, height: 360, bandwidth: 800_000 }),
      variant(),
    ]);
    const uris = text.split('\n').filter((l) => l.endsWith('.m3u8'));
    expect(uris).toEqual(['360p/index.m3u8', '720p/index.m3u8', '1080p/index.m3u8']);
  });

  it('omits optional attributes and cannot be broken by quotes in names', () => {
    const text = buildMasterPlaylist([variant({ name: 'a"b\nc' })]);
    expect(text).not.toContain('AVERAGE-BANDWIDTH');
    expect(text).not.toContain('FRAME-RATE');
    expect(text).toContain('NAME="abc"');
    expect(text.split('\n').filter((l) => l.startsWith('#EXT-X-STREAM-INF'))).toHaveLength(1);
  });

  it('audio-less variants can declare video-only codecs', () => {
    expect(buildMasterPlaylist([variant({ codecs: 'avc1.64001e' })])).toContain('CODECS="avc1.64001e"');
  });
});

describe('media playlist analysis', () => {
  const text = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:6.006000,
seg_00000.ts
#EXTINF:6.006000,
seg_00001.ts
#EXTINF:2.500000,
seg_00002.ts
#EXT-X-ENDLIST
`;

  it('reads segments, target duration and the end marker', () => {
    const info = analyzeMediaPlaylist(text);
    expect(info.segments.map((s) => s.uri)).toEqual(['seg_00000.ts', 'seg_00001.ts', 'seg_00002.ts']);
    expect(info.targetDuration).toBe(6);
    expect(info.totalDuration).toBeCloseTo(14.512, 3);
    expect(info.ended).toBe(true);
  });

  it('tolerates empty or partial playlists', () => {
    expect(analyzeMediaPlaylist('').segments).toEqual([]);
    expect(analyzeMediaPlaylist('#EXTM3U\n#EXTINF:6,\n').segments).toEqual([]);
  });
});

describe('bandwidth', () => {
  it('reports the PEAK segment rate and the average rate in bits per second', () => {
    const { peak, average } = bandwidthOf([
      { duration: 6, bytes: 750_000 }, // 1 Mbit/s
      { duration: 6, bytes: 1_500_000 }, // 2 Mbit/s
      { duration: 3, bytes: 375_000 }, // 1 Mbit/s
    ]);
    expect(peak).toBe(2_000_000);
    expect(average).toBe(Math.ceil((2_625_000 * 8) / 15));
  });

  it('ignores zero-duration segments and handles empty input', () => {
    expect(bandwidthOf([])).toEqual({ peak: 0, average: 0 });
    expect(bandwidthOf([{ duration: 0, bytes: 1000 }])).toEqual({ peak: 0, average: 0 });
  });
});
