import * as THREE from 'three';

/**
 * Procedural photo-studio used as the image-based-lighting source:
 * a large soft key box, thin strip lights, black flags for contrast and a
 * warm-white floor. Reflections of these on polished steel are what make the
 * watch read as photographed rather than rendered.
 */
export function buildStudioEnvironment(renderer) {
  const s = new THREE.Scene();

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(160, 100, 160),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8f8a82).multiplyScalar(0.55), side: THREE.BackSide }),
  );
  s.add(room);

  const panel = (w, h, pos, look, intensity, color = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(...look);
    s.add(m);
    return m;
  };
  const flag = (w, h, pos) => panel(w, h, pos, [0, 0, 0], 0.012, 0x000000);

  // key softbox (big, upper-left, slightly in front)
  panel(70, 46, [-48, 44, 40], [0, 0, 0], 7.5, 0xfff4e6);
  // overhead
  panel(60, 60, [0, 58, 0], [0, 0, 0], 3.2, 0xffffff);
  // thin strip lights (rim / edge definition)
  panel(8, 90, [62, 8, -22], [0, 0, 0], 16, 0xf3f7ff);
  panel(5, 80, [-62, 6, -30], [0, 0, 0], 11, 0xffffff);
  panel(70, 5, [0, -6, -70], [0, 0, 0], 8, 0xfff0dc);
  // low front fill
  panel(60, 14, [0, -34, 62], [0, 0, 0], 2.2, 0xffeedd);
  // black flags give polished surfaces their deep contrast
  flag(40, 80, [66, 4, 34]);
  flag(60, 24, [0, 22, -64]);
  flag(30, 70, [-70, -10, 30]);
  // warm gallery floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe9e2d4).multiplyScalar(1.1) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -48;
  s.add(floor);

  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.035, 1, 600);
  pm.dispose();
  s.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}
