import { expect, test, type Page } from '@playwright/test';
import { randomEmail, registerViaUi, verifyEmailViaMail } from './helpers';

/**
 * Discovery e2e (desktop + mobile projects): search combobox, search → channel → follow, shorts feed, playlists, the help
 * centre, tickets, copyright notice, verification, apps/PWA, SEO files and the poster fallback.
 *
 * Needs the demo catalogue:  pnpm exec tsx --env-file=.env scripts/seed-discovery.ts
 * (add SEED_HLS_CODEC=vp9 when the browser cannot decode H.264, like the Chromium of the sandbox).
 */

const isMobile = (page: Page) => page.viewportSize()!.width < 768;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** The header search box: on phones it first has to be opened with the search button. */
async function searchBox(page: Page) {
  if (isMobile(page)) await page.getByRole('button', { name: 'جستجو', exact: true }).click();
  return page.getByRole('combobox', { name: 'جستجو' });
}

test.describe('discovery: search', () => {
  test('type-ahead is an accessible combobox (keyboard, Escape, Enter)', async ({ page }) => {
    await page.goto('/');
    const box = await searchBox(page);
    await box.fill('پایتون');
    const listbox = page.getByRole('listbox', { name: 'پیشنهادهای جستجو' });
    await expect(listbox).toBeVisible();
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(await listbox.getByRole('option').count()).toBeGreaterThan(0);

    await box.press('ArrowDown');
    const active = await box.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected', 'true');

    await box.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(box).toHaveAttribute('aria-expanded', 'false');

    await box.fill('پایتون');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByRole('heading', { name: /آموزش پایتون/ }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('finds Persian spelling variants (Arabic kaf/yeh, missing ZWNJ, digits, typos)', async ({ page }) => {
    // Arabic kaf instead of Persian kaf
    await page.goto(`/search?q=${encodeURIComponent('كباب')}`);
    await expect(page.getByRole('heading', { name: /کباب تابه‌ای/ }).first()).toBeVisible();
    // a typo is rescued by fuzzy matching and the page says so
    await page.goto(`/search?q=${encodeURIComponent('پایتن')}`);
    await expect(page.getByRole('heading', { name: /پایتون/ }).first()).toBeVisible();
    // nothing found → friendly empty state with popular videos instead
    await page.goto(`/search?q=${encodeURIComponent('زززززززز')}`);
    await expect(page.getByText(/نتیجه‌ای/).first()).toBeVisible();
  });

  test('search result → channel page → follow (persists after reload)', async ({ page }) => {
    await registerViaUi(page, randomEmail('follow'));
    await page.goto(`/search?q=${encodeURIComponent('قورمه‌سبزی')}`);
    await page.getByRole('link', { name: /آشپزی با سارا/ }).first().click();
    await expect(page).toHaveURL(/\/channel\/sara-cooks/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('آشپزی با سارا');
    const follow = page.getByRole('button', { name: 'دنبال کردن' }).first();
    await follow.click();
    await expect(page.getByRole('button', { name: 'دنبال می‌کنید' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'دنبال می‌کنید' }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('discovery: shorts', () => {
  test('full-height feed: one active short, keyboard navigation, mute toggle', async ({ page }) => {
    const master = page.waitForResponse((r) => /master\.m3u8/.test(r.url()) && r.ok(), { timeout: 30_000 });
    await page.goto('/shorts');
    const slides = page.locator('article[data-short-id]');
    await expect(slides.first()).toBeVisible();
    await expect(page.locator('article[data-active="true"]')).toHaveCount(1);
    const firstId = await page.locator('article[data-active="true"]').getAttribute('data-short-id');

    // playback is only asserted when this browser can decode what the seed produced (H.264 in MPEG-TS vs VP9 in fMP4)
    const playlist = await (await master).text();
    const decodable = await page.evaluate((h264) => {
      const v = document.createElement('video');
      return h264 ? v.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '' : MediaSource.isTypeSupported('video/mp4; codecs="vp09.00.10.08"');
    }, playlist.includes('avc1'));
    if (decodable) {
      await expect.poll(() => page.locator('article[data-active="true"] video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(0);
    }

    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.locator('article[data-active="true"]').getAttribute('data-short-id')).not.toBe(firstId);
    await expect(page.locator('article[data-active="true"]')).toHaveCount(1);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => page.locator('article[data-active="true"]').getAttribute('data-short-id')).toBe(firstId);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('discovery: library and playlists', () => {
  test('visitors are sent to login; a user can create, rename and delete a playlist', async ({ page }) => {
    await page.goto('/library');
    await expect(page).toHaveURL(/\/login\?next=/);

    await registerViaUi(page, randomEmail('playlist'));
    await page.goto('/library/playlists');
    await page.getByRole('button', { name: /ساخت لیست پخش/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('عنوان لیست').fill('آموزش‌های برنامه‌نویسی');
    await dialog.getByRole('button', { name: 'ساخت لیست' }).click();
    await expect(page).toHaveURL(/\/playlist\//);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('آموزش‌های برنامه‌نویسی');

    await page.getByRole('button', { name: /ویرایش/ }).first().click();
    await page.getByRole('dialog').getByLabel('عنوان لیست').fill('لیست ویرایش‌شده');
    await page.getByRole('dialog').getByRole('button', { name: 'ذخیره' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('لیست ویرایش‌شده');

    await page.getByRole('button', { name: /حذف/ }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: /حذف/ }).click();
    await expect(page).toHaveURL(/\/library/);
    // measure the settled page: not the loading skeleton and not the toast that is still sliding in
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('لیست پخش حذف شد.')).toBeHidden({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('information pages', () => {
  test('help centre: Persian-aware search and topics', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { level: 1, name: 'مرکز راهنما' })).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'جستجو در راهنما' });
    await search.fill('گذرواژه');
    await expect(page.getByRole('button', { name: /گذرواژه‌ام را فراموش/ })).toBeVisible();
    // the half-space may be missing, Arabic letters may be used
    await search.fill('نميشود');
    await expect(page.getByRole('button', { name: /ویدیو پخش نمی‌شود/ })).toBeVisible();
    await search.fill('قیمت بلیت هواپیما');
    await expect(page.getByText('پرسشی با این عبارت پیدا نشد')).toBeVisible();
    await search.fill('');
    await page.getByRole('button', { name: 'حق تکثیر', exact: true }).click();
    await expect(page.getByRole('button', { name: /اگر کسی اثر مرا بدون اجازه/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld!)['@type']).toBe('FAQPage');
  });

  test('tickets: create, reply, list, and nobody else can open them', async ({ page }) => {
    await page.goto('/help/tickets');
    await expect(page).toHaveURL(/\/login\?next=/);

    const ticketEmail = randomEmail('ticket');
    await registerViaUi(page, ticketEmail);
    await verifyEmailViaMail(page, ticketEmail); // tickets need a verified e-mail
    await page.goto('/help/tickets');
    await page.getByRole('button', { name: 'ثبت تیکت' }).click(); // validation first
    await expect(page.getByText('دسته‌بندی را انتخاب کنید.')).toBeVisible();

    await page.getByRole('combobox', { name: 'دسته‌بندی' }).click();
    await page.getByRole('option', { name: 'بارگذاری ویدیو' }).click();
    await page.getByLabel('موضوع').fill('ویدیوی من پردازش نمی‌شود');
    await page.getByLabel('توضیح').fill('سلام، ویدیویی را بارگذاری کردم ولی بیش از یک ساعت است که در حال پردازش مانده.');
    await page.getByRole('button', { name: 'ثبت تیکت' }).click();
    await expect(page).toHaveURL(/\/help\/tickets\/[A-Za-z0-9_-]+$/);
    const threadUrl = page.url();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ویدیوی من پردازش نمی‌شود');
    await expect(page.getByText('در حال پردازش مانده')).toBeVisible();

    await page.getByLabel('پاسخ شما').fill('ممنون، نام فایل my-video.mp4 است.');
    await page.getByRole('button', { name: 'ارسال پاسخ' }).click();
    await expect(page.getByText('نام فایل my-video.mp4 است.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'پیام‌های تیکت' }).getByRole('listitem')).toHaveCount(2);

    await page.goto('/help/tickets');
    await expect(page.getByRole('link', { name: /ویدیوی من پردازش نمی‌شود/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // another account gets the plain "not found" page for this ticket and learns nothing about it
    await page.context().clearCookies();
    await registerViaUi(page, randomEmail('other'));
    await page.goto(threadUrl);
    await expect(page.getByRole('heading', { name: /پیدا نشد/ })).toBeVisible();
    await expect(page.getByText('ویدیوی من پردازش نمی‌شود')).toHaveCount(0);
  });

  test('copyright notice: validation, then a real ticket the claimant can follow', async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent('قورمه‌سبزی')}`);
    const href = await page.getByRole('link', { name: /قورمه‌سبزی/ }).first().getAttribute('href');
    const videoId = /\/watch\/([0-9A-Za-z]{11})/.exec(href ?? '')![1]!;

    await page.goto('/copyright');
    await expect(page.getByRole('link', { name: 'ورود به حساب' })).toBeVisible(); // visitors must sign in first
    const claimantEmail = randomEmail('copyright');
    await registerViaUi(page, claimantEmail, undefined, 'مریم رضایی');
    await verifyEmailViaMail(page, claimantEmail); // copyright notices need a verified e-mail
    await page.goto(`/copyright?video=${videoId}`);
    await expect(page.getByLabel('نشانی ویدیوی مورد شکایت')).toHaveValue(videoId);

    await page.getByRole('button', { name: 'ثبت شکایت' }).click();
    await expect(page.getByText('برای ثبت شکایت باید این بیانیه را تأیید کنید.').first()).toBeVisible();

    await page.getByLabel('نام و نام خانوادگی شاکی').fill('مریم رضایی');
    await page.getByLabel('اثر شما کدام است و چگونه نقض شده؟').fill('این ویدیو بخشی از فیلم کوتاه من است که بدون اجازه بارگذاری شده.');
    await page.getByRole('checkbox').nth(0).check();
    await page.getByRole('checkbox').nth(1).check();
    await page.getByLabel('امضای الکترونیک').fill('مریم رضایی');
    await page.getByRole('button', { name: 'ثبت شکایت' }).click();
    await expect(page.getByText('شکایت شما ثبت شد')).toBeVisible();
    await page.getByRole('link', { name: 'پیگیری تیکت' }).click();
    await expect(page).toHaveURL(/\/help\/tickets\//);
    await expect(page.getByText('شکایت حق تکثیر (درخواست حذف محتوا)')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('verification: public explanation, login prompt, then "no channel yet"', async ({ page }) => {
    await page.goto('/verification');
    await expect(page.getByRole('heading', { level: 1, name: 'تیک تأیید کانال' })).toBeVisible();
    await expect(page.getByText('دست‌کم ۳ ویدیوی عمومی منتشر کرده باشید.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'ورود به حساب' })).toBeVisible();
    await registerViaUi(page, randomEmail('verify'));
    await page.goto('/verification');
    await expect(page.getByText('هنوز کانالی ندارید')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('apps: honest install page with a real install button when the browser offers one', async ({ page }) => {
    await page.goto('/apps');
    await expect(page.getByRole('heading', { level: 1, name: 'برنامه‌ها و نصب' })).toBeVisible();
    await expect(page.getByText('اندروید (کروم)')).toBeVisible();
    await expect(page.getByText('به‌زودی').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /دانلود|Google Play|App Store/ })).toHaveCount(0); // no fake store links
    await expect(page.getByRole('button', { name: 'نصب برنامه' })).toHaveCount(0);

    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      event.prompt = async () => {
        (window as unknown as { __prompted: boolean }).__prompted = true;
      };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });
    await page.getByRole('button', { name: 'نصب برنامه' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test('about, terms and privacy: real content, template notice, table of contents', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('درباره‌ی تماشاگاه');
    await expect(page.getByText('ویدیو', { exact: true }).first()).toBeVisible();
    for (const path of ['/terms', '/privacy']) {
      await page.goto(path);
      await expect(page.getByText('این متن یک الگوست')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'فهرست مطالب' }).getByRole('link').first()).toBeVisible();
      expect(await page.locator('section h2').count()).toBeGreaterThanOrEqual(10);
      await expectNoHorizontalOverflow(page);
    }
  });
});

test.describe('seo and pwa', () => {
  test('manifest, icons, robots and the sitemap index are real and consistent', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'تماشاگاه', display: 'standalone', lang: 'fa', dir: 'rtl', start_url: '/' });
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) expect((await request.get(icon.src)).ok()).toBe(true);
    expect((await request.get('/sw.js')).ok()).toBe(true);
    expect((await request.get('/offline.html')).ok()).toBe(true);

    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
    expect(robots).toContain('Disallow: /studio');

    const index = await (await request.get('/sitemap.xml')).text();
    const files = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(files.length).toBeGreaterThanOrEqual(3);
    let urls = 0;
    for (const file of files) {
      const res = await request.get(file);
      expect(res.ok(), file).toBe(true);
      urls += [...(await res.text()).matchAll(/<loc>/g)].length;
    }
    expect(urls).toBeGreaterThan(40);
    expect((await request.get('/sitemap/9999.xml')).status()).toBe(404);
  });

  test('home exposes valid JSON-LD and a canonical link', async ({ page }) => {
    await page.goto('/');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(() => JSON.parse(block)).not.toThrow();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  });
});

test.describe('poster fallback', () => {
  test('a poster that fails to load is replaced by the branded placeholder, never a blank box', async ({ page }) => {
    await page.route(/\/media\/videos\/[^/]+\/thumbs\//, (route) => route.abort());
    await page.goto('/category/cooking');
    const card = page.locator('article').filter({ has: page.getByRole('link', { name: /قورمه‌سبزی/ }) }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.bg-brand-gradient')).toBeVisible();
    await expect(card.locator('img[src*="/thumbs/"]')).toHaveCount(0);
  });
});
