import * as THREE from 'three';
import { track, sampleInto } from './tracks.js';
import { ease, clamp, remap, lerp } from './easing.js';

/**
 * The whole film as pure functions of scroll progress p ∈ [0,1].
 * Nothing here triggers — everything is scrubbed, so scrolling backwards
 * reverses every move exactly.
 */

export const FOV = 24;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

export const CHAPTERS = [
  { id: 'hero',      n: '01', name: 'Hero',        a: 0.0,   b: 0.085 },
  { id: 'form',      n: '02', name: 'Form',        a: 0.085, b: 0.2 },
  { id: 'depth',     n: '03', name: 'Depth',       a: 0.2,   b: 0.3 },
  { id: 'exploded',  n: '04', name: 'Exploded',    a: 0.3,   b: 0.55 },
  { id: 'calibre',   n: '05', name: 'The calibre', a: 0.55,  b: 0.7 },
  { id: 'precision', n: '06', name: 'Precision',   a: 0.7,   b: 0.8 },
  { id: 'reassembly',n: '07', name: 'Reassembly',  a: 0.8,   b: 0.925 },
  { id: 'final',     n: '08', name: 'A01',         a: 0.925, b: 1.0 },
];

// Explosion progress E (0 → 1 → 0). Held at 1 while the visitor inspects.
export const E_KEYS = { start: 0.325, full: 0.485, holdEnd: 0.8, closed: 0.925 };

/**
 * Choreography: each part owns a window [a,b] of E. Order follows the brief:
 * crystal → bezel → hands → chapter/markers → dial → case → calibre → bridges →
 * gear train → rotor → caseback → straps. Reassembly plays the same windows in
 * reverse, so the crystal comes down last.
 */
export const WINDOWS = {
  crystal: [0.0, 0.3], bezel: [0.06, 0.36],
  hourHand: [0.12, 0.4], minuteHand: [0.14, 0.42], secondsHand: [0.16, 0.44], centerPin: [0.18, 0.46],
  chapterRing: [0.22, 0.52], hourMarkers: [0.25, 0.55],
  dial: [0.3, 0.6], dateWindow: [0.33, 0.63], innerDial: [0.36, 0.66],
  case: [0.4, 0.7], crown: [0.44, 0.72], crownStem: [0.46, 0.74],
  movementHolder: [0.5, 0.78], mainPlate: [0.54, 0.82],
  bridges: [0.58, 0.86], gearTrain: [0.62, 0.89], balanceWheel: [0.64, 0.91],
  rotor: [0.68, 0.94], jewels: [0.7, 0.96], screws: [0.72, 0.97],
  casebackCrystal: [0.74, 0.98], casebackRing: [0.76, 1.0],
  strapUpper: [0.8, 1.0], strapLower: [0.82, 1.0], buckle: [0.84, 1.0],
};

/** Macro-inspection order in chapter 05 (centre of each focus beat, in p). */
export const FOCUS = [
  { id: 'balanceWheel', p: 0.585, key: 'balance', d: 100 },
  { id: 'gearTrain',    p: 0.615, key: 'train',   d: 120 },
  { id: 'rotor',        p: 0.645, key: 'rotor',   d: 120 },
  { id: 'jewels',       p: 0.672, key: 'jewels',  d: 92 },
  { id: 'bridges',      p: 0.697, key: 'bridges', d: 120 },
];

export const partT = (id, E) => {
  const w = WINDOWS[id];
  return w ? ease.heavy(remap(E, w[0], w[1])) : 0;
};

const T = (...k) => track(k);
const TL = (...k) => track(k, ease.linear);

/** Camera distance that fits `H` mm of height *and* `W` mm of width. */
export const fitDist = (H, W, aspect) => Math.max(H / (2 * TAN), W / (2 * TAN * aspect));

export function buildTimeline(layout, watch, aspect) {
  const P = layout.portrait;
  const B = layout.bounds;
  const slot = (id) => watch.parts.get(id).slot;
  const mid = new THREE.Vector3().add(slot('bridges')).add(slot('gearTrain')).add(slot('rotor')).add(slot('mainPlate')).add(slot('balanceWheel')).add(slot('jewels')).multiplyScalar(1 / 6);

  // exploded overview framing
  const Hboard = P ? (B.size.x * 1.16) / aspect : Math.max(B.size.y * 1.22, (B.size.x * 1.08) / aspect);
  const dFit = fitDist(Hboard, B.size.x * (P ? 1.16 : 1.07), aspect) + 22;
  const bc = B.center;
  const tourY = (row) => -row * 62; // portrait board rows

  const hero = fitDist(P ? 132 : 112, P ? 64 : 72, aspect);
  const form = fitDist(P ? 112 : 108, P ? 62 : 80, aspect);
  const depth = fitDist(P ? 96 : 66, P ? 58 : 74, aspect);
  const macro = fitDist(P ? 82 : 52, P ? 56 : 66, aspect);
  const fin = fitDist(P ? 124 : 118, P ? 66 : 76, aspect);

  const tr = {};

  // ── Rig (the watch itself) ───────────────────────────────────────────────
  tr['rig.x'] = T([0, 0], [0.085, 0], [0.14, P ? 0 : 44], [0.2, P ? 0 : 44], [0.255, 14], [0.3, 6], [0.4, 0]);
  tr['rig.y'] = T([0, P ? -6 : 0], [0.085, P ? -6 : 0], [0.14, P ? -26 : -2], [0.2, P ? -26 : -2], [0.255, 0], [0.915, 0], [0.955, P ? 16 : -2], [1, P ? 16 : -2]);
  tr['rig.ry'] = T([0, -0.27], [0.085, -0.12], [0.145, -1.18], [0.2, -0.78], [0.255, -0.12], [0.3, -0.04], [0.485, -0.12], [0.8, -0.12], [0.86, -0.3], [0.92, -0.3], [1, -0.18]);
  tr['rig.rx'] = T([0, 0.07], [0.085, 0.07], [0.2, 0.0], [0.255, -0.46], [0.3, -0.38], [0.4, -0.05], [0.485, 0.03], [0.8, 0.03], [0.86, 0.1], [0.92, 0.08], [1, 0.04]);
  tr['rig.rz'] = T([0, 0], [0.14, 0.05], [0.2, 0.0], [0.3, -0.02], [0.485, 0], [1, 0]);
  tr['rig.s'] = T([0, 1], [1, 1]);

  // ── Camera: look target, distance and orbit angles ───────────────────────
  const hold = new THREE.Vector3(bc.x, P ? tourY(0.6) : bc.y, 0);
  tr['look.x'] = T([0, 0], [0.3, 0], [0.325, 0], [E_KEYS.full, hold.x], [0.55, hold.x]);
  tr['look.y'] = T([0, 0], [0.3, 0], [0.325, 0], [E_KEYS.full, hold.y], [0.55, P ? tourY(4.3) : hold.y]);
  tr['look.z'] = T([0, 0], [0.325, 0], [E_KEYS.full, 0], [0.55, 0]);
  tr['dist'] = T([0, hero], [0.085, hero * 0.97], [0.145, form], [0.2, form], [0.255, depth * 1.12], [0.3, depth], [0.325, macro], [E_KEYS.full, dFit], [0.55, dFit * (P ? 0.78 : 0.94)]);
  tr['az'] = T([0, 0], [0.085, 0.02], [0.2, -0.03], [0.3, 0.04], [0.325, 0.06], [E_KEYS.full, -0.05], [0.55, 0.04]);
  tr['el'] = T([0, 0.02], [0.2, 0.0], [0.255, 0.2], [0.3, 0.13], [0.325, 0.1], [E_KEYS.full, 0.06], [0.55, 0.08]);
  tr['roll'] = T([0, 0], [0.145, 0.014], [0.255, -0.012], [0.3, 0.0], [E_KEYS.full, 0.0], [1, 0]);

  // chapters 05–08 camera, appended as keyframes after the focus path
  const camKeys = { x: [], y: [], z: [], d: [], az: [], el: [] };
  const push = (p, look, d, az, el) => {
    camKeys.x.push([p, look.x]); camKeys.y.push([p, look.y]); camKeys.z.push([p, look.z]);
    camKeys.d.push([p, d]); camKeys.az.push([p, az]); camKeys.el.push([p, el]);
  };
  const lk = (v, dz = 0) => ({ x: v.x, y: v.y, z: v.z + dz });
  push(0.55, { x: hold.x, y: P ? tourY(4.3) : hold.y, z: 0 }, dFit * (P ? 0.78 : 0.94), 0.04, 0.08);
  push(0.568, lk(mid), P ? fitDist(110, 80, aspect) : 250, 0.0, 0.1);
  const azs = [0.12, -0.14, 0.14, 0.0, -0.1];
  FOCUS.forEach((f, i) => {
    const s = slot(f.id);
    push(f.p - 0.006, lk(s), fitDist(f.d * 0.55, f.d * 0.7, aspect) * 1.0, azs[i], 0.1);
    push(f.p + 0.006, lk(s), fitDist(f.d * 0.55, f.d * 0.7, aspect) * 0.94, azs[i] * 0.6, 0.07);
  });
  push(0.72, lk(mid), P ? fitDist(100, 78, aspect) : 180, -0.3, 0.1);
  push(0.76, P ? { x: bc.x, y: tourY(8.6), z: 0 } : lk(mid), P ? fitDist(150, 80, aspect) : 165, 0.26, 0.05);
  push(0.795, P ? { x: bc.x, y: tourY(10.2), z: 0 } : lk(mid), P ? fitDist(150, 80, aspect) : dFit * 0.8, 0.0, 0.06);
  push(E_KEYS.holdEnd + 0.01, { x: bc.x, y: P ? tourY(7) : bc.y, z: 0 }, P ? dFit * 0.5 : dFit * 0.98, 0.0, 0.06);
  push(0.86, { x: 0, y: 0, z: 0 }, fin * 1.28, 0.1, 0.09);
  push(0.925, { x: 0, y: 0, z: 0 }, fin * 1.02, 0.0, 0.03);
  push(1.0, { x: 0, y: 0, z: 0 }, fin * 0.97, -0.04, 0.02);

  // Merge early (p<.55) tracks with late camera keys
  const merge = (early, key) => {
    const l = track(camKeys[key], ease.heavy);
    return (p) => (p < 0.55 ? early(p) : l(p));
  };
  tr['look.x'] = merge(tr['look.x'], 'x');
  tr['look.y'] = merge(tr['look.y'], 'y');
  tr['look.z'] = merge(tr['look.z'], 'z');
  tr['dist'] = merge(tr['dist'], 'd');
  tr['az'] = merge(tr['az'], 'az');
  tr['el'] = merge(tr['el'], 'el');

  // ── Atmosphere ───────────────────────────────────────────────────────────
  tr['dark'] = T([0, 0], [0.19, 0], [0.245, 1], [0.915, 1], [0.955, 0]);
  tr['floor'] = T([0, 1], [0.1, 0.9], [0.17, 0], [0.92, 0], [0.96, 1], [1, 1]);
  tr['E'] = TL([0, 0], [E_KEYS.start, 0], [E_KEYS.full, 1], [E_KEYS.holdEnd, 1], [E_KEYS.closed, 0], [1, 0]);

  // focus lifts (chapter 05)
  FOCUS.forEach((f) => {
    tr[`focus.${f.id}`] = T([f.p - 0.024, 0], [f.p - 0.01, 1], [f.p + 0.008, 1], [f.p + 0.024, 0]);
  });

  // HUD label visibility
  const win = (a, b, c, d) => T([a, 0, ease.soft], [b, 1, ease.soft], [c, 1, ease.soft], [d, 0, ease.soft]);
  tr['lab.crystal'] = win(0.474, 0.486, 0.545, 0.556);
  tr['lab.calibre'] = win(0.479, 0.491, 0.545, 0.556);
  tr['lab.reserve'] = win(0.484, 0.496, 0.545, 0.556);
  tr['lab.components'] = win(0.489, 0.501, 0.545, 0.556);
  tr['lab.bezel'] = win(0.482, 0.494, 0.545, 0.556);
  tr['lab.case'] = win(0.487, 0.499, 0.545, 0.556);
  FOCUS.forEach((f) => { tr[`lab.${f.key}`] = win(f.p - 0.02, f.p - 0.008, f.p + 0.012, f.p + 0.024); });

  return {
    tracks: tr,
    meta: { dFit, hold, mid, portrait: P },
    evaluate(p, state = {}) {
      sampleInto(tr, p, state);
      return state;
    },
  };
}
