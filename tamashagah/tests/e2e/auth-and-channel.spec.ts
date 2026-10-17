import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, loginViaUi, openAccountMenu, randomEmail, registerViaUi, verifyEmailViaMail } from './helpers';

test.describe('foundation: RTL shell', () => {
  test('renders a Persian RTL document with the global header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // desktop: inline search box · phones: a search button that opens the bar
    if (page.viewportSize()!.width >= 768) await expect(page.getByRole('search')).toBeVisible();
    else await expect(page.getByRole('button', { name: 'جستجو' })).toBeVisible();
    await expect(page.getByRole('link', { name: /تماشاگاه/ }).first()).toBeVisible();
    // the logo sits on the right edge (inline-start) in RTL
    const logo = await page.getByRole('link', { name: /تماشاگاه — صفحه‌ی اصلی/ }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(logo!.x).toBeGreaterThan(viewport.width / 2);
  });

  test('has no horizontal scroll', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('shows the custom 404 page', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /پیدا نشد/ })).toBeVisible();
  });

  test('switches theme', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /تغییر پوسته/ }).click();
    await page.getByRole('menuitemradio', { name: 'تیره' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('auth journey', () => {
  test('studio redirects visitors to login and back', async ({ page }) => {
    await page.goto('/studio/videos');
    await expect(page).toHaveURL(/\/login\?next=%2Fstudio%2Fvideos|\/login\?next=\/studio\/videos/);
  });

  test('register → verify e-mail → create channel → logout → login', async ({ page }) => {
    const email = randomEmail('journey');
    await registerViaUi(page, email);

    // unverified banner is shown
    await expect(page.getByText('ایمیل شما هنوز تأیید نشده است')).toBeVisible();

    // channel creation is blocked until verification
    await page.goto('/studio');
    await expect(page.getByText('ابتدا ایمیل خود را تأیید کنید')).toBeVisible();

    await verifyEmailViaMail(page, email);

    await page.goto('/studio');
    await expect(page.getByRole('heading', { name: 'کانال خودتان را بسازید' })).toBeVisible();
    await page.getByLabel('نام کانال').fill('کانال آزمایشی');
    const handle = `e2e-${Date.now().toString(36)}`;
    await page.getByLabel('شناسه‌ی کانال').fill(handle);
    await expect(page.getByLabel('آزاد است')).toBeVisible();
    await page.getByRole('button', { name: 'ساخت کانال' }).click();

    // the channel exists: the account menu now links to it (the studio sidebar is a drawer on phones)
    await expect(page.getByRole('heading', { name: 'کانال خودتان را بسازید' })).toBeHidden();
    await openAccountMenu(page);
    await expect(page.getByRole('menu').getByRole('link', { name: 'مشاهده‌ی کانال' })).toHaveAttribute('href', `/channel/${handle}`);
    await expect(page.getByRole('menu').getByText('کانال آزمایشی')).toBeVisible();
    await page.getByRole('menuitem', { name: 'خروج از حساب' }).click();
    await expect(page.getByRole('link', { name: 'ثبت‌نام' }).first()).toBeVisible();

    await loginViaUi(page, email);
    await expect(page.getByRole('button', { name: 'منوی حساب کاربری' })).toBeVisible();
  });

  test('shows a generic error for wrong credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('ایمیل').fill('nobody@example.test');
    await page.getByLabel('گذرواژه', { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'ورود به حساب' }).click();
    await expect(page.getByText('ایمیل یا گذرواژه نادرست است.').first()).toBeVisible();
  });

  test('validates the registration form on the client', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: 'ساخت حساب کاربری' }).click();
    await expect(page.getByText('نام باید حداقل ۲ نویسه باشد.')).toBeVisible();
    await expect(page.getByText('ایمیل را وارد کنید.')).toBeVisible();
  });
});
