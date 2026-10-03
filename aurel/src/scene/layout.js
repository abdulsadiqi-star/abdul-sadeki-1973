import * as THREE from 'three';

/**
 * Museum-style exploded layout ("knolling in depth").
 *
 * Every component gets its own slot on a wide board (landscape) or a tall
 * two-column board (portrait/mobile). Slots follow the assembly's reading
 * order around a central calibre cluster; depth (z) keeps front parts in
 * front, so the burst reads as the real stack pulling apart.
 *
 * Targets are computed from each part's *measured* visual centre, so flips
 * and rotations happen around the object's middle, never its pivot.
 */

// id → { c:[col,row], z, r:[rx,ry,rz] (absolute world rotation), ox, oy (mm offset inside the slot) }
const LANDSCAPE = {
  crystal:        { c: [0, 0], z: 44, r: [-0.20, 0.30, 0] },
  bezel:          { c: [1, 0], z: 38, r: [-0.16, -0.26, 0] },
  chapterRing:    { c: [2, 0], z: 30, r: [-0.20, 0.22, 0] },
  hourMarkers:    { c: [3, 0], z: 26, r: [-0.16, -0.24, 0] },
  hourHand:       { c: [4, 0], z: 52, sc: 1.5, r: [0, 0, 0], ox: -16 },
  minuteHand:     { c: [4, 0], z: 52, sc: 1.5, r: [0, 0, 0], ox: -6 },
  secondsHand:    { c: [4, 0], z: 52, sc: 1.5, r: [0, 0, 0], ox: 4 },
  centerPin:      { c: [4, 0], z: 52, sc: 2.4, r: [1.1, 0.5, 0], ox: 14 },
  dial:           { c: [4, 1], z: 18, r: [-0.14, -0.30, 0] },
  dateWindow:     { c: [4, 2], z: 20, sc: 1.7, r: [-0.12, -0.2, 0] },
  innerDial:      { c: [4, 3], z: 4,  r: [-0.12, -0.26, 0] },
  case:           { c: [3, 3], z: -14, r: [-0.14, -0.24, 0] },
  movementHolder: { c: [2, 3], z: -10, r: [-0.16, -0.18, 0] },
  casebackRing:   { c: [1, 3], z: -26, r: [0.1, Math.PI + 0.22, 0] },
  casebackCrystal:{ c: [0, 3], z: -30, r: [-0.16, 0.26, 0] },
  buckle:         { c: [0, 1], z: -6, r: [0, 0, 0] },
  crown:          { c: [0, 2], z: 14, sc: 1.6, r: [0, 0, 0], oy: 7 },
  crownStem:      { c: [0, 2], z: 14, sc: 1.5, r: [0, 0, 0], oy: -7 },
  mainPlate:      { c: [1, 1], z: 2,  r: [0.14, Math.PI - 0.24, 0] },
  bridges:        { c: [2, 1], z: -6, r: [-0.12, Math.PI + 0.2, 0] },
  gearTrain:      { c: [3, 1], z: 6, sc: 1.12,  r: [-0.16, -0.22, 0] },
  balanceWheel:   { c: [1, 2], z: 10, sc: 1.5, r: [-0.2, 0.3, 0] },
  rotor:          { c: [2, 2], z: -12, r: [0.14, Math.PI - 0.2, 0] },
  jewels:         { c: [3, 2], z: 4, sc: 2.2, r: [-0.18, -0.2, 0], oy: 14 },
  screws:         { c: [3, 2], z: 14, sc: 2.0, r: [-0.18, -0.2, 0], oy: -9 },
  strapUpper:     { x: 146, y: 4, z: -10, r: [Math.PI / 2, 0, 0.1] },
  strapLower:     { x: -146, y: 0, z: -10, r: [-Math.PI / 2, 0, -0.1] },
};

const PORTRAIT = {
  ...LANDSCAPE,
  crystal: { ...LANDSCAPE.crystal, c: [0, 0] }, bezel: { ...LANDSCAPE.bezel, c: [1, 0] },
  chapterRing: { ...LANDSCAPE.chapterRing, c: [0, 1] }, hourMarkers: { ...LANDSCAPE.hourMarkers, c: [1, 1] },
  hourHand: { ...LANDSCAPE.hourHand, c: [0, 2], ox: -14 }, minuteHand: { ...LANDSCAPE.minuteHand, c: [0, 2], ox: -6 },
  secondsHand: { ...LANDSCAPE.secondsHand, c: [0, 2], ox: 2 }, centerPin: { ...LANDSCAPE.centerPin, c: [0, 2], ox: 10 },
  dial: { ...LANDSCAPE.dial, c: [1, 2] },
  dateWindow: { ...LANDSCAPE.dateWindow, c: [0, 3] }, innerDial: { ...LANDSCAPE.innerDial, c: [1, 3] },
  crown: { ...LANDSCAPE.crown, c: [0, 4] }, crownStem: { ...LANDSCAPE.crownStem, c: [0, 4] },
  case: { ...LANDSCAPE.case, c: [1, 4] },
  movementHolder: { ...LANDSCAPE.movementHolder, c: [0, 5] }, mainPlate: { ...LANDSCAPE.mainPlate, c: [1, 5] },
  bridges: { ...LANDSCAPE.bridges, c: [0, 6] }, gearTrain: { ...LANDSCAPE.gearTrain, c: [1, 6] },
  balanceWheel: { ...LANDSCAPE.balanceWheel, c: [0, 7] }, rotor: { ...LANDSCAPE.rotor, c: [1, 7] },
  jewels: { ...LANDSCAPE.jewels, c: [0, 8], oy: 14 }, screws: { ...LANDSCAPE.screws, c: [0, 8], oy: -17 },
  casebackRing: { ...LANDSCAPE.casebackRing, c: [1, 8] }, casebackCrystal: { ...LANDSCAPE.casebackCrystal, c: [0, 9] },
  buckle: { ...LANDSCAPE.buckle, c: [1, 9] },
  strapUpper: { x: -30, y: -(10.55 * 62), z: -10, r: [Math.PI / 2, 0, 0.06] },
  strapLower: { x: 30, y: -(10.55 * 54), z: -10, r: [-Math.PI / 2, 0, -0.06] },
};

const _v = new THREE.Vector3();
const _b = new THREE.Box3();

/** Compute and store part.target / part.targetQ; returns board bounds + tour stops. */
export function computeLayout(watch, aspect) {
  const portrait = aspect < 0.95;
  const spec = portrait ? PORTRAIT : LANDSCAPE;
  const PX = portrait ? 58 : 50, PY = portrait ? 62 : 50;
  const slot = (c, r) => (portrait ? [(c - 0.5) * PX, -r * PY] : [(c - 2) * PX, (1.5 - r) * PY]);

  for (const part of watch.list) {
    const s = spec[part.id];
    if (!s) continue;
    const [sx, sy] = s.c ? slot(s.c[0], s.c[1]) : [s.x, s.y];
    part.setTargetAbsolute(...s.r);
    if (part.customRotation) part.targetQ.identity();
    part.targetScale = s.sc || 1;
    const lc = part.id === 'jewels' || part.id === 'screws' ? _v.set(0, 0, 0) : _v.copy(part.localCenter).applyQuaternion(part.targetQ).multiplyScalar(part.targetScale);
    const sz = portrait ? s.z * 0.35 : s.z; // portrait: flatter board → less perspective drift while the camera tours
    part.target.set(sx + (s.ox || 0) - lc.x, sy + (s.oy || 0) - lc.y, sz - lc.z);
    part.slot = new THREE.Vector3(sx + (s.ox || 0), sy + (s.oy || 0), sz);
  }

  const bounds = measureBoard(watch);
  return { portrait, bounds, spec, PX, PY };
}

/** World-space AABB union of the board at full explosion (rig untransformed). */
function measureBoard(watch) {
  const saved = watch.list.map((p) => p.t);
  watch.list.forEach((p) => { p.t = 1; p.focus = 0; p.apply(); });
  watch.root.updateMatrixWorld(true);
  const all = new THREE.Box3();
  for (const p of watch.list) { _b.setFromObject(p.group); all.union(_b); }
  watch.list.forEach((p, i) => { p.t = saved[i]; p.apply(); });
  return { min: all.min.clone(), max: all.max.clone(), center: all.getCenter(new THREE.Vector3()), size: all.getSize(new THREE.Vector3()) };
}

/**
 * Debug / QA helper: project every part at full explosion through the given
 * camera and report pairs whose screen-space boxes overlap.
 * (Boxes of small items that nest inside a bigger part's *empty* centre are ignored by id list.)
 */
export function findOverlaps(watch, camera, rigObj, { margin = 0 } = {}) {
  const saved = watch.list.map((p) => ({ t: p.t, f: p.focus }));
  watch.list.forEach((p) => { p.t = 1; p.focus = 0; p.apply(); });
  rigObj.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const boxes = watch.list.map((p) => {
    _b.setFromObject(p.group);
    const pts = [];
    for (const x of [_b.min.x, _b.max.x]) for (const y of [_b.min.y, _b.max.y]) for (const z of [_b.min.z, _b.max.z]) pts.push(new THREE.Vector3(x, y, z).project(camera));
    const xs = pts.map((v) => v.x), ys = pts.map((v) => v.y);
    return { id: p.id, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  watch.list.forEach((p, i) => { p.t = saved[i].t; p.focus = saved[i].f; p.apply(); });
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox > margin && oy > margin) out.push([a.id, b.id, +ox.toFixed(3), +oy.toFixed(3)]);
  }
  return { overlaps: out, boxes };
}
