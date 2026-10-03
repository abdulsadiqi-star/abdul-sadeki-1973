// Device / capability detection. Everything quality-related reads from here.

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function isCompact() {
  return matchMedia('(max-width: 820px)').matches;
}

export function isTouch() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

/** Render-quality profile. Mobile / low-power devices get cheaper everything. */
export function getQuality() {
  const compact = isCompact() || (isTouch() && Math.min(innerWidth, innerHeight) < 700);
  const cores = navigator.hardwareConcurrency || 4;
  const low = compact || cores <= 4;
  return {
    compact,
    pointer: !isTouch() && !reducedMotion,
    dpr: Math.min(devicePixelRatio || 1, compact ? 1.5 : 2),
    antialias: !compact,
    seg: compact ? 0.6 : 1, // multiplier on lathe / gear segment counts
    texSize: compact ? 1024 : 2048,
    anisotropy: compact ? 2 : 8,
    low,
  };
}
