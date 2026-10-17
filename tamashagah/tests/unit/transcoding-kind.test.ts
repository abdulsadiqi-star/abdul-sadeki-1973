import { describe, expect, it } from 'vitest';
import { detectKind, resolveKind } from '@/features/transcoding/kind';
import { SHORTS_MAX_SECONDS } from '@/config/site';

describe('video kind detection', () => {
  it('portrait and square clips up to the shorts limit are SHORTs', () => {
    expect(detectKind({ width: 1080, height: 1920, durationSeconds: 45 })).toBe('SHORT');
    expect(detectKind({ width: 1080, height: 1080, durationSeconds: 30 })).toBe('SHORT');
    expect(detectKind({ width: 720, height: 1280, durationSeconds: SHORTS_MAX_SECONDS })).toBe('SHORT');
  });

  it('too long portrait clips and every landscape clip are regular VIDEOs', () => {
    expect(detectKind({ width: 1080, height: 1920, durationSeconds: SHORTS_MAX_SECONDS + 0.5 })).toBe('VIDEO');
    expect(detectKind({ width: 1920, height: 1080, durationSeconds: 20 })).toBe('VIDEO');
  });

  it('an explicit creator choice always wins over detection', () => {
    expect(resolveKind('auto', 'VIDEO', 'SHORT')).toBe('SHORT');
    expect(resolveKind('auto', 'VIDEO', 'VIDEO')).toBe('VIDEO');
    expect(resolveKind('VIDEO', 'VIDEO', 'SHORT')).toBe('VIDEO');
    expect(resolveKind('SHORT', 'SHORT', 'VIDEO')).toBe('SHORT');
  });
});
