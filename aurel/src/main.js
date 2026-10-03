import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import './styles/base.css';
import './styles/stage.css';
import './styles/hud.css';
import './styles/responsive.css';

import { getQuality, reducedMotion } from './utils/device.js';
import { clamp, damp, lerp } from './animations/easing.js';
import { buildTimeline, partT, FOCUS, CHAPTERS, FOV } from './animations/timeline.js';
import { createStage } from './scene/stage.js';
import { createWatch } from './scene/watch/index.js';
import { computeLayout, findOverlaps } from './scene/layout.js';
import { createUI } from './components/ui.js';
import { createSound } from './audio/sound.js';

gsap.registerPlugin(ScrollTrigger);

const $ = (s) => document.querySelector(s);
const loaderBar = $('.loader-bar i');
const setLoad = (v) => { loaderBar.style.transform = `scaleX(${v})`; };

async function boot() {
  setLoad(0.15);
  await Promise.all([
    document.fonts.load('300 40px "Inter Variable"'),
    document.fonts.load('italic 400 40px "Cormorant Garamond"'),
  ]).catch(() => {});
  await new Promise((r) => requestAnimationFrame(r));
  setLoad(0.4);

  let q = getQuality();
  const canvas = $('#gl');
  let stage;
  try {
    stage = createStage(canvas, q);
  } catch (e) {
    $('.loader-sub').textContent = 'WebGL is not available in this browser';
    console.error(e);
    return;
  }
  const { renderer, scene, camera, lights } = stage;
  camera.fov = FOV;

  // soft contact shadow under the floating watch
  const watch = createWatch(q);
  scene.add(watch.root);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), watch.materials.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -1;
  scene.add(shadow);
  setLoad(0.8);

  // ── state ────────────────────────────────────────────────────────────────
  let viewport = { w: innerWidth, h: innerHeight };
  let layout, tl;
  const state = {};
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const sound = createSound();
  let target = 0, smooth = 0, vel = 0;
  const intro = { v: reducedMotion ? 1 : 0 };
  const isPortrait = () => viewport.w / viewport.h < 0.95;

  const ui = createUI({
    portrait: isPortrait,
    onNavigate: (p) => scrollToP(p, 2.6),
    onReplay: () => scrollToP(0, 4.2),
    onDiscover: () => { const d = $('#spec'); d.showModal?.(); },
    onSound: () => sound.toggle(),
  });

  // ── layout / timeline (rebuilt on resize: exploded layout depends on aspect) ──
  const scrollSpace = $('#scroll-space');
  function rebuild() {
    viewport = { w: innerWidth, h: innerHeight };
    q = getQuality();
    renderer.setPixelRatio(q.dpr);
    renderer.setSize(viewport.w, viewport.h, false);
    camera.aspect = viewport.w / viewport.h;
    camera.updateProjectionMatrix();
    const aspect = camera.aspect;
    layout = computeLayout(watch, aspect);
    tl = buildTimeline(layout, watch, aspect);
    scrollSpace.style.height = `${Math.round(viewport.h * (layout.portrait ? 1180 : 1320) / 100)}px`;
    ScrollTrigger.refresh();
  }

  function scrollMax() { return Math.max(1, document.documentElement.scrollHeight - innerHeight); }
  ScrollTrigger.create({
    trigger: scrollSpace, start: 'top top', end: 'bottom bottom',
    onUpdate: (self) => { target = self.progress; },
  });

  const proxy = { y: 0 };
  function scrollToP(p, duration = 2.4) {
    proxy.y = window.scrollY;
    gsap.killTweensOf(proxy);
    gsap.to(proxy, { y: clamp(p, 0, 1) * scrollMax(), duration: reducedMotion ? 0.01 : duration, ease: 'power3.inOut', onUpdate: () => window.scrollTo(0, proxy.y) });
  }
  // a user wheel / touch during an auto-scroll takes control back
  const stopAuto = () => gsap.killTweensOf(proxy);
  addEventListener('wheel', stopAuto, { passive: true });
  addEventListener('touchstart', stopAuto, { passive: true });

  addEventListener('pointermove', (e) => {
    if (!q.pointer) return;
    pointer.tx = (e.clientX / viewport.w) * 2 - 1;
    pointer.ty = (e.clientY / viewport.h) * 2 - 1;
  }, { passive: true });

  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(rebuild, 120); });

  // ── per-frame ────────────────────────────────────────────────────────────
  const tmp = new THREE.Vector3(), look = new THREE.Vector3();
  const FOCUS_IDS = FOCUS.map((f) => f.id);
  const project = (part) => {
    tmp.copy(part.localCenter);
    part.group.localToWorld(tmp);
    tmp.project(camera);
    return tmp.z < 1 ? tmp : null;
  };

  let time = 0;
  function frame(dt) {
    time += dt;
    // heavy, damped follow of the scroll position
    const prev = smooth;
    smooth = reducedMotion ? target : damp(smooth, target, 4.6, dt);
    if (Math.abs(smooth - target) < 1e-5) smooth = target;
    vel = damp(vel, Math.min(1, Math.abs(smooth - prev) / Math.max(dt, 1e-3) * 14), 6, dt);
    const p = smooth;
    render(p, dt);
    sound.update(vel);
  }

  function render(p, dt = 0.016) {
    tl.evaluate(p, state);
    const E = state.E;
    const amb = reducedMotion ? 0 : 1;

    // explode choreography + macro focus
    for (const part of watch.list) {
      part.t = partT(part.id, E);
      part.focus = 0;
    }
    for (const id of FOCUS_IDS) {
      const part = watch.parts.get(id);
      part.focus = (state.focus?.[id] ?? 0) * (E > 0.98 ? 1 : 0);
      part.setHighlight(part.focus);
    }
    watch.update(time, p);
    watch.applyAll();

    // pointer: a few degrees at most
    pointer.x = damp(pointer.x, pointer.tx, 3, dt);
    pointer.y = damp(pointer.y, pointer.ty, 3, dt);
    const r = state.rig;
    const root = watch.root;
    root.position.set(r.x, r.y + Math.sin(time * 0.6) * 0.7 * amb, 0);
    root.rotation.set(
      r.rx + Math.sin(time * 0.23) * 0.014 * amb + pointer.y * 0.035,
      r.ry + Math.sin(time * 0.31) * (0.028 + 0.05 * E) * amb + pointer.x * 0.05,
      r.rz,
    );
    root.scale.setScalar(r.s);
    root.updateMatrixWorld(true);

    // cinematic camera: look target + (distance, azimuth, elevation) orbit
    look.set(state.look.x, state.look.y, state.look.z);
    if (p > 0.3 && p < 0.92) look.applyMatrix4(root.matrixWorld); // follows the rig while it's exploded
    const d = state.dist, az = state.az, el = state.el;
    camera.position.set(
      look.x + Math.sin(az) * Math.cos(el) * d,
      look.y + Math.sin(el) * d,
      look.z + Math.cos(az) * Math.cos(el) * d,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.rotateZ(state.roll);

    // lighting rig & atmosphere
    const k = state.dark;
    scene.environmentIntensity = lerp(0.9, 0.8, k);
    lights.key.intensity = lerp(2.2, 3.2, k);
    lights.rim.intensity = lerp(2.4, 4.4, k);
    lights.fill.intensity = lerp(0.35, 0.18, k);
    renderer.toneMappingExposure = lerp(0.92, 1.0, k);
    watch.materials.glass.specularIntensity = lerp(0.4, 3.0, E);

    shadow.visible = state.floor > 0.01;
    if (shadow.visible) {
      shadow.position.set(r.x, r.y - 36, -6);
      shadow.scale.set(78, 30, 1);
      watch.materials.shadow.opacity = state.floor * 0.85;
    }

    ui.update(p, state, intro.v, project, watch.parts, viewport);
    renderer.render(scene, camera);
  }

  // ── go ───────────────────────────────────────────────────────────────────
  rebuild();
  target = smooth = ScrollTrigger.getAll()[0]?.progress ?? 0;
  render(smooth);
  setLoad(1);

  // QA / debug hooks (also handy for recording stills)
  window.__aurel = {
    watch, camera, state,
    get layout() { return layout; }, get tl() { return tl; },
    seek(p) { window.scrollTo(0, p * scrollMax()); target = smooth = p; render(p); },
    overlaps: (opts) => findOverlaps(watch, camera, watch.root, opts),
    chapters: CHAPTERS,
  };

  setTimeout(() => {
    document.body.classList.remove('is-loading');
    $('#loader').classList.add('done');
    if (!reducedMotion) gsap.to(intro, { v: 1, duration: 3.2, ease: 'power2.out', delay: 0.25 });
    window.__ready = true;
  }, 450);

  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add((t, deltaMs) => frame(Math.min(0.05, deltaMs / 1000)));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) gsap.ticker.wake?.(); });
}

boot();
