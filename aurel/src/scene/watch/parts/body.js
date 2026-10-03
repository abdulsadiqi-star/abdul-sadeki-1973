import * as THREE from 'three';
import { Part } from '../part.js';
import { latheStrips, ringStrips, cylZ, mergeGeometries, seg, TAU, circleShape, holePath } from '../helpers.js';
import { Z, R } from '../spec.js';

const mesh = (g, m, z = 0) => { const o = new THREE.Mesh(g, m); o.position.z = z; return o; };
const grp = (...c) => { const g = new THREE.Group(); c.forEach((x) => g.add(x)); return g; };

/** Steel case, lugs, crown, stem, movement holder, caseback ring + crystal. */
export function buildBody({ M, T, q }) {
  const parts = [];
  const S = (n) => seg(q, n);

  // 12 ─ Main steel case (mid-case + four lugs + strap bars) ───────────────
  {
    const flank = (strips, mat) => mesh(latheStrips(strips, S(144), 3), mat);
    const g = grp(
      flank([[[17.0, Z.caseBot], [19.0, Z.caseBot]], [[19.3, Z.caseTop], [17.0, Z.caseTop]]], M.brushed),
      flank([[[19.0, Z.caseBot], [19.55, -6.5]], [[19.72, 1.15], [19.3, Z.caseTop]]], M.polished),
      flank([[[19.55, -6.5], [19.78, -3.5], [19.8, -1.0], [19.72, 1.15]]], M.brushed),
      flank([[[17.0, Z.caseTop], [17.0, Z.caseBot]]], M.darkInner),
    );
    // lugs: side profile in (u = y, v = z) extruded across X, bevelled for a soft highlight
    const lug = (sign, x) => {
      const pts = [[15.5, 1.55], [19.5, 1.55], [22.2, 0.95], [24.0, -0.4], [24.8, -2.1], [24.3, -3.9], [22.8, -5.3], [19.5, -6.3], [15.5, -6.4]];
      const s = new THREE.Shape();
      pts.forEach(([u, v], i) => (i ? s.lineTo(sign * u, v) : s.moveTo(sign * u, v)));
      s.closePath();
      const e = new THREE.ExtrudeGeometry(s, { depth: 3.1, bevelEnabled: true, bevelSize: 0.28, bevelThickness: 0.28, bevelSegments: 2, curveSegments: 6 });
      e.translate(0, 0, -1.55);
      e.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, x, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
      return e;
    };
    const lugs = mergeGeometries([lug(1, 11.85), lug(1, -11.85), lug(-1, 11.85), lug(-1, -11.85)]);
    g.add(mesh(lugs, M.brushed));
    // strap bars
    const bar = (y) => { const b = new THREE.CylinderGeometry(0.85, 0.85, 20.6, 16); b.rotateZ(Math.PI / 2); b.translate(0, y, Z.lugMid); return b; };
    g.add(mesh(mergeGeometries([bar(22.4), bar(-22.4)]), M.polished));
    const p = new Part('case', 'Main steel case', g, { center: 'auto' });
    p.size = 50;
    parts.push(p);
  }

  // 13 ─ Crown (knurled, with gold cap) ────────────────────────────────────
  {
    const n = 30, s = new THREE.Shape();
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU, r = i % 2 ? 2.7 : 3.15;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    const body = new THREE.ExtrudeGeometry(s, { depth: 3.3, bevelEnabled: false });
    const domePts = [];
    for (let i = 0; i <= 8; i++) { const r = 2.1 * (1 - i / 8); domePts.push([r, 3.55 + 0.6 * (1 - Math.pow(r / 2.1, 2))]); }
    const cap = latheStrips([[[2.35, 3.3], [2.35, 3.5], [2.1, 3.55]], domePts], 48);
    const cg = grp(mesh(body, M.brushed), mesh(cap, M.gold));
    // axis Z → X
    cg.rotation.y = Math.PI / 2;
    const wrap = grp(cg);
    wrap.position.set(21.0, 0, Z.lugMid);
    const p = new Part('crown', 'Crown', grp(...[wrap]), { center: 'auto' });
    parts.push(p);
  }

  // 14 ─ Crown stem + tube ──────────────────────────────────────────────────
  {
    const stem = new THREE.CylinderGeometry(0.7, 0.7, 11, 16); stem.rotateZ(Math.PI / 2); stem.translate(15.6, 0, Z.lugMid);
    const tube = new THREE.CylinderGeometry(1.55, 1.55, 3.0, 20); tube.rotateZ(Math.PI / 2); tube.translate(20.4, 0, Z.lugMid);
    const thread = new THREE.CylinderGeometry(0.95, 0.95, 2.2, 14); thread.rotateZ(Math.PI / 2); thread.translate(11.2, 0, Z.lugMid);
    parts.push(new Part('crownStem', 'Crown stem', grp(mesh(mergeGeometries([stem, tube]), M.polished), mesh(thread, M.gold)), { center: 'auto' }));
  }

  // 15 ─ Movement holder (casing ring) ─────────────────────────────────────
  {
    const g = latheStrips(ringStrips(R.movement + 0.05, 16.95, -3.5, -1.5), S(120), 2);
    const tabs = [0, 1, 2, 3].map((i) => { const b = new THREE.BoxGeometry(2.4, 1.3, 1.2); b.translate(0, 14.2, -2.2); b.rotateZ((i / 4) * TAU + 0.6); return b; });
    parts.push(new Part('movementHolder', 'Movement holder', grp(mesh(g, M.black), mesh(mergeGeometries(tabs), M.rhodium)), { center: [0, 0, -2.5] }));
  }

  // 24 ─ Caseback ring (engraved) ───────────────────────────────────────────
  {
    const wall = latheStrips([
      [[R.movement, -7.7], [18.55, -7.7], [18.95, -7.3], [18.95, -6.7]],
      [[18.95, -6.7], [R.movement, -6.7]],
      [[R.movement, -6.7], [R.movement, -7.7]],
    ], S(120), 2);
    const face = new THREE.RingGeometry(R.movement + 0.05, 18.55, S(120), 1);
    const uv = face.attributes.uv, pos = face.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 38.2 + 0.5, pos.getY(i) / 38.2 + 0.5);
    face.rotateY(Math.PI); // faces the back of the watch
    // screws around the ring
    const heads = [];
    for (let i = 0; i < 6; i++) {
      const h = cylZ(0.62, 0.62, 0.22, 14);
      h.translate(0, 17.45, -7.8); h.rotateZ((i / 6) * TAU + 0.26);
      heads.push(h);
    }
    parts.push(new Part('casebackRing', 'Caseback ring',
      grp(mesh(wall, M.brushed), mesh(face, M.caseback, -7.705), mesh(mergeGeometries(heads), M.blued)), { center: [0, 0, -7.2] }));
  }

  // 23 ─ Caseback crystal ───────────────────────────────────────────────────
  {
    const g = latheStrips([
      [[0, -7.5], [14.3, -7.5], [14.7, -7.1]],
      [[14.7, -7.1], [14.7, -6.9]],
      [[14.7, -6.9], [14.3, -6.8], [0, -6.8]],
    ], S(96));
    parts.push(new Part('casebackCrystal', 'Caseback crystal', grp(mesh(g, M.glass)), { center: [0, 0, -7.15] }));
    parts[parts.length - 1].group.children[0].renderOrder = 10;
  }

  return parts;
}
