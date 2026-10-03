import * as THREE from 'three';
import { createTextures } from './textures.js';
import { createMaterials } from './materials.js';
import { buildFace } from './parts/face.js';
import { buildBody } from './parts/body.js';
import { buildMovement } from './parts/movement.js';
import { buildStraps } from './parts/straps.js';
import { TAU } from './helpers.js';

const Zaxis = new THREE.Vector3(0, 0, 1);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Display time on the hero: 10:09:36 — the classic, symmetrical campaign time. */
const START = { h: (10 + 9 / 60) / 12, m: 9 / 60, s: 36 / 60 };

/**
 * Builds the entire watch procedurally. Returns the root group, every Part
 * (27 independently controllable components) and an update() for the
 * continuous "alive" animation.
 */
export function createWatch(q) {
  const T = createTextures(q);
  const M = createMaterials(T);
  const ctx = { M, T, q };

  const root = new THREE.Group();
  const mv = buildMovement(ctx);
  const list = [...buildFace(ctx), ...buildBody(ctx), ...mv.parts, ...buildStraps(ctx)];
  const parts = new Map(list.map((p) => [p.id, p]));
  list.forEach((p) => root.add(p.group));

  list.forEach((p) => p.measure());
  const live = mv.live;
  const crownWrap = parts.get('crown').group.children[0];

  /** continuous animation — `p` is scroll progress, `time` seconds */
  function update(time, p) {
    // hands: scroll winds the minute/hour hands, seconds hand free-runs
    const hands = {
      hourHand: (START.h + p * 0.9) * TAU,
      minuteHand: (START.m + p * 11) * TAU,
      secondsHand: (START.s + time / 60) * TAU,
    };
    for (const id in hands) {
      const part = parts.get(id);
      const liveA = -hands[id];
      const a = liveA + wrapPi(0 - liveA) * part.t;
      part.group.quaternion.setFromAxisAngle(Zaxis, a);
    }
    // calibre: gears turn, escape/balance oscillate, rotor drifts
    for (const g of live.gears) g.obj.rotation.z = time * g.spin;
    const ph = time * 2 * Math.PI * 1.15;
    live.balance.rotation.z = Math.sin(ph) * 1.05;
    live.fork.rotation.z = Math.sin(ph - 0.35) * 0.1;
    live.rotor.rotation.z = time * 0.3 + Math.sin(time * 0.7) * 0.25;
    crownWrap.rotation.x = p * 60;
  }

  function applyAll() { for (const p of list) p.apply(); }

  return { root, parts, list, update, applyAll, materials: M, textures: T };
}
