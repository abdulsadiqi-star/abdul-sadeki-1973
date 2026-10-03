import * as THREE from 'three';

/**
 * All surface detail is generated on <canvas> — no image assets, no downloads.
 * Textures: brushed grain, sunburst dial, minute track, engraving, leather,
 * Côtes de Genève, perlage, date wheel, soft contact shadow.
 */

const mk = (w, h = w) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
};

function tex(canvas, { srgb = true, repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// deterministic PRNG so the watch looks identical on every load
function rng(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function createTextures(q) {
  const S = q.texSize;
  const A = q.anisotropy;
  const T = {};

  // ---- brushed grain (varies along v → concentric on lathe parts) ----------
  {
    const [c, g] = mk(128, 1024);
    const r = rng(3);
    for (let y = 0; y < 1024; y++) {
      const v = 150 + r() * 105;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, 128, 1);
    }
    T.brushed = tex(c, { srgb: false, repeat: true, aniso: A });
    T.brushed.repeat.set(1, 3);
  }

  // ---- sunburst dial -------------------------------------------------------
  {
    const [c, g] = mk(S);
    const R = S / 2, mm = S / 30; // dial radius 15 mm
    const r = rng(11);
    const base = g.createRadialGradient(R, R, 0, R, R, R);
    base.addColorStop(0, '#2c2b29'); base.addColorStop(1, '#1b1a19');
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    // fine radial brushing
    g.save(); g.translate(R, R);
    for (let i = 0; i < 1400; i++) {
      const a = r() * Math.PI * 2;
      const l = 0.04 + r() * 0.1;
      g.strokeStyle = `rgba(255,248,235,${l * 0.55})`;
      g.lineWidth = 0.5 + r() * 1.4;
      g.beginPath(); g.moveTo(Math.cos(a) * 2 * mm, Math.sin(a) * 2 * mm); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.stroke();
    }
    g.restore();
    // broad sunburst sheen via conic gradient
    if (g.createConicGradient) {
      const cg = g.createConicGradient(0.4, R, R);
      for (let i = 0; i <= 24; i++) {
        const a = i % 6 === 0 ? 0.18 : 0.0;
        cg.addColorStop(i / 24, `rgba(255,244,225,${a})`);
      }
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = cg; g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    // outer minute track (printed, warm gold)
    g.save(); g.translate(R, R);
    g.fillStyle = 'rgba(185,154,104,.85)';
    for (let i = 0; i < 60; i++) {
      g.save(); g.rotate((i / 60) * Math.PI * 2);
      const major = i % 5 === 0;
      g.fillRect(-0.05 * mm, -14.7 * mm, 0.1 * mm, major ? 0.55 * mm : 0.3 * mm);
      g.restore();
    }
    g.restore();
    // logo & print
    g.fillStyle = '#E9E2D2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `300 ${1.55 * mm}px "Inter Variable", Inter, sans-serif`;
    g.letterSpacing = `${0.55 * mm}px`;
    g.fillText('AUREL', R + 0.28 * mm, R - 7.6 * mm);
    g.fillStyle = 'rgba(185,154,104,.95)';
    g.font = `400 ${0.7 * mm}px "Inter Variable", Inter, sans-serif`;
    g.letterSpacing = `${0.28 * mm}px`;
    g.fillText('A01 · AUTOMATIC', R + 0.14 * mm, R - 6.0 * mm);
    g.font = `400 ${0.62 * mm}px "Inter Variable", Inter, sans-serif`;
    g.fillStyle = 'rgba(233,226,210,.6)';
    g.fillText('SWISS MADE', R + 0.1 * mm, R + 9.2 * mm);
    T.dial = tex(c, { aniso: A });
  }

  // ---- chapter / rehaut ring: minute track + quarter numerals -------------
  {
    const [c, g] = mk(S);
    const R = S / 2, mm = S / 34.6; // ring face radius 17.3 mm
    g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, S, S);
    g.translate(R, R);
    for (let i = 0; i < 60; i++) {
      g.save(); g.rotate((i / 60) * Math.PI * 2);
      const major = i % 5 === 0;
      g.fillStyle = major ? '#E9E2D2' : 'rgba(233,226,210,.7)';
      g.fillRect(-0.06 * mm, -16.95 * mm, 0.12 * mm, major ? 0.85 * mm : 0.45 * mm);
      g.restore();
    }
    g.fillStyle = '#B99A68'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `300 ${0.85 * mm}px "Inter Variable", Inter, sans-serif`;
    for (let i = 1; i <= 12; i++) {
      if (i % 3) continue;
      const a = (i / 12) * Math.PI * 2;
      g.save(); g.rotate(a); g.translate(0, -15.8 * mm);
      g.fillText(String(i === 12 ? 60 : i * 5), 0, 0);
      g.restore();
    }
    T.chapter = tex(c, { aniso: A });
  }

  // ---- caseback engraving --------------------------------------------------
  {
    const [c, g] = mk(S);
    const R = S / 2, mm = S / 38.2; // ring outer radius 19.1
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, '#c9ccd0'); grad.addColorStop(1, '#a9adb3');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    const r = rng(5);
    for (let i = 0; i < 1800; i++) { // fine radial grain
      const a = r() * Math.PI * 2, r0 = 15 * mm + r() * 4 * mm;
      g.strokeStyle = `rgba(0,0,0,${r() * 0.06})`; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(R + Math.cos(a) * r0, R + Math.sin(a) * r0);
      g.lineTo(R + Math.cos(a + 0.012) * r0, R + Math.sin(a + 0.012) * r0); g.stroke();
    }
    g.translate(R, R);
    g.fillStyle = '#4a4d52'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `500 ${0.72 * mm}px "Inter Variable", Inter, sans-serif`;
    const line = 'AUREL A01  ·  AUTOMATIC CALIBRE  ·  SAPPHIRE CRYSTAL  ·  WATER RESISTANT 50 M  ·  SWISS MADE  ·  No. 0001 / 1973  ·  ';
    const rad = 17.0 * mm, step = (Math.PI * 2) / line.length;
    for (let i = 0; i < line.length; i++) {
      g.save(); g.rotate(i * step + Math.PI / 2); g.translate(0, rad);
      g.rotate(Math.PI); // baseline faces the centre
      g.fillText(line[i], 0, 0); g.restore();
    }
    T.caseback = tex(c, { aniso: A });
  }

  // ---- date wheel (31 numerals) -------------------------------------------
  {
    const [c, g] = mk(S >> 1);
    const R = c.width / 2, mm = c.width / 25.8; // wheel outer radius 12.9
    g.fillStyle = '#EFEBE1'; g.fillRect(0, 0, c.width, c.width);
    g.translate(R, R);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `400 ${1.5 * mm}px "Inter Variable", Inter, sans-serif`;
    for (let n = 1; n <= 31; n++) {
      const phi = -((n - 17) / 31) * Math.PI * 2;
      g.save(); g.rotate(-phi); g.translate(10.6 * mm, 0);
      // numeral "up" follows the tangent, so it reads upright at the 3 o'clock window
      g.fillText(String(n), 0, 0); g.restore();
    }
    T.dateWheel = tex(c, { aniso: A });
  }
  // little printed patch visible through the dial window
  {
    const [c, g] = mk(256, 170);
    g.fillStyle = '#F2EFE6'; g.fillRect(0, 0, 256, 170);
    g.fillStyle = '#0c0c0c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '400 118px "Inter Variable", Inter, sans-serif';
    g.fillText('17', 128, 90);
    T.datePatch = tex(c, { aniso: A });
  }

  // ---- Côtes de Genève stripes -------------------------------------------
  {
    const [c, g] = mk(1024);
    const n = 34, w = 1024 / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      gr.addColorStop(0, '#6d6f73'); gr.addColorStop(0.5, '#f1f1f2'); gr.addColorStop(1, '#6d6f73');
      g.fillStyle = gr; g.fillRect(i * w, 0, w + 1, 1024);
    }
    T.geneve = tex(c, { repeat: true, aniso: A });
  }

  // ---- perlage (overlapping circular graining) ----------------------------
  {
    const [c, g] = mk(1024);
    g.fillStyle = '#8b8e93'; g.fillRect(0, 0, 1024, 1024);
    const step = 22, rad = 17;
    for (let row = 0; row * step * 0.82 < 1100; row++) {
      for (let col = -1; col * step < 1100; col++) {
        const x = col * step + (row % 2) * step * 0.5, y = row * step * 0.82;
        const gr = g.createRadialGradient(x - 3, y - 3, 1, x, y, rad);
        gr.addColorStop(0, '#f4f4f5'); gr.addColorStop(0.55, '#a9acb1'); gr.addColorStop(1, '#5d6066');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }
    }
    T.perlage = tex(c, { aniso: A });
  }

  // ---- leather with warm stitching ----------------------------------------
  {
    const [c, g] = mk(512, 1024);
    const r = rng(21);
    g.fillStyle = '#1a1613'; g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 9000; i++) {
      const x = r() * 512, y = r() * 1024, v = r();
      g.fillStyle = v > 0.5 ? `rgba(255,240,220,${0.03 + r() * 0.03})` : `rgba(0,0,0,${0.12 + r() * 0.12})`;
      g.beginPath(); g.arc(x, y, 1 + r() * 2.2, 0, Math.PI * 2); g.fill();
    }
    // stitching: dashed lines hugging both edges
    g.strokeStyle = '#B99A68'; g.lineWidth = 3.2; g.lineCap = 'round';
    g.setLineDash([16, 12]);
    for (const x of [34, 478]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
    // edge darkening
    const eg = g.createLinearGradient(0, 0, 512, 0);
    eg.addColorStop(0, 'rgba(0,0,0,.45)'); eg.addColorStop(0.07, 'rgba(0,0,0,0)');
    eg.addColorStop(0.93, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,.45)');
    g.setLineDash([]); g.fillStyle = eg; g.fillRect(0, 0, 512, 1024);
    T.leather = tex(c, { aniso: A });

    const [cb, gb] = mk(256, 512);
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 5200; i++) {
      const v = (r() * 255) | 0;
      gb.fillStyle = `rgba(${v},${v},${v},.5)`;
      gb.beginPath(); gb.arc(r() * 256, r() * 512, 1 + r() * 2.2, 0, Math.PI * 2); gb.fill();
    }
    T.leatherBump = tex(cb, { srgb: false, aniso: A });
  }

  // ---- soft contact shadow ---------------------------------------------------
  {
    const [c, g] = mk(256);
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(20,16,10,.55)'); gr.addColorStop(0.45, 'rgba(20,16,10,.22)'); gr.addColorStop(1, 'rgba(20,16,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    T.shadow = tex(c, { aniso: 1 });
  }

  return T;
}
