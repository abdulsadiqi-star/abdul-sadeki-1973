import { clamp, remap, smoothstep, lerp, ease } from '../animations/easing.js';
import { CHAPTERS, FOCUS } from '../animations/timeline.js';

/**
 * DOM layer: scroll-scrubbed typography, technical tags, chapter nav, HUD.
 * Every visible property is a pure function of scroll progress p, so type
 * reverses with the film.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ── type timeline ───────────────────────────────────────────────────────────
// win = [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd]; x/y travel in vw/vh across the whole window
const hero = [-0.02, -0.01, 0.052, 0.092];
const TEXT = [
  { id: 't-time', win: hero, x: [0, -9], intro: 0 },
  { id: 't-made', win: hero, x: [0, 9], intro: 1 },
  { id: 't-visible', win: [-0.02, -0.01, 0.04, 0.082], y: [0, 9], intro: 2 },
  { id: 't-form', win: [0.098, 0.13, 0.182, 0.212], x: [6, -5] },
  { id: 'c-form', win: [0.118, 0.143, 0.18, 0.2] },
  { id: 't-depth', win: [0.218, 0.25, 0.282, 0.308], x: [3, -3] },
  { id: 'c-depth', win: [0.238, 0.262, 0.282, 0.302] },
  { id: 't-exp', win: [0.31, 0.345, 0.55, 0.575], y: [3, -3] },
  { id: 'c-exp', win: [0.478, 0.5, 0.542, 0.558] },
  { id: 'c-cal', win: [0.558, 0.576, 0.69, 0.708] },
  { id: 'cap-balance', win: [FOCUS[0].p - 0.02, FOCUS[0].p - 0.008, FOCUS[0].p + 0.012, FOCUS[0].p + 0.024] },
  { id: 'cap-train', win: [FOCUS[1].p - 0.02, FOCUS[1].p - 0.008, FOCUS[1].p + 0.012, FOCUS[1].p + 0.024] },
  { id: 'cap-rotor', win: [FOCUS[2].p - 0.02, FOCUS[2].p - 0.008, FOCUS[2].p + 0.012, FOCUS[2].p + 0.024] },
  { id: 'cap-jewels', win: [FOCUS[3].p - 0.02, FOCUS[3].p - 0.008, FOCUS[3].p + 0.01, FOCUS[3].p + 0.022] },
  { id: 'cap-bridges', win: [FOCUS[4].p - 0.02, FOCUS[4].p - 0.008, FOCUS[4].p + 0.012, FOCUS[4].p + 0.024] },
  { id: 't-n1', win: [0.698, 0.71, 0.722, 0.732], x: [4, -2] },
  { id: 't-n2', win: [0.724, 0.735, 0.746, 0.756], x: [4, -2] },
  { id: 't-n3', win: [0.748, 0.759, 0.77, 0.78], x: [4, -2] },
  { id: 't-n4', win: [0.772, 0.783, 0.796, 0.808], x: [4, -2] },
  { id: 'c-prec', win: [0.702, 0.716, 0.792, 0.806] },
  { id: 't-reass', win: [0.804, 0.83, 0.906, 0.932], y: [3, -3] },
  { id: 'c-reass', win: [0.838, 0.86, 0.906, 0.926] },
  { id: 't-final', win: [0.94, 0.972, 2, 3] },
  { id: 'c-final', win: [0.946, 0.974, 2, 3] },
];

export function createUI({ onNavigate, onReplay, onDiscover, onSound, portrait }) {
  const stage = $('#stage');
  const root = document.documentElement;
  const items = TEXT.map((t) => {
    const el = document.getElementById(t.id);
    return { ...t, el, lines: $$('.in', el), last: -1 };
  }).filter((t) => t.el);

  // ── chapter nav ──
  const nav = $('#chapters');
  CHAPTERS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Chapter ${c.n} — ${c.name}`);
    b.innerHTML = `<b>${c.n} ${c.name}</b><i></i>`;
    b.addEventListener('click', () => onNavigate(c.a + 0.002));
    nav.appendChild(b);
    c.btn = b;
  });
  $('#brand').addEventListener('click', (e) => { e.preventDefault(); onNavigate(0); });
  $('#btn-replay').addEventListener('click', onReplay);
  $('#btn-discover').addEventListener('click', onDiscover);
  const soundBtn = $('#btn-sound');
  soundBtn.addEventListener('click', () => {
    const on = onSound();
    soundBtn.setAttribute('aria-pressed', String(on));
    $('span', soundBtn).textContent = on ? 'SOUND ON' : 'SOUND OFF';
  });

  // ── technical tags + leader lines ──
  const tagLayer = $('#tags'), svg = $('#callouts');
  const TAGS = [
    { id: 'crystal', part: 'crystal', k: 'Sapphire crystal', v: '0.8', u: 'MM', dx: -60, dy: 96 },
    { id: 'bezel', part: 'bezel', k: 'Bezel', v: '316L', u: 'STEEL', dx: 60, dy: 96 },
    { id: 'calibre', part: 'mainPlate', k: 'Calibre A01', v: '28,800', u: 'VPH', dx: -70, dy: -78 },
    { id: 'reserve', part: 'gearTrain', k: 'Power reserve', v: '72', u: 'HOURS', dx: 70, dy: -78 },
    { id: 'components', part: 'case', k: 'Components', v: '164', u: '', dx: 100, dy: -96 },
    { id: 'case', part: 'caseback', pick: 'casebackRing', k: 'Caseback', v: '50', u: 'M WR', dx: -80, dy: -80 },
    { id: 'balance', part: 'balanceWheel', k: 'Balance wheel', v: '4', u: 'HZ', dx: 110, dy: -90 },
    { id: 'train', part: 'gearTrain', k: 'Gear train', v: '5', u: 'WHEELS', dx: -140, dy: -110 },
    { id: 'rotor', part: 'rotor', k: 'Rotor', v: '22', u: 'K GOLD', dx: 150, dy: -100 },
    { id: 'jewels', part: 'jewels', k: 'Jewels', v: '26', u: 'RUBIES', dx: -150, dy: -90 },
    { id: 'bridges', part: 'bridges', k: 'Bridges', v: 'COTES', u: 'DE GENEVE', dx: 150, dy: -110 },
  ].map((t) => {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<span class="k">${t.k}</span><span class="v">${t.v}${t.u ? `<small>${t.u}</small>` : ''}</span>`;
    tagLayer.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '2.5');
    svg.append(line, dot);
    return { ...t, part: t.pick || t.part, el, line, dot, w: 0, h: 0 };
  });

  const hint = $('#hint');
  const bar = $('#progress-bar');
  const chLabel = $('#chapter-label');
  let lastChapter = -1, lastDark = -1;
  const mix = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k)));

  function setTheme(k) {
    if (Math.abs(k - lastDark) < 0.002) return;
    lastDark = k;
    const bg = mix([244, 241, 234], [8, 8, 8], k);
    const ink = mix([9, 9, 9], [242, 238, 230], k);
    const ghost = mix([231, 225, 211], [20, 20, 20], k);
    root.style.setProperty('--bg', `rgb(${bg})`);
    root.style.setProperty('--ink', `rgb(${ink})`);
    root.style.setProperty('--ghost', `rgb(${ghost})`);
    root.style.setProperty('--muted', `rgba(${ink},.58)`);
    root.style.setProperty('--hair', `rgba(${ink},.24)`);
    root.style.setProperty('--glow', String(1 - k));
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', `rgb(${bg})`);
  }

  /** @param intro 0..1 time-based entrance multiplier for the hero type */
  function update(p, state, intro, project, parts, viewport) {
    setTheme(state.dark);

    // type reveals
    for (const t of items) {
      const [a, b, c, d] = t.win;
      let v = smoothstep(a, b, p) * (1 - smoothstep(c, d, p));
      if (t.intro !== undefined) v *= clamp((intro - t.intro * 0.12) / 0.7, 0, 1);
      if (Math.abs(v - t.last) < 0.0015 && v > 0.001 && v < 0.999) continue;
      t.last = v;
      const el = t.el;
      if (v < 0.001) { if (el.style.visibility !== 'hidden') { el.style.visibility = 'hidden'; el.style.opacity = '0'; } continue; }
      el.style.visibility = 'visible';
      el.style.opacity = String(Math.min(1, v * 1.6));
      const local = remap(p, a, d);
      const tx = t.x ? lerp(t.x[0], t.x[1], local) : 0, ty = t.y ? lerp(t.y[0], t.y[1], local) : 0;
      el.style.transform = `translate3d(${tx}vw, ${ty}vh, 0)`;
      // line mask: rise on the way in, lift on the way out
      const rin = ease.reveal(remap(p, a, b)), rout = ease.heavy(remap(p, c, d));
      const off = (1 - rin) * 105 - rout * 105;
      t.lines.forEach((ln, i) => {
        const stag = clamp(rin * (1 + 0.5 * (t.lines.length - 1)) - i * 0.5, 0, 1);
        const o = (1 - ease.reveal(stag)) * 105 - rout * 105;
        ln.style.transform = `translate3d(0, ${t.lines.length > 1 ? o : off}%, 0)`;
      });
    }

    // hint, progress, chapter
    const hv = (1 - smoothstep(0.004, 0.03, p)) * clamp((intro - 0.5) / 0.5, 0, 1);
    hint.style.opacity = hv.toFixed(3);
    bar.style.transform = `scaleX(${p.toFixed(4)})`;
    let ci = CHAPTERS.findIndex((c) => p >= c.a && p < c.b);
    if (ci < 0) ci = p >= 1 ? CHAPTERS.length - 1 : 0;
    if (ci !== lastChapter) {
      lastChapter = ci;
      CHAPTERS.forEach((c, i) => c.btn.classList.toggle('on', i === ci));
      chLabel.textContent = `${CHAPTERS[ci].n} / 08 — ${CHAPTERS[ci].name}`;
    }

    // technical tags: project part centres → leader lines
    const w = viewport.w, h = viewport.h;
    for (const t of TAGS) {
      const vis = state.lab?.[t.id] ?? 0;
      if (vis < 0.002) {
        if (t.el.style.visibility !== 'hidden') { t.el.style.visibility = 'hidden'; t.el.style.opacity = '0'; t.line.style.display = 'none'; t.dot.style.display = 'none'; }
        continue;
      }
      const part = parts.get(t.part);
      const pt = project(part);
      if (!pt) continue;
      const sx = (pt.x * 0.5 + 0.5) * w, sy = (-pt.y * 0.5 + 0.5) * h;
      const k = portrait() ? 0.7 : 1;
      const ex = sx + t.dx * k, ey = sy + t.dy * k;
      const e = ease.silk(vis);
      t.el.style.visibility = 'visible';
      t.el.style.opacity = vis.toFixed(3);
      const flip = t.dx < 0;
      const tw = t.el.offsetWidth;
      const tx = clamp(flip ? ex - tw : ex, 10, w - tw - 10);
      t.el.style.transform = `translate3d(${tx}px, ${t.dy < 0 ? ey - t.el.offsetHeight - 6 : ey + 6}px, 0)`;
      t.line.style.display = ''; t.dot.style.display = '';
      t.line.setAttribute('x1', sx); t.line.setAttribute('y1', sy);
      t.line.setAttribute('x2', lerp(sx, ex, e)); t.line.setAttribute('y2', lerp(sy, ey, e));
      t.dot.setAttribute('cx', sx); t.dot.setAttribute('cy', sy);
      t.line.style.opacity = vis; t.dot.style.opacity = vis;
    }
  }

  return { update };
}
