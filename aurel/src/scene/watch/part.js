import * as THREE from 'three';

const _q = new THREE.Quaternion();

/**
 * A Part is one independently-controllable component of the watch.
 *
 *  rest   — position/orientation inside the assembled watch
 *  target — position/orientation in the museum-style exploded layout
 *  t      — explosion amount 0..1 (set per frame by the choreography)
 *  focus  — 0..1 macro-inspection lift (chapter 05)
 *
 * Geometry is re-centred on the part's own pivot so that flips / rotations in
 * the exploded view happen around the visual centre of the object.
 */
export class Part {
  constructor(id, label, group, { center = 'auto', shift = true, restQuat } = {}) {
    this.id = id;
    this.label = label;
    this.group = group;
    group.name = id;

    const c = new THREE.Vector3();
    if (center === 'auto') new THREE.Box3().setFromObject(group).getCenter(c);
    else c.set(...center);
    if (shift) group.children.forEach((ch) => ch.position.sub(c));

    this.rest = c.clone();
    this.target = c.clone();
    this.restQ = new THREE.Quaternion();
    if (restQuat) this.restQ.copy(restQuat);
    this.targetQ = this.restQ.clone();
    this.t = 0;
    this.focus = 0;
    this.targetScale = 1;
    this.focusLift = 16;
    this.items = [];
    this.customRotation = false; // hands manage their own z-rotation
    this.materials = null;
    this.size = 40; // rough diameter used for camera framing
    group.position.copy(this.rest);
    group.quaternion.copy(this.restQ);
    this.localCenter = new THREE.Vector3(); // visual centre in the part's own frame (set by measure())
  }

  /** Measure the visual centre of the geometry in the part's local frame (call once, at rest pose). */
  measure() {
    const g = this.group;
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    const c = b.getCenter(new THREE.Vector3());
    this.localCenter.copy(c).applyMatrix4(g.matrixWorld.clone().invert());
    this.size = Math.max(this.size, 0);
    return this;
  }

  /** Register a sub-object (jewel, screw …) that fans out to its own "rack" slot. */
  addItem(obj, rack) {
    this.items.push({ obj, rest: obj.position.clone(), rack: rack.clone() });
  }

  /** Exploded orientation, relative to the assembled orientation. */
  setTargetEuler(x = 0, y = 0, z = 0) {
    this.targetQ.copy(this.restQ).multiply(_q.setFromEuler(new THREE.Euler(x, y, z)));
  }

  /** Exploded orientation as an absolute world rotation. */
  setTargetAbsolute(x = 0, y = 0, z = 0) {
    this.targetQ.setFromEuler(new THREE.Euler(x, y, z));
  }

  /** Clone materials so emissive highlighting never leaks into other parts. */
  enableHighlight() {
    this.materials = [];
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (!o.material.emissive) return;
      o.userData.baseEmissive = o.material.emissive.clone();
      o.userData.baseEI = o.material.emissiveIntensity ?? 1;
      this.materials.push(o.material);
    });
  }

  setHighlight(a) {
    if (!this.materials) return;
    for (const m of this.materials) {
      m.emissive.set(0xb99a68);
      m.emissiveIntensity = a * 0.55;
    }
  }

  apply() {
    const g = this.group, t = this.t;
    g.position.lerpVectors(this.rest, this.target, t);
    if (this.focus > 0) g.position.z += this.focus * this.focusLift;
    if (!this.customRotation) g.quaternion.slerpQuaternions(this.restQ, this.targetQ, t);
    g.scale.setScalar((1 + (this.targetScale - 1) * t) * (1 + this.focus * 0.06));
    for (const it of this.items) it.obj.position.lerpVectors(it.rest, it.rack, t);
  }
}
