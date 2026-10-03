import * as THREE from 'three';
import { Part } from '../part.js';
import {
  latheStrips, ringStrips, extrude, circleShape, holePath, lobeShape, gearShape, cylZ, mergeGeometries, seg, TAU,
} from '../helpers.js';
import { Z, MOVEMENT as MV, R } from '../spec.js';

const mesh = (g, m, z = 0) => { const o = new THREE.Mesh(g, m); o.position.z = z; return o; };
const grp = (...c) => { const g = new THREE.Group(); c.forEach((x) => g.add(x)); return g; };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * The A01 calibre, engineered rather than decorated:
 * mainplate · four bridges · barrel → centre → third → fourth → escape train ·
 * Swiss-lever pallet fork · balance + hairspring · rotor · ruby jewels · blued screws.
 */
export function buildMovement({ M, q }) {
  const parts = [];
  const S = (n) => seg(q, n);
  const live = { gears: [], fork: null, balance: null, rotor: null }; // animated sub-objects

  // 16 ─ Main movement plate (perlage, open at the wheel seats) ─────────────
  {
    const shape = circleShape(R.movement - 0.1);
    [MV.barrel, MV.third, MV.fourth, MV.escape].forEach(([x, y], i) => shape.holes.push(holePath(x, y, [3.0, 1.6, 1.5, 1.3][i])));
    shape.holes.push(holePath(MV.balance[0], MV.balance[1], 3.4));
    const g = extrude(shape, 0.5, { curve: S(96), uvR: 15, bevel: 0.06 });
    const p = new Part('mainPlate', 'Main movement plate', grp(mesh(g, M.perlage, Z.plate)), { center: [0, 0, Z.plate] });
    parts.push(p);
  }

  // 17 ─ Bridges (Côtes de Genève, bevelled edges, jewel seats) ─────────────
  const bridgeShapes = [
    ['barrel', lobeShape(MV.barrel, 7.7, [-0.4, 0.5], 2.3), Z.bridge, 0],
    ['train', lobeShape(MV.third, 4.3, MV.fourth, 4.0), Z.bridge, 0],
    ['pallet', lobeShape(MV.escape, 3.5, MV.fork, 3.1), Z.bridge, 0],
    ['cock', lobeShape(MV.balance, 3.7, [-10.4, -8.3], 1.4), Z.cock, 0],
  ];
  {
    const g = new THREE.Group();
    bridgeShapes.forEach(([id, shape, z]) => {
      const geo = extrude(shape, 0.35, { curve: S(40), uvR: 15, bevel: 0.1 });
      g.add(mesh(geo, M.geneve, z));
    });
    parts.push(new Part('bridges', 'Bridges', g, { center: 'auto' }));
    parts[parts.length - 1].size = 34;
  }

  // 18 ─ Gear train ─────────────────────────────────────────────────────────
  {
    const g = new THREE.Group();
    const wheel = (id, [x, y], gs, z, { pinion, spin, mat = M.rhodium, thick = 0.28 } = {}) => {
      const sub = new THREE.Group();
      sub.position.set(x, y, 0);
      const shape = gearShape(gs);
      const geo = extrude(shape, thick, { curve: 8, uvR: 8 });
      sub.add(mesh(geo, mat, z));
      // arbor through plate → bridge
      sub.add(mesh(cylZ(0.28, 0.28, 1.9, 10), M.polished, -3.35));
      if (pinion) sub.add(mesh(cylZ(pinion.r, pinion.r, pinion.len, 10), M.polished, pinion.z));
      g.add(sub);
      live.gears.push({ obj: sub, spin, id });
      return sub;
    };
    // barrel: drum + toothed rim + cover
    {
      const [x, y] = MV.barrel;
      const sub = new THREE.Group(); sub.position.set(x, y, 0);
      sub.add(mesh(extrude(gearShape({ teeth: 72, rRoot: 6.5, rTip: 6.95, rBore: 0.3 }), 0.45, { curve: 8, uvR: 8 }), M.rhodium, Z.wheelA));
      sub.add(mesh(latheStrips([[[0, -3.55], [6.0, -3.55]], [[6.0, -3.55], [6.0, -3.2]], [[6.0, -3.2], [0, -3.2]]], S(72)), M.gold));
      sub.add(mesh(latheStrips([[[0, -3.65], [1.4, -3.65], [1.7, -3.57]], [[1.7, -3.57], [1.7, -3.5]]], 24), M.polished));
      sub.add(mesh(cylZ(0.28, 0.28, 1.9, 10), M.polished, -3.35));
      g.add(sub);
      live.gears.push({ obj: sub, spin: -0.09, id: 'barrel' });
    }
    wheel('center', MV.center, { teeth: 60, rRoot: 5.0, rTip: 5.45, rBore: 0.32, spokes: 5, rHub: 1.5, rRim: 4.4, spokeW: 0.55 }, Z.wheelB, { pinion: { r: 1.25, len: 0.9, z: Z.wheelA }, spin: 0.12 });
    wheel('third', MV.third, { teeth: 56, rRoot: 4.0, rTip: 4.45, rBore: 0.3, spokes: 4, rHub: 1.2, rRim: 3.5, spokeW: 0.5 }, Z.wheelA, { pinion: { r: 0.95, len: 0.9, z: Z.wheelB }, spin: -0.15, mat: M.brass });
    wheel('fourth', MV.fourth, { teeth: 52, rRoot: 3.7, rTip: 4.15, rBore: 0.3, spokes: 3, rHub: 1.1, rRim: 3.1, spokeW: 0.5 }, Z.wheelB, { pinion: { r: 0.8, len: 0.9, z: Z.wheelA }, spin: 0.2 });
    wheel('escape', MV.escape, { teeth: 15, rRoot: 2.75, rTip: 3.5, rBore: 0.28, spokes: 5, rHub: 0.9, rRim: 2.2, spokeW: 0.4, tooth: 'saw' }, Z.wheelA, { pinion: { r: 0.7, len: 0.9, z: Z.wheelB }, spin: -0.5, mat: M.gold });

    // Swiss-lever pallet fork, with two ruby pallet stones
    const f = new THREE.Group();
    f.position.set(MV.fork[0], MV.fork[1], 0);
    const E = [MV.escape[0] - MV.fork[0], MV.escape[1] - MV.fork[1]];
    const toE = Math.atan2(E[1], E[0]);
    const dist = Math.hypot(E[0], E[1]);
    const P = (ang) => [E[0] + Math.cos(ang) * 3.2, E[1] + Math.sin(ang) * 3.2];
    const back = toE + Math.PI;
    const P1 = P(back + 0.62), P2 = P(back - 0.62);
    const toBal = Math.atan2(MV.balance[1] - MV.fork[1], MV.balance[0] - MV.fork[0]);
    const tail = [Math.cos(toBal) * 6.2, Math.sin(toBal) * 6.2];
    const armGeo = (a, b, ra, rb) => extrude(lobeShape(a, ra, b, rb), 0.3, { curve: 10, uvR: 8 });
    const armMat = M.brass;
    f.add(mesh(armGeo([0, 0], P1, 0.6, 0.45), armMat, Z.wheelA));
    f.add(mesh(armGeo([0, 0], P2, 0.6, 0.45), armMat, Z.wheelA));
    f.add(mesh(armGeo([0, 0], tail, 0.7, 0.35), armMat, Z.wheelA));
    f.add(mesh(cylZ(1.0, 1.0, 0.4, 20), M.gold, Z.wheelA));
    f.add(mesh(cylZ(0.28, 0.28, 1.9, 10), M.polished, -3.35));
    [P1, P2].forEach((p) => { const b = new THREE.BoxGeometry(0.6, 1.2, 0.4); const m = mesh(b, M.ruby, Z.wheelA); m.position.x = p[0]; m.position.y = p[1]; m.rotation.z = Math.atan2(p[1] - E[1], p[0] - E[0]) + Math.PI / 2; f.add(m); });
    g.add(f);
    live.fork = f;
    parts.push(new Part('gearTrain', 'Gear train', g, { center: 'auto' }));
    parts[parts.length - 1].size = 30;
    parts[parts.length - 1].enableHighlight();
  }

  // 19 ─ Balance wheel + hairspring (free-sprung, oscillating) ──────────────
  {
    const osc = new THREE.Group();
    const [bx, by] = MV.balance;
    osc.position.set(bx, by, 0);
    const rimR = 4.7;
    osc.add(mesh(new THREE.TorusGeometry(rimR, 0.26, 10, S(72)), M.gold, Z.balance));
    // four arms + four timing screws on the rim
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const arm = new THREE.BoxGeometry(rimR, 0.42, 0.26);
      arm.translate(rimR / 2, 0, 0); arm.rotateZ(a);
      osc.add(mesh(arm, M.polished, Z.balance));
      const scr = new THREE.SphereGeometry(0.38, 12, 8);
      scr.translate(Math.cos(a + 0.5) * rimR, Math.sin(a + 0.5) * rimR, 0);
      osc.add(mesh(scr, M.gold, Z.balance));
    }
    osc.add(mesh(cylZ(0.9, 0.9, 0.5, 20), M.gold, Z.balance));
    osc.add(mesh(cylZ(0.3, 0.3, 2.2, 10), M.polished, Z.balance - 0.2));
    // hairspring: Archimedean spiral
    const pts = [];
    const turns = 6.5, n = 220;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = t * turns * TAU, r = 0.95 + t * 2.5;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    const spring = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 260, 0.045, 4, false);
    osc.add(mesh(spring, M.blued, Z.balance + 0.28));
    const g = grp(osc);
    live.balance = osc;
    const p = new Part('balanceWheel', 'Balance wheel', g, { center: [bx, by, Z.balance] });
    p.size = 20;
    p.enableHighlight();
    parts.push(p);
  }

  // 20 ─ Automatic rotor (22k gold segment on a steel bearing) ──────────────
  {
    const spin = new THREE.Group();
    const s = new THREE.Shape();
    const a0 = 0.12, a1 = Math.PI * 1.07, ro = 13.6;
    s.moveTo(Math.cos(a0) * 2.6, Math.sin(a0) * 2.6);
    s.lineTo(Math.cos(a0) * ro, Math.sin(a0) * ro);
    s.absarc(0, 0, ro, a0, a1, false);
    s.lineTo(Math.cos(a1) * 2.6, Math.sin(a1) * 2.6);
    s.absarc(0, 0, 2.6, a1, a0 + TAU, false);
    // skeleton windows leaving three arms
    const win = (c0, c1, ri, rr) => {
      const p = new THREE.Path();
      p.absarc(0, 0, rr, c0, c1, false);
      p.absarc(0, 0, ri, c1, c0, true);
      p.closePath();
      return p;
    };
    s.holes.push(win(0.55, 1.35, 4.6, 10.6), win(1.75, 2.55, 4.6, 10.6));
    const geo = extrude(s, 0.8, { curve: S(64), uvR: 14, bevel: 0.12, bevelSegs: 1 });
    const ring = latheStrips(ringStrips(0.7, 2.7, -0.45, 0.45), S(48));
    const body = mesh(geo, M.geneveGold);
    const brg = mesh(ring, M.polished);
    const cap = mesh(cylZ(0.55, 0.55, 0.3, 14), M.blued); cap.position.z = 0.5;
    spin.add(body, brg, cap);
    spin.position.z = Z.rotor;
    live.rotor = spin;
    const p = new Part('rotor', 'Rotor', grp(spin), { center: [0, 0, Z.rotor] });
    p.size = 30;
    p.enableHighlight();
    parts.push(p);
  }

  // 21 ─ Ruby jewels in gold chatons ────────────────────────────────────────
  {
    const g = new THREE.Group();
    const spots = [
      [MV.barrel, Z.bridge - 0.42], [MV.center, Z.bridge - 0.42], [MV.third, Z.bridge - 0.42],
      [MV.fourth, Z.bridge - 0.42], [MV.escape, Z.bridge - 0.42], [MV.fork, Z.bridge - 0.42],
      [MV.balance, Z.cock - 0.42], [[-9.6, 9.4], Z.bridge - 0.42], [[-2.4, 10.6], Z.bridge - 0.42],
      [[8.2, -0.6], Z.bridge - 0.42], [[7.0, -9.8], Z.bridge - 0.42], [[-10.2, 1.8], Z.bridge - 0.42],
    ];
    const chaton = latheStrips(ringStrips(0.55, 1.05, -0.2, 0.2), 20);
    const stone = new THREE.SphereGeometry(0.62, 16, 10);
    stone.scale(1, 1, 0.55);
    const items = [];
    spots.forEach(([[x, y], z]) => {
      const j = new THREE.Group();
      j.add(new THREE.Mesh(chaton, M.gold), new THREE.Mesh(stone, M.ruby));
      j.position.set(x, y, z);
      g.add(j); items.push(j);
    });
    const p = new Part('jewels', 'Ruby jewels', g, { center: 'auto' });
    // tidy museum rack: 4 × 3 grid
    items.forEach((j, i) => p.addItem(j, V3(((i % 4) - 1.5) * 4.6, (1 - Math.floor(i / 4)) * 4.6, 0)));
    p.size = 24;
    p.enableHighlight();
    parts.push(p);
  }

  // 22 ─ Screws (blued steel, slotted) ──────────────────────────────────────
  {
    const g = new THREE.Group();
    const pos = [[-9.7, 10.2], [-11.6, 3.1], [-1.0, 1.4], [8.4, -0.2], [7.0, -9.4], [-2.3, -5.7], [-5.6, -13.3], [-9.8, -7.2], [-3.4, 8.8], [10.9, -4.8]];
    const head = cylZ(0.58, 0.58, 0.24, 16);
    const slot = new THREE.BoxGeometry(1.0, 0.16, 0.1);
    const items = [];
    pos.forEach(([x, y], i) => {
      const s = new THREE.Group();
      s.add(new THREE.Mesh(head, M.blued));
      const sl = new THREE.Mesh(slot, M.black); sl.position.z = -0.12; sl.rotation.z = i * 0.9;
      s.add(sl);
      s.position.set(x, y, Z.bridge - 0.3);
      g.add(s); items.push(s);
    });
    const p = new Part('screws', 'Screws', g, { center: 'auto' });
    items.forEach((s, i) => p.addItem(s, V3(((i % 5) - 2) * 3.4, (0.5 - Math.floor(i / 5)) * 4.2, 0)));
    p.size = 20;
    parts.push(p);
  }

  return { parts, live };
}
