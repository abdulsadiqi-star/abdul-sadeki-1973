import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomEmail, registerViaUi, verifyEmailViaMail } from './helpers';

/**
 * Automated accessibility audit (WCAG 2.1 A/AA rules via axe-core) for light and dark themes.
 * Add every new page that visitors or creators use to PAGES — the suite must stay at zero violations.
 */
const PUBLIC_PAGES = ['/', '/login', '/register', '/forgot-password', '/no-such-page'];

async function audit(page: Page, opts: { modalOpen?: boolean } = {}) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  // While a Radix menu/dialog is open, the rest of the page is aria-hidden on purpose and focus is trapped
  // inside the overlay, so its (unreachable) controls are not a real problem; axe still flags them.
  if (opts.modalOpen) builder.disableRules(['aria-hidden-focus']);
  const results = await builder.analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× — ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n   ')}`);
  expect(summary, `axe violations on ${page.url()}\n${summary.join('\n')}`).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`a11y (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    for (const path of PUBLIC_PAGES) {
      test(`no violations on ${path}`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await audit(page);
      });
    }

    test('no violations on the studio onboarding and the account menu', async ({ page }) => {
      const email = randomEmail('a11y');
      await registerViaUi(page, email);
      await verifyEmailViaMail(page, email);
      await page.goto('/studio');
      await page.waitForLoadState('networkidle');
      await audit(page);
      await page.getByRole('button', { name: 'منوی حساب کاربری' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await audit(page, { modalOpen: true });
    });
  });
}
