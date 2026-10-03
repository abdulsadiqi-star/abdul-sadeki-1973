import * as THREE from 'three';
import { buildStudioEnvironment } from './studio.js';

/**
 * Renderer, camera and the lighting rig:
 *  - large soft key (directional, warm)
 *  - thin cool rim from behind
 *  - low fill
 *  - HDR studio environment for physically convincing metal
 *  - soft contact shadow on the floor
 */
export function createStage(canvas, q) {
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: q.antialias, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(q.dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = buildStudioEnvironment(renderer);
  scene.environmentIntensity = 1;

  const camera = new THREE.PerspectiveCamera(24, 1, 20, 4000);
  camera.position.set(0, 0, 420);

  const key = new THREE.DirectionalLight(0xfff1de, 2.2);
  key.position.set(-120, 150, 200);
  const rim = new THREE.DirectionalLight(0xdfeaff, 2.4);
  rim.position.set(160, 40, -180);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(60, -80, 160);
  scene.add(key, rim, fill);

  return { renderer, scene, camera, lights: { key, rim, fill } };
}
