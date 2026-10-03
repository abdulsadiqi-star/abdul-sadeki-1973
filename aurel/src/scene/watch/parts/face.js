import * as THREE from 'three';
import { Part } from '../part.js';
import {
  latheStrips, extrude, circleShape, holePath, rectPath, dauphineHand, cylZ, mergeGeometries, seg, TAU,
} from '../helpers.js';
import { Z, R, DATE } from '../spec.js';

const mesh = (g, m, z = 0) => { const o = new THREE.Mesh(g, m); o.position.z = z; return o; };
const grp = (...c) => { const g = new THREE.Group(); c.forEach((x) => g.add(x)); return g; };

/** Everything the viewer sees on the dial side: crystal → bezel → ring → markers → hands → dial. */
export function buildFace({ M, T, q }) {
  const parts = [];
  const S = (n) => seg(q, n);

  // 1 ─ Sapphire crystal (domed box crystal; reflection-only material) ───────
  {
    const dome = [];
    for (let i = 0; i <= 14; i++) {
      const r = R.crystal * (1 - i / 14);
      dome.push([r, 3.55 + 1.35 * (1 - Math.pow(r / R.crystal, 2.2))]);
    }
    const g = latheStrips([
      [[0, Z.crystalBot], [R.crystal - 0.4, Z.crystalBot], [R.crystal, Z.crystalBot + 0.4]],
      [[R.crystal, Z.crystalBot + 0.4], [R.crystal, 3.55]],
      dome,
    ], S(120));
    const m = mesh(g, M.glass);
    m.renderOrder = 10;
    const p = new Part('crystal', 'Sapphire crystal', grp(m), { center: [0, 0, 3.7] });
    parts.push(p);
  }

  // 2 ─ Front bezel ─────────────────────────────────────────────────────────
  {
    const poly = latheStrips([
      [[R.bezelIn, 3.0], [R.bezelIn, Z.bezelBot]],
      [[R.bezelIn + 0.0, Z.bezelBot], [R.bezelOut - 0.1, Z.bezelBot]],
      [[R.bezelOut - 0.1, Z.bezelBot], [R.bezelOut, 2.1], [R.bezelOut, 3.05], [R.bezelOut - 0.45, 3.5]],
      [[R.bezelIn + 0.45, 3.5], [R.bezelIn + 0.1, 3.35], [R.bezelIn, 3.0]],
    ], S(144), 2);
    const top = latheStrips([[[R.bezelOut - 0.45, 3.5], [R.bezelIn + 0.45, 3.5]]], S(144), 3);
    const p = new Part('bezel', 'Front bezel', grp(mesh(poly, M.polished), mesh(top, M.brushed)), { center: [0, 0, 2.6] });
    parts.push(p);
  }

  // 3 ─ Chapter / rehaut ring ───────────────────────────────────────────────
  {
    const body = latheStrips([[
      [14.4, Z.chapter], [R.chapterOut, Z.chapter], [R.chapterOut, 1.1], [R.chapterOut - 0.45, 1.45],
      [R.chapterIn + 0.15, 1.45], [14.4, Z.chapter],
    ]], S(120), 2);
    const face = new THREE.RingGeometry(R.chapterIn + 0.15, R.chapterOut - 0.45, S(120), 1);
    // RingGeometry maps uv from the *outer* radius; our canvas uses 17.3 → re-map
    const uv = face.attributes.uv, pos = face.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * R.chapterOut) + 0.5, pos.getY(i) / (2 * R.chapterOut) + 0.5);
    const p = new Part('chapterRing', 'Chapter ring', grp(mesh(body, M.darkInner), mesh(face, M.chapter, 1.47)), { center: [0, 0, 0.9] });
    parts.push(p);
  }

  // 4 ─ Applied hour markers ────────────────────────────────────────────────
  {
    const baton = (w, l, h) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, -l / 2); s.lineTo(w / 2, -l / 2); s.lineTo(w / 2, l / 2); s.lineTo(-w / 2, l / 2); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 1 });
      return g;
    };
    const g = new THREE.Group();
    const std = baton(1.25, 4.2, 0.45), thin = baton(0.62, 4.6, 0.45), dot = new THREE.CylinderGeometry(0.9, 0.9, 0.5, 20);
    dot.rotateX(Math.PI / 2); dot.translate(0, 0, 0.3);
    for (let h = 1; h <= 12; h++) {
      if (h === 3) continue; // date window
      const a = (h / 12) * TAU, rr = 12.7;
      const place = (geo, ox = 0, rad = rr) => {
        const m = mesh(geo, M.gold);
        m.position.set(Math.sin(a) * rad + Math.cos(a) * ox, Math.cos(a) * rad - Math.sin(a) * ox, 0);
        m.rotation.z = -a;
        g.add(m);
      };
      if (h === 12) { place(thin, -0.95, 12.6); place(thin, 0.95, 12.6); }
      else if (h % 3 === 0) place(std, 0, 12.4);
      else place(dot, 0, 13.2);
    }
    parts.push(new Part('hourMarkers', 'Hour markers', g, { center: [0, 0, 0.25] }));
  }

  // 5-7 ─ Hands, 8 ─ central pin ───────────────────────────────────────────
  {
    const mk = (id, label, g, mat, z) => {
      const m = mesh(g, mat, z);
      const p = new Part(id, label, grp(m), { center: [0, 0, z] });
      p.customRotation = true;
      return p;
    };
    parts.push(mk('hourHand', 'Hour hand', dauphineHand(9.6, 2.7, 2.2, 0.34), M.polished, 0.85));
    parts.push(mk('minuteHand', 'Minute hand', dauphineHand(14.0, 2.1, 2.6, 0.32), M.polished, 1.3));

    // seconds hand: slim stick + open counterweight ring + hub
    const stick = new THREE.BoxGeometry(0.34, 19.2, 0.12); stick.translate(0, (14.8 - 4.4) / 2, 0);
    const cwShape = new THREE.Shape(); cwShape.absarc(0, 0, 1.25, 0, TAU, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, 0.7, 0, TAU, true); cwShape.holes.push(hole);
    const cw = new THREE.ExtrudeGeometry(cwShape, { depth: 0.14, bevelEnabled: false, curveSegments: 24 });
    cw.translate(0, -3.5, -0.07);
    const hub = cylZ(0.95, 0.95, 0.28, 24);
    const sec = mergeGeometries([stick, cw, hub]);
    parts.push(mk('secondsHand', 'Seconds hand', sec, M.gold, 1.85));

    const pin = mergeGeometries([cylZ(0.5, 0.5, 3.2, 20).translate(0, 0, 0.9), cylZ(1.05, 1.05, 0.18, 24).translate(0, 0, 2.38)]);
    parts.push(new Part('centerPin', 'Central pin', grp(mesh(pin, M.gold)), { center: [0, 0, 1.0] }));
  }

  // 9 ─ Main dial (sunburst, with date-window cut-out) ─────────────────────
  {
    const shape = circleShape(R.dial);
    shape.holes.push(rectPath(DATE.x, DATE.y, DATE.w, DATE.h, 0.15));
    const g = extrude(shape, 0.6, { curve: S(120), uvR: 15 });
    // dial feet
    const feet = [[-8, -11], [8, -11], [0, 12.5]].map(([x, y]) => cylZ(0.5, 0.5, 1.6, 12).translate(x, y, -1.1));
    const dial = mesh(g, M.dial, Z.dial);
    const f = mesh(mergeGeometries(feet), M.brass, 0);
    parts.push(new Part('dial', 'Main dial', grp(dial, f), { center: [0, 0, Z.dial] }));
  }

  // 10 ─ Date window (frame + printed patch) ───────────────────────────────
  {
    const outer = rectPath(DATE.x, DATE.y, DATE.w + 0.9, DATE.h + 0.9, 0.2);
    const shape = new THREE.Shape(outer.getPoints(8));
    shape.holes.push(rectPath(DATE.x, DATE.y, DATE.w, DATE.h, 0.15));
    const fg = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1, curveSegments: 6 });
    const patch = new THREE.PlaneGeometry(DATE.w + 0.5, DATE.h + 0.5);
    const g = grp(mesh(fg, M.gold, 0.02), (() => { const m = mesh(patch, M.datePatch, -0.95); m.position.x = DATE.x; m.position.y = DATE.y; return m; })());
    parts.push(new Part('dateWindow', 'Date window', g, { center: [DATE.x, DATE.y, -0.3] }));
  }

  // 11 ─ Inner dial structure: support plate, date wheel, feet ──────────────
  {
    const plate = circleShape(14.6);
    plate.holes.push(holePath(0, 0, 2.2));
    plate.holes.push(rectPath(DATE.x, DATE.y, DATE.w + 0.9, DATE.h + 0.9, 0.2));
    const pg = extrude(plate, 0.45, { curve: S(96), uvR: 15, bevel: 0.05 });
    const ring = new THREE.RingGeometry(8.35, 12.9, S(120), 1);
    const uv = ring.attributes.uv, pos = ring.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 25.8 + 0.5, pos.getY(i) / 25.8 + 0.5);
    const legs = [[-8, -11], [8, -11], [0, 12.5]].map(([x, y]) => cylZ(0.8, 0.8, 0.6, 14).translate(x, y, -0.35));
    parts.push(new Part('innerDial', 'Inner dial structure',
      grp(mesh(pg, M.brass, Z.support), mesh(ring, M.dateWheel, Z.dateWheel), mesh(mergeGeometries(legs), M.rhodium, Z.support)),
      { center: [0, 0, -1.4] }));
  }

  return parts;
}
