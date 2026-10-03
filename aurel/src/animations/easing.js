// Easing + interpolation helpers. All motion in the project uses these slow,
// heavy curves — nothing playful, nothing fast.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const remap = (v, a, b) => clamp((v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = remap(v, a, b);
  return t * t * (3 - 2 * t);
};
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

/** CSS-style cubic-bezier(x1,y1,x2,y2) → easing function (Newton + bisection). */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-5) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-5) break;
      if (e > 0) hi = t; else lo = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

export const ease = {
  linear: (t) => t,
  /** heavy, expensive in/out — the default camera & part curve */
  heavy: bezier(0.65, 0, 0.15, 1),
  /** long soft settle, for objects arriving */
  silk: bezier(0.22, 0.61, 0.36, 1),
  /** symmetrical, gentle */
  soft: bezier(0.45, 0, 0.25, 1),
  /** slow start, glides out — type reveals */
  reveal: bezier(0.16, 1, 0.3, 1),
  /** mechanical settle with a hair of overshoot — parts locking home */
  lock: bezier(0.3, 0.0, 0.2, 1.06),
};
