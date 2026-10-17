import { describe, expect, it } from 'vitest';
import { avcCodecString, pickH264Level } from '@/features/transcoding/h264';
import { evenFloor, evenRound, planRenditions, planThumbnails, thumbnailSize } from '@/features/transcoding/plan';

const labels = (specs: ReturnType<typeof planRenditions>) => specs.map((s) => s.label);
const dims = (specs: ReturnType<typeof planRenditions>) => specs.map((s) => `${s.width}x${s.height}`);

describe('rendition planner: the ladder is defined by the short side and never upscales', () => {
  it('1080p landscape gets the full ladder', () => {
    const plan = planRenditions({ width: 1920, height: 1080, fps: 30 });
    expect(labels(plan)).toEqual(['1080p', '720p', '480p', '360p']);
    expect(dims(plan)).toEqual(['1920x1080', '1280x720', '854x480', '640x360']);
  });

  it('720p source: no 1080p rung', () => {
    const plan = planRenditions({ width: 1280, height: 720, fps: 30 });
    expect(labels(plan)).toEqual(['720p', '480p', '360p']);
  });

  it('360p source yields exactly ONE 360p rendition at source size', () => {
    const plan = planRenditions({ width: 640, height: 360, fps: 30 });
    expect(labels(plan)).toEqual(['360p']);
    expect(dims(plan)).toEqual(['640x360']);
  });

  it('sources below 360 get a single rendition at their own even size', () => {
    expect(dims(planRenditions({ width: 426, height: 240, fps: 25 }))).toEqual(['426x240']);
    expect(labels(planRenditions({ width: 426, height: 240, fps: 25 }))).toEqual(['240p']);
    // odd source dimensions are floored to even (never rounded UP: that would be an upscale)
    expect(dims(planRenditions({ width: 321, height: 181, fps: 25 }))).toEqual(['320x180']);
  });

  it('portrait works the same way (ladder by the SHORT side)', () => {
    const plan = planRenditions({ width: 1080, height: 1920, fps: 30 });
    expect(labels(plan)).toEqual(['1080p', '720p', '480p', '360p']);
    expect(dims(plan)).toEqual(['1080x1920', '720x1280', '480x854', '360x640']);
    expect(labels(planRenditions({ width: 720, height: 1280, fps: 30 }))).toEqual(['720p', '480p', '360p']);
    expect(dims(planRenditions({ width: 360, height: 640, fps: 30 }))).toEqual(['360x640']);
  });

  it('square sources keep a square picture', () => {
    expect(dims(planRenditions({ width: 1080, height: 1080, fps: 30 }))).toEqual(['1080x1080', '720x720', '480x480', '360x360']);
  });

  it('only rungs <= the source short side are used (in-between sizes round down the ladder)', () => {
    expect(labels(planRenditions({ width: 1000, height: 1000, fps: 30 }))).toEqual(['720p', '480p', '360p']);
    expect(labels(planRenditions({ width: 960, height: 540, fps: 30 }))).toEqual(['480p', '360p']);
  });

  it('ultra-wide sources scale by their short side', () => {
    const plan = planRenditions({ width: 2560, height: 1080, fps: 30 });
    expect(dims(plan)[0]).toBe('2560x1080');
    expect(dims(plan)[1]).toBe('1706x720');
  });

  it('never exceeds the source in either dimension and always yields even sizes (property check)', () => {
    const sizes = [16, 17, 100, 241, 359, 360, 361, 479, 480, 481, 719, 720, 853, 1079, 1080, 1081, 1279, 1280, 1921, 2160, 4320];
    for (const w of sizes) {
      for (const h of sizes) {
        for (const spec of planRenditions({ width: w, height: h, fps: 30 })) {
          expect(spec.width, `${w}x${h} -> ${spec.label}`).toBeLessThanOrEqual(Math.max(2, evenFloor(w)));
          expect(spec.height, `${w}x${h} -> ${spec.label}`).toBeLessThanOrEqual(Math.max(2, evenFloor(h)));
          expect(spec.width % 2).toBe(0);
          expect(spec.height % 2).toBe(0);
        }
      }
    }
  });

  it('keeps the aspect ratio within one pixel of rounding', () => {
    const plan = planRenditions({ width: 1920, height: 1080, fps: 30 });
    for (const spec of plan) expect(Math.abs(spec.width / spec.height - 1920 / 1080)).toBeLessThan(0.01);
  });

  it('bitrates fall with the rung and the H.264 level fits the picture', () => {
    const plan = planRenditions({ width: 1920, height: 1080, fps: 30 });
    const rates = plan.map((s) => s.videoKbps);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    expect(plan.map((s) => s.level)).toEqual(['4.0', '3.1', '3.1', '3.0']);
    for (const s of plan) {
      expect(s.maxrateKbps).toBe(s.videoKbps);
      expect(s.bufsizeKbps).toBe(s.videoKbps * 2);
    }
  });

  it('tiny sources never get a bitrate above the 360p ceiling', () => {
    const [only] = planRenditions({ width: 426, height: 240, fps: 25 });
    expect(only!.videoKbps).toBeLessThanOrEqual(800);
    expect(only!.videoKbps).toBeGreaterThanOrEqual(200);
  });
});

describe('even rounding helpers', () => {
  it('rounds to even and never below 2', () => {
    expect(evenRound(853.33)).toBe(854);
    expect(evenRound(1706.67)).toBe(1706);
    expect(evenRound(855)).toBe(856);
    expect(evenRound(0)).toBe(2);
    expect(evenFloor(321)).toBe(320);
    expect(evenFloor(1)).toBe(2);
  });
});

describe('H.264 levels', () => {
  it('picks the smallest level that holds the picture at the frame rate', () => {
    expect(pickH264Level(1920, 1080, 30).label).toBe('4.0');
    expect(pickH264Level(1920, 1080, 60).label).toBe('4.2');
    expect(pickH264Level(1280, 720, 30).label).toBe('3.1');
    expect(pickH264Level(1280, 720, 60).label).toBe('3.2');
    expect(pickH264Level(640, 360, 30).label).toBe('3.0');
    expect(pickH264Level(3840, 2160, 30).label).toBe('5.1');
  });

  it('formats the RFC 6381 codec string', () => {
    expect(avcCodecString({ idc: 31 })).toBe('avc1.64001f');
    expect(avcCodecString({ idc: 40 })).toBe('avc1.640028');
    expect(avcCodecString({ idc: 30 })).toBe('avc1.64001e');
  });
});

describe('thumbnail planning', () => {
  it('spreads three candidates over the clip and keeps them inside it', () => {
    const thumbs = planThumbnails(100, 1920, 1080);
    expect(thumbs.map((t) => t.index)).toEqual([1, 2, 3]);
    expect(thumbs.map((t) => t.atSeconds)).toEqual([12, 45, 78]);
    expect(planThumbnails(0.5, 640, 360).every((t) => t.atSeconds >= 0 && t.atSeconds <= 0.4)).toBe(true);
  });

  it('fits the thumbnail box without upscaling (landscape and portrait)', () => {
    expect(thumbnailSize(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(thumbnailSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(thumbnailSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(thumbnailSize(3840, 1080)).toEqual({ width: 1280, height: 360 });
  });
});
