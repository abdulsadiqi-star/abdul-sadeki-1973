// Renders reel.html frame-by-frame with headless Chromium (parallel workers),
// then muxes the frames with soundtrack.wav into reel.mp4.
//   node render.js [--workers 4] [--frames 0,120,300]   (frames = preview stills only)
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WORKERS = +opt('--workers', 4);
const ONLY = opt('--frames', null);
const OUT = path.resolve(opt('--out', path.join(__dirname, 'build')));
const page_url = 'file://' + path.join(__dirname, 'reel.html') + '?capture=1';

async function worker(frames, dir) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(page_url);
  await page.waitForFunction(() => window.READY === true);
  for (const f of frames) {
    const url = await page.evaluate(f => { renderFrame(f); return document.getElementById('out').toDataURL('image/jpeg', 0.96); }, f);
    fs.writeFileSync(path.join(dir, `f_${String(f).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
  await browser.close();
}

(async () => {
  const dir = path.join(OUT, ONLY ? 'stills' : 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const total = 900;
  const list = ONLY ? ONLY.split(',').map(Number) : [...Array(total).keys()];
  const chunks = Array.from({ length: WORKERS }, (_, w) => list.filter((_, i) => i % WORKERS === w));
  const t0 = Date.now();
  await Promise.all(chunks.filter(c => c.length).map(c => worker(c, dir)));
  console.log(`rendered ${list.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (ONLY) return;
  const wav = path.join(__dirname, 'soundtrack.wav');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', path.join(dir, 'f_%04d.jpg'),
    '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-tune', 'film', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', path.join(__dirname, 'reel.mp4')], { stdio: 'inherit' });
  process.exit(r.status);
})();
