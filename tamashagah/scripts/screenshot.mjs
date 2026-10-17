#!/usr/bin/env node
/**
 * Visual check helper: screenshots pages at desktop / tablet / mobile sizes.
 *
 *   node scripts/screenshot.mjs / /login /studio --base=http://localhost:3000 \
 *        --out=.data/screenshots --viewports=desktop,mobile --theme=dark --as=sara@tamashagah.test --full
 *
 * Options
 *   --base=URL          app URL (default http://localhost:3000)
 *   --out=DIR           output directory (default .data/screenshots)
 *   --viewports=a,b     desktop | tablet | mobile (default desktop,mobile)
 *   --theme=light|dark  prefers-color-scheme (default light)
 *   --as=EMAIL          sign in first as a seeded account (password from .data/seed-credentials.json or SEED_PASSWORD)
 *   --full              full-page screenshots
 *   --wait=MS           extra wait after load (default 400)
 *
 * Uses the preinstalled Chromium (PW_CHROMIUM_PATH overrides auto-detection).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const base = opt('base', 'http://localhost:3000').replace(/\/$/, '');
const outDir = path.resolve(opt('out', '.data/screenshots'));
const viewports = opt('viewports', 'desktop,mobile').split(',');
const theme = opt('theme', 'light');
const as = opt('as');
const full = flag('full');
const extraWait = Number(opt('wait', '400'));
const paths = args.filter((a) => a.startsWith('/'));

const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false },
  tablet: { viewport: { width: 834, height: 1112 }, isMobile: true, hasTouch: true },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

async function findChromium() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const dirs = (await fs.readdir(root)).filter((d) => /^chromium-\d+$/.test(d)).sort();
    const latest = dirs.at(-1);
    if (latest) return path.join(root, latest, 'chrome-linux', 'chrome');
  } catch {
    /* fall through to Playwright's own lookup */
  }
  return undefined;
}

async function passwordFor(email) {
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  const creds = JSON.parse(await fs.readFile('.data/seed-credentials.json', 'utf8'));
  if (!creds[email]) throw new Error(`No stored password for ${email}`);
  return creds[email];
}

const slug = (p) => (p === '/' ? 'home' : p.replace(/[^\w]+/g, '_').replace(/^_|_$/g, ''));

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: await findChromium(), args: ['--no-sandbox'] });

for (const vp of viewports) {
  const size = SIZES[vp];
  if (!size) throw new Error(`Unknown viewport: ${vp}`);
  const context = await browser.newContext({ ...size, colorScheme: theme, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`  [pageerror ${vp}]`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`  [console.error ${vp}]`, m.text().slice(0, 300));
  });

  if (as) {
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await page.getByLabel('ایمیل').fill(as);
    await page.getByLabel('گذرواژه', { exact: true }).fill(await passwordFor(as));
    await page.getByRole('button', { name: 'ورود به حساب' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  }

  for (const p of paths) {
    const res = await page.goto(base + p, { waitUntil: 'networkidle' }).catch((e) => {
      console.error(`  goto failed ${p}: ${e.message}`);
      return null;
    });
    await page.waitForTimeout(extraWait);
    const file = path.join(outDir, `${slug(p)}.${vp}.${theme}.png`);
    await page.screenshot({ path: file, fullPage: full });
    console.log(`${res?.status() ?? '???'} ${vp.padEnd(7)} ${p} → ${path.relative(process.cwd(), file)}`);
  }
  await context.close();
}
await browser.close();
