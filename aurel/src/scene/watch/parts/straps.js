import * as THREE from 'three';
import { Part } from '../part.js';
import { mergeGeometries, seg, TAU } from '../helpers.js';
import { Z } from '../spec.js';

const mesh = (g, m, z = 0) => { const o = new THREE.Mesh(g, m); o.position.z = z; return o; };
const grp = (...c) => { const g = new THREE.Group(); c.forEach((x) => g.add(x)); return g; };

// Strap follows an ellipse "wrist" behind the case: semi-axes (A over Y, B over Z)
const A = 30, B = 33, ZC = Z.lugMid - B * Math.cos(Math.asin(22.4 / A));
const PHI0 = Math.asin(22.4 / A);

/** Sample the strap centre-line: position, tangent, outward normal (all in the Y/Z plane). */
function makePath(dir, length) {
  const pts = [];
  let phi = PHI0, s = 0;
  const step = 0.002;
  pts.push({ phi, s: 0 });
  while (s < length) {
    const dy = A * Math.cos(phi), dz = -B * Math.sin(phi);
    s += Math.hypot(dy, dz) * step; phi += step;
    pts.push({ phi, s });
  }
  const total = pts[pts.length - 1].s;
  const at = (f) => { // f in 0..1 → frame
    const target = f * total;
    let i = 1; while (i < pts.length - 1 && pts[i].s < target) i++;
    const a = pts[i - 1], b = pts[i];
    const k = b.s > a.s ? (target - a.s) / (b.s - a.s) : 0;
    const ph = a.phi + (b.phi - a.phi) * k;
    const y = dir * A * Math.sin(ph), z = ZC + B * Math.cos(ph);
    const ty = dir * A * Math.cos(ph), tz = -B * Math.sin(ph);
    const tl = Math.hypot(ty, tz);
    const ny = (dir * Math.sin(ph)) / A, nz = Math.cos(ph) / B, nl = Math.hypot(ny, nz);
    return {
      p: new THREE.Vector3(0, y, z),
      T: new THREE.Vector3(0, ty / tl, tz / tl),
      N: new THREE.Vector3(0, ny / nl, nz / nl),
    };
  };
  return { at, total };
}

function strapGeometry({ dir, length, w0, w1, t0, t1, round, q }) {
  const path = makePath(dir, length);
  const n = Math.round(60 * (q.seg > 0.8 ? 1 : 0.7)), K = 20;
  const pos = [], uv = [], idx = [];
  const frames = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, fr = path.at(f); frames.push(fr);
    let w = w0 + (w1 - w0) * f, t = t0 + (t1 - t0) * f;
    if (round && f > 0.93) { const k = (f - 0.93) / 0.07; const sc = Math.sqrt(Math.max(0.0004, 1 - k * k)); w *= sc; t *= 0.6 + 0.4 * sc; }
    for (let k = 0; k < K; k++) {
      const a = (k / K) * TAU, c = Math.cos(a), sn = Math.sin(a);
      const x = (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 0.3);
      const h = (t / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), 0.3);
      const P = fr.p.clone().addScaledVector(fr.N, h);
      pos.push(x, P.y, P.z);
      uv.push(x / w0 + 0.5, (f * path.total) / 34);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < K; k++) {
      const a = i * K + k, b = i * K + ((k + 1) % K), c = (i + 1) * K + k, d = (i + 1) * K + ((k + 1) % K);
      idx.push(a, c, b, b, c, d);
    }
  }
  // flat end cap (lower strap) — fan around the last ring's centre
  if (!round) {
    const cIdx = pos.length / 3, fr = frames[n];
    pos.push(0, fr.p.y, fr.p.z); uv.push(0.5, (path.total) / 34);
    for (let k = 0; k < K; k++) idx.push(n * K + k, n * K + ((k + 1) % K), cIdx);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point outward (winding depends on dir)
  const nrm = g.attributes.normal, p = g.attributes.position;
  const k0 = 0; // ring 0, a = 0 → +X side
  if (nrm.getX(k0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return { g, path, frames };
}

/** 25 · 26 · 27 — upper strap (with holes), lower strap, tang buckle. */
export function buildStraps({ M, q }) {
  const parts = [];
  const S = (v) => seg(q, v);

  // 25 ─ Upper strap (with holes)
  {
    const { g, path } = strapGeometry({ dir: 1, length: 62, w0: 20, w1: 17.6, t0: 3.6, t1: 2.6, round: true, q });
    const grpU = grp(mesh(g, M.leather));
    // punched holes
    const holes = [];
    for (let i = 0; i < 6; i++) {
      const f = 0.58 + i * 0.065, fr = path.at(f);
      const c = new THREE.CircleGeometry(0.85, 14);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), fr.T, fr.N);
      const t = 3.6 + (2.6 - 3.6) * f;
      m.setPosition(fr.p.clone().addScaledVector(fr.N, t / 2 + 0.02));
      c.applyMatrix4(m); holes.push(c);
    }
    grpU.add(mesh(mergeGeometries(holes), M.black));
    const p = new Part('strapUpper', 'Upper strap', grpU, { center: 'auto' });
    p.size = 70;
    parts.push(p);
  }

  // 26 ─ Lower strap (buckle side)
  let endFrame;
  {
    const { g, path } = strapGeometry({ dir: -1, length: 80, w0: 20, w1: 18, t0: 3.6, t1: 2.8, round: false, q });
    endFrame = path.at(1);
    const p = new Part('strapLower', 'Lower strap', grp(mesh(g, M.leather)), { center: 'auto' });
    p.size = 80;
    parts.push(p);
  }

  // 27 ─ Buckle (frame + tang), authored in strap-local axes: x = width, y = along strap, z = normal
  {
    const outer = new THREE.Shape();
    const w = 23, l = 24, r = 3.2;
    outer.moveTo(-w / 2 + r, -l / 2); outer.lineTo(w / 2 - r, -l / 2); outer.quadraticCurveTo(w / 2, -l / 2, w / 2, -l / 2 + r);
    outer.lineTo(w / 2, l / 2 - r); outer.quadraticCurveTo(w / 2, l / 2, w / 2 - r, l / 2); outer.lineTo(-w / 2 + r, l / 2);
    outer.quadraticCurveTo(-w / 2, l / 2, -w / 2, l / 2 - r); outer.lineTo(-w / 2, -l / 2 + r); outer.quadraticCurveTo(-w / 2, -l / 2, -w / 2 + r, -l / 2);
    const iw = 18.6, il = 19.4, ir = 1.6, hole = new THREE.Path();
    hole.moveTo(-iw / 2 + ir, -il / 2); hole.lineTo(iw / 2 - ir, -il / 2); hole.quadraticCurveTo(iw / 2, -il / 2, iw / 2, -il / 2 + ir);
    hole.lineTo(iw / 2, il / 2 - ir); hole.quadraticCurveTo(iw / 2, il / 2, iw / 2 - ir, il / 2); hole.lineTo(-iw / 2 + ir, il / 2);
    hole.quadraticCurveTo(-iw / 2, il / 2, -iw / 2, il / 2 - ir); hole.lineTo(-iw / 2, -il / 2 + ir); hole.quadraticCurveTo(-iw / 2, -il / 2, -iw / 2 + ir, -il / 2);
    outer.holes.push(hole);
    const frame = new THREE.ExtrudeGeometry(outer, { depth: 1.4, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 2, curveSegments: 8 });
    frame.translate(0, 0, -0.7);
    const bar = new THREE.CylinderGeometry(0.8, 0.8, iw + 1.5, 14); bar.rotateZ(Math.PI / 2); bar.translate(0, -l / 2 + 2.1, 0.1);
    const tang = new THREE.CylinderGeometry(0.62, 0.45, il + 1.2, 10); tang.translate(0, 0.4, 1.3);
    const g = grp(mesh(frame, M.polished), mesh(bar, M.polished), mesh(tang, M.polished));
    // orient to the end of the lower strap (bars the strap end with the buckle's near edge)
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), endFrame.T, endFrame.N);
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
    const centre = endFrame.p.clone().addScaledVector(endFrame.T, l / 2 - 1.2).addScaledVector(endFrame.N, 0.9);
    const p = new Part('buckle', 'Buckle', g, { center: [centre.x, centre.y, centre.z], shift: false, restQuat: quat });
    p.size = 26;
    parts.push(p);
  }

  return parts;
}
