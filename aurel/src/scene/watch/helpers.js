import * as THREE from 'three';
import { mergeGeometries as rawMerge } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merge geometries of mixed origin (indexed / non-indexed, with or without uv). */
export function mergeGeometries(list) {
  const norm = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    n.clearGroups();
    return n;
  });
  return rawMerge(norm, false);
}
export const TAU = Math.PI * 2;

/**
 * Lathe around the Z axis with *hard edges between strips*.
 * `strips` is an array of polylines [[r, z], ...]. Inside a strip normals are
 * smooth (so arcs/domes shade softly); between strips the edge stays crisp —
 * which is what gives polished chamfers their razor highlight.
 * Traverse each strip counter-clockwise in the (r,z) half-plane (outward normals).
 */
export function latheStrips(strips, segs = 96, uvScale = 1) {
  const pos = [], nor = [], uv = [], idx = [];
  let total = 0;
  for (const s of strips) for (let i = 1; i < s.length; i++) total += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  total = total || 1;
  let acc = 0;
  for (const s of strips) {
    const n = s.length;
    if (n < 2) continue;
    const dirs = [];
    for (let i = 0; i < n - 1; i++) {
      const dr = s[i + 1][0] - s[i][0], dz = s[i + 1][1] - s[i][1];
      const l = Math.hypot(dr, dz) || 1e-6;
      dirs.push([dr / l, dz / l, l]);
    }
    const base = pos.length / 3;
    let run = acc;
    for (let i = 0; i < n; i++) {
      let tr = 0, tz = 0;
      if (i > 0) { tr += dirs[i - 1][0]; tz += dirs[i - 1][1]; }
      if (i < n - 1) { tr += dirs[i][0]; tz += dirs[i][1]; }
      const tl = Math.hypot(tr, tz) || 1;
      const nr = tz / tl, nz = -tr / tl;
      if (i > 0) run += dirs[i - 1][2];
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * TAU, c = Math.cos(a), sn = Math.sin(a);
        pos.push(s[i][0] * c, s[i][0] * sn, s[i][1]);
        nor.push(nr * c, nr * sn, nz);
        uv.push(j / segs, (run / total) * uvScale);
      }
    }
    acc = run;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Four hard-edged strips (bottom, outer, top, inner) for a rectangular ring section. */
export function ringStrips(rIn, rOut, z0, z1) {
  return [[[rIn, z0], [rOut, z0]], [[rOut, z0], [rOut, z1]], [[rOut, z1], [rIn, z1]], [[rIn, z1], [rIn, z0]]];
}

/** Sample an arc in the (r,z) plane: handy for domes / fillets. */
export function arcPts(cr, cz, rad, a0, a1, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cr + Math.cos(a) * rad, cz + Math.sin(a) * rad]);
  }
  return out;
}

/**
 * Extrude a THREE.Shape, centre it on z = 0 and give it planar UVs
 * (u,v = x,y / (2·uvR) + .5) so canvas textures map like a printed face.
 */
export function extrude(shape, depth, { bevel = 0, bevelSegs = 1, curve = 48, uvR = 16 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: curve,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel * 0.0,
    bevelSegments: bevelSegs,
  });
  g.translate(0, 0, -depth / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * uvR) + 0.5, p.getY(i) / (2 * uvR) + 0.5);
  return g;
}

export function circleShape(r, seg = 64) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, TAU, false);
  return s;
}

export function holePath(cx, cy, r) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, TAU, true);
  return p;
}

export function rectPath(cx, cy, w, h, r = 0) {
  const x = cx - w / 2, y = cy - h / 2;
  const p = new THREE.Path();
  if (r <= 0) {
    p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.closePath();
  } else {
    p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y);
  }
  return p;
}

/**
 * Convex hull of two circles ("teardrop / capsule" bridge outline).
 * Elegant, always valid, and reads as hand-finished watch bridgework.
 */
export function lobeShape(c1, r1, c2, r2) {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  const s = new THREE.Shape();
  if (d < 1e-4 || d + Math.min(r1, r2) <= Math.max(r1, r2)) {
    const big = r1 >= r2 ? [c1, r1] : [c2, r2];
    s.absarc(big[0][0], big[0][1], big[1], 0, TAU, false);
    return s;
  }
  const base = Math.atan2(dy, dx);
  const phi = Math.acos(THREE.MathUtils.clamp((r1 - r2) / d, -1, 1));
  // big arc around c1 (the far side), then around c2
  s.absarc(c1[0], c1[1], r1, base + phi, base - phi + TAU, false);
  s.absarc(c2[0], c2[1], r2, base - phi, base + phi, false);
  s.closePath();
  return s;
}

/**
 * Toothed wheel outline, optionally with spoke windows and a bore.
 *  tooth: 'trap' (trapezoid, train wheels) | 'saw' (club/ratchet, escape wheel)
 */
export function gearShape({ teeth, rRoot, rTip, rBore = 0.3, spokes = 0, rHub = 0, rRim = 0, spokeW = 0.5, tooth = 'trap' }) {
  const s = new THREE.Shape();
  const pitch = TAU / teeth;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * pitch;
    if (tooth === 'saw') {
      pts.push([a, rRoot], [a, rTip], [a + pitch * 0.18, rTip * 0.985], [a + pitch * 0.82, rRoot]);
    } else {
      pts.push([a - pitch * 0.34, rRoot], [a - pitch * 0.15, rTip], [a + pitch * 0.15, rTip], [a + pitch * 0.34, rRoot]);
    }
  }
  pts.forEach(([a, r], i) => {
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  });
  s.closePath();
  if (rBore > 0) s.holes.push(holePath(0, 0, rBore));
  if (spokes > 0) {
    const sector = TAU / spokes;
    for (let k = 0; k < spokes; k++) {
      const a0 = k * sector + spokeW / (2 * ((rHub + rRim) / 2));
      const a1 = (k + 1) * sector - spokeW / (2 * ((rHub + rRim) / 2));
      const p = new THREE.Path();
      p.absarc(0, 0, rRim, a0, a1, false);
      p.absarc(0, 0, rHub, a1, a0, true);
      p.closePath();
      s.holes.push(p);
    }
  }
  return s;
}

/** Faceted dauphine hand (diamond ridge) pointing +Y, flat on z=0. Non-indexed → flat shading. */
export function dauphineHand(L, W, tail, H) {
  const sy = L * 0.24;
  const T = [0, L, 0], R = [W / 2, sy, 0], B = [0, -tail, 0], Lf = [-W / 2, sy, 0], C = [0, sy, H];
  const tris = [[T, Lf, C], [Lf, B, C], [B, R, C], [R, T, C], [T, R, B], [T, B, Lf]];
  const v = [];
  tris.forEach((t) => t.forEach((p) => v.push(...p)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Cylinder whose axis is Z (three's default is Y). */
export function cylZ(rTop, rBot, h, seg = 32, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}

export const seg = (q, n) => Math.max(8, Math.round(n * q.seg));
