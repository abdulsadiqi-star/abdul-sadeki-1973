import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, type Browser, type BrowserContext, type Page, type TestInfo, type WorkerInfo } from '@playwright/test';
import { E2E_PASSWORD, randomEmail, registerViaUi, verifyEmailViaMail } from './helpers';

const execFileAsync = promisify(execFile);

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
export type Actor = { email: string; password: string; name: string; state: StorageState };
export type FixtureVideo = { id: string; title: string; durationSeconds: number; heights: number[] };

type ProjectInfo = Pick<TestInfo, 'project'> | Pick<WorkerInfo, 'project'>;

/** A normal desktop browser UA: API calls made by the tests must not be mistaken for bots (see view rules). */
export const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** The project's browser settings (device, viewport, locale), so extra contexts behave like the test's own page. */
export function contextOptions(info: ProjectInfo) {
  const use = info.project.use;
  return {
    baseURL: use.baseURL,
    locale: use.locale ?? 'fa-IR',
    timezoneId: use.timezoneId ?? 'Asia/Tehran',
    ...(use.viewport ? { viewport: use.viewport } : {}),
    ...(use.userAgent ? { userAgent: use.userAgent } : {}),
    ...(use.deviceScaleFactor ? { deviceScaleFactor: use.deviceScaleFactor } : {}),
    ...(use.isMobile !== undefined ? { isMobile: use.isMobile } : {}),
    ...(use.hasTouch !== undefined ? { hasTouch: use.hasTouch } : {}),
  };
}

export async function newActorPage(browser: Browser, info: ProjectInfo, state?: StorageState) {
  const context = await browser.newContext({ ...contextOptions(info), ...(state ? { storageState: state } : {}) });
  return { context, page: await context.newPage() };
}

/** Register + verify an account through the UI (and optionally create its channel); returns its saved session. */
export async function createVerifiedUser(
  browser: Browser,
  info: ProjectInfo,
  options: { name: string; prefix: string; channel?: { name: string; handle: string } },
): Promise<Actor> {
  const { context, page } = await newActorPage(browser, info);
  try {
    const email = randomEmail(options.prefix);
    await registerViaUi(page, email, E2E_PASSWORD, options.name);
    await verifyEmailViaMail(page, email);
    if (options.channel) {
      await page.goto('/studio');
      await page.getByLabel('نام کانال').fill(options.channel.name);
      await page.getByLabel('شناسه‌ی کانال').fill(options.channel.handle);
      await expect(page.getByLabel('آزاد است')).toBeVisible();
      await page.getByRole('button', { name: 'ساخت کانال' }).click();
      await expect(page.getByRole('heading', { name: 'کانال خودتان را بسازید' })).toBeHidden();
    }
    return { email, password: E2E_PASSWORD, name: options.name, state: await context.storageState() };
  } finally {
    await context.close();
  }
}

/**
 * Create a real, playable HLS video (VP9 + Opus, 2 renditions, fa/en subtitles) on a channel by running the same
 * generator the developers use (`scripts/watch-fixture.ts`). Needs ffmpeg and the database of the running app.
 */
export async function createFixtureVideo(channelHandle: string, extra: string[] = []): Promise<FixtureVideo> {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'tsx', '--env-file-if-exists=.env', 'scripts/watch-fixture.ts', `--channel=${channelHandle}`, '--json', ...extra],
    { cwd: process.cwd(), timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const json = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('{'));
  if (!json) throw new Error(`watch-fixture printed no JSON:\n${stdout}`);
  return JSON.parse(json) as FixtureVideo;
}

/** Log in through the login form currently shown (used after a "log in first" redirect). */
export async function submitLoginForm(page: Page, actor: Pick<Actor, 'email' | 'password'>) {
  await page.getByLabel('ایمیل').fill(actor.email);
  await page.getByLabel('گذرواژه', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'ورود به حساب' }).click();
}
