import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/** Preinstalled Chromium (cloud sandbox) unless Playwright's own download exists. */
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const latest = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .at(-1);
    const candidate = latest ? path.join(root, latest, 'chrome-linux', 'chrome') : undefined;
    return candidate && fs.existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

/**
 * The stack is started separately (see docs/testing.md); this config only drives the browser.
 * Set E2E_START_SERVER=1 to let Playwright start `next start` on the port of E2E_BASE_URL.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { executablePath: chromiumPath(), args: ['--no-sandbox'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_START_SERVER
    ? {
        command: `pnpm start`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { PORT: new URL(baseURL).port || '3100' },
      }
    : undefined,
});
