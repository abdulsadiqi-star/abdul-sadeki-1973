import { ease as easings } from './easing.js';

/**
 * A Track is a scroll-progress → number function built from keyframes:
 *   track([[p0, v0], [p1, v1, easeFn], ...])
 * The easing on a key shapes the segment that *arrives* at that key.
 * Pure function of p → scrubbing backwards is therefore perfectly reversible.
 */
export function track(keys, defaultEase = easings.heavy) {
  const ks = keys.map(([t, v, e]) => ({ t, v, e: e || defaultEase }));
  ks.sort((a, b) => a.t - b.t);
  const n = ks.length;
  return (p) => {
    if (p <= ks[0].t) return ks[0].v;
    if (p >= ks[n - 1].t) return ks[n - 1].v;
    let i = 1;
    while (i < n - 1 && p > ks[i].t) i++;
    const a = ks[i - 1], b = ks[i];
    const span = b.t - a.t;
    const f = span > 0 ? b.e((p - a.t) / span) : 1;
    return a.v + (b.v - a.v) * f;
  };
}

/** Evaluate a flat map of tracks into a plain state object (dot paths allowed). */
export function sampleInto(tracks, p, state) {
  for (const key in tracks) {
    const parts = key.split('.');
    let o = state;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
    o[parts[parts.length - 1]] = tracks[key](p);
  }
  return state;
}
