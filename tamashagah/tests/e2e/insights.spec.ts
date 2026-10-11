import fs from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { E2E_PASSWORD, loginViaUi, openAccountMenu } from './helpers';
import { E2E_EMAIL_PREFIX, cleanupFixtures, runFixture, type ApplicationRow, type SeedResult } from './support/db';

/**
 * Creator studio: dashboard, analytics, settings and monetization, driven in a real browser against a production
 * build and the real database. Data comes from `support/db-runner.ts` fixtures with EXPLICIT timestamps; every
 * expected number below is computed here, from the fixture list, with `Intl` (ICU's own Tehran and Persian-calendar
 * data) — no code from `lib/analytics` is reused, so the page and the oracle can only agree if both are right.
 */

/* ----------------------------------------------------------------------------------------------- oracle */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const tehranFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
const persianFormat = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric' });

/** Gregorian `YYYY-MM-DD` of the Tehran day an instant falls on. */
const tehranKey = (instant: Date): string => tehranFormat.format(instant);
/** The instant a Tehran day starts (Iran has had no DST since 2022: a fixed +03:30). */
const dayStart = (key: string): Date => new Date(`${key}T00:00:00+03:30`);
const todayKey = (): string => tehranKey(new Date());
/** Key of the Tehran day `n` days before today. */
const keyBack = (n: number): string => tehranKey(new Date(dayStart(todayKey()).getTime() - n * DAY + 12 * HOUR));
/** Noon of that day; for today, halfway between midnight and now (so it is never in the future). */
const noon = (n: number): Date => (n === 0 ? new Date((dayStart(todayKey()).getTime() + Date.now()) / 2) : new Date(dayStart(keyBack(n)).getTime() + 12 * HOUR));
/** 00:01 Tehran — 20:31 UTC of the previous UTC day. */
const justAfterMidnight = (n: number): Date => new Date(dayStart(keyBack(n)).getTime() + 60_000);
/** 23:59 Tehran. */
const justBeforeMidnight = (n: number): Date => new Date(dayStart(keyBack(n)).getTime() + DAY - 60_000);

const jalali = (key: string) => {
  const parts = Object.fromEntries(persianFormat.formatToParts(new Date(dayStart(key).getTime() + 12 * HOUR)).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
};
/** First Tehran day of the current Jalali month, and first/last day of the previous one. */
const monthStartKey = (): string => keyBack(jalali(todayKey()).day - 1);
const previousMonth = (): { from: string; to: string } => {
  const to = keyBack(jalali(todayKey()).day); // the day before this month started
  const month = jalali(to).month;
  let back = jalali(todayKey()).day;
  while (jalali(keyBack(back + 1)).month === month) back += 1;
  return { from: keyBack(back), to };
};

const fa = (n: number, options?: Intl.NumberFormatOptions): string => new Intl.NumberFormat('fa-IR', options).format(n);
/** «۱٬۲۳۴» → 1234 (Persian digits, group separators ignored). */
const digitsToNumber = (text: string): number => Number(text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[^\d.]/g, ''));
const faPercent = (value: number): string => new Intl.NumberFormat('fa-IR', { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);

type View = { video: 'v1' | 'v2' | 'v3'; at: Date; viewer: string; watch: number; source: 'REAL' | 'SEED'; device?: 'DESKTOP' | 'MOBILE'; referrer?: string };

const between = (views: View[], fromKey: string, toKey: string, only?: View['video']) =>
  views.filter((v) => {
    const key = tehranKey(v.at);
    return key >= fromKey && key <= toKey && (!only || v.video === only);
  });
const summarize = (views: View[]) => ({
  views: views.length,
  seed: views.filter((v) => v.source === 'SEED').length,
  unique: new Set(views.map((v) => v.viewer)).size,
  minutes: Math.round(views.reduce((sum, v) => sum + v.watch, 0) / 60),
});
/** The % badge: change versus the previous period, rounded to one decimal like the page does. */
const percentChange = (current: number, previous: number): number => Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;

/* -------------------------------------------------------------------------------------------- fixtures */

const TITLES = {
  v1: 'آموزش پخت کیک اسفنجی',
  v2: 'سفرنامه‌ی کویر لوت',
  v3: 'نقد و بررسی یک کتاب',
  processing: 'ویدیوی در حال پردازش',
  failed: 'ویدیوی ناموفق',
} as const;
const PENDING_BODY = 'دیدگاه آزمایشی که منتظر تأیید سازنده است';
const APPROVED_BODY = 'دیدگاه آزمایشی تأییدشده';

type Creator = SeedResult & { email: string; password: string };

const created: string[] = [];
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function seedCreator(label: string, extra: Record<string, unknown> = {}): Creator {
  const email = `${E2E_EMAIL_PREFIX}${label}-${unique()}@example.test`;
  const result = runFixture<SeedResult>({
    command: 'seed',
    email,
    password: E2E_PASSWORD,
    displayName: `سازنده ${label}`,
    handle: `e2e-${label}-${unique()}`,
    channelName: `کانال ${label}`,
    ...extra,
  });
  created.push(result.userId, ...Object.values(result.fanIds));
  return { ...result, email, password: E2E_PASSWORD };
}

/** Events of the main fixture channel. `noon(0)` etc. are evaluated once, in `beforeAll`. */
function mainViews(): View[] {
  return [
    // today
    { video: 'v1', at: noon(0), viewer: 'a', watch: 60, source: 'REAL' },
    { video: 'v1', at: noon(0), viewer: 'b', watch: 60, source: 'REAL', device: 'MOBILE' },
    { video: 'v2', at: noon(0), viewer: 'a', watch: 60, source: 'REAL' },
    // 23:59 yesterday: belongs to yesterday, not today (and not to the next UTC day)
    { video: 'v1', at: justBeforeMidnight(1), viewer: 'c', watch: 60, source: 'REAL' },
    // 00:01 three days ago = 20:31 UTC four days ago: a UTC-bucketed chart would put it a day early
    { video: 'v1', at: justAfterMidnight(3), viewer: 'a', watch: 60, source: 'REAL' },
    { video: 'v2', at: noon(3), viewer: 'b', watch: 60, source: 'REAL' },
    { video: 'v2', at: noon(3), viewer: 'b', watch: 60, source: 'REAL' },
    { video: 'v2', at: noon(10), viewer: 'd', watch: 60, source: 'REAL', device: 'MOBILE', referrer: 'google.com' },
    { video: 'v3', at: noon(20), viewer: 'e', watch: 60, source: 'REAL' },
    { video: 'v3', at: noon(20), viewer: 'f', watch: 60, source: 'REAL' },
    // 40 days ago: outside the last 30 days, inside the 30 days before them (drives the % change)
    ...[1, 2, 3, 4, 5].map((i): View => ({ video: 'v1', at: noon(40), viewer: `p${i}`, watch: 60, source: 'REAL' })),
    // 45 days ago: synthetic. Only ranges reaching back this far may show the "sample data" notice
    ...[1, 2, 3, 4, 5, 6].map((i): View => ({ video: 'v2', at: noon(45), viewer: `s${i}`, watch: 60, source: 'SEED' })),
  ];
}

let main: Creator;
let views: View[];

/**
 * The fixture channel is signed in ONCE (the login endpoint allows 8 attempts per account and 15 minutes) and every test
 * starts from that session. Tests that need another account call `signIn`, which drops it first.
 */
const MAIN_STATE = path.resolve('.data', 'e2e', 'insights-main-state.json');
/** `browser.newContext()` inherits the file-level `storageState`: contexts that must start anonymous say so. */
const SIGNED_OUT = { cookies: [], origins: [] };
test.use({ storageState: MAIN_STATE });

test.beforeAll(async ({ browser }) => {
  views = mainViews();
  main = seedCreator('main', {
    followerCount: 2,
    fans: ['f1', 'f2'],
    videos: [
      { key: 'v1', title: TITLES.v1 },
      { key: 'v2', title: TITLES.v2 },
      { key: 'v3', title: TITLES.v3 },
      { key: 'processing', title: TITLES.processing, state: 'processing' },
      { key: 'failed', title: TITLES.failed, state: 'failed' },
    ],
    views: views.map((v) => ({ ...v, at: v.at.toISOString() })),
    likes: [
      { video: 'v1', fan: 'f1', at: noon(3).toISOString() },
      { video: 'v1', fan: 'f2', at: noon(3).toISOString() },
      { video: 'v2', fan: 'f1', at: noon(45).toISOString() },
    ],
    comments: [
      { video: 'v1', fan: 'f1', at: noon(0).toISOString(), status: 'PENDING', body: PENDING_BODY },
      { video: 'v2', fan: 'f2', at: noon(3).toISOString(), status: 'APPROVED', body: APPROVED_BODY },
    ],
    followEvents: [
      { type: 'FOLLOW', at: noon(2).toISOString() },
      { type: 'FOLLOW', at: noon(2).toISOString() },
      { type: 'UNFOLLOW', at: noon(2).toISOString() },
      { type: 'FOLLOW', at: noon(45).toISOString(), source: 'SEED' },
      { type: 'FOLLOW', at: noon(45).toISOString(), source: 'SEED' },
    ],
    follows: [
      { fan: 'f1', notify: true },
      { fan: 'f2', notify: false },
    ],
  });

  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'fa-IR', timezoneId: 'Asia/Tehran', storageState: SIGNED_OUT });
  const page = await context.newPage();
  await loginViaUi(page, main.email, main.password);
  await fs.mkdir(path.dirname(MAIN_STATE), { recursive: true });
  await context.storageState({ path: MAIN_STATE });
  await context.close();
});

test.afterAll(async () => {
  cleanupFixtures(created);
  await fs.rm(MAIN_STATE, { force: true });
});

/* ---------------------------------------------------------------------------------------------- helpers */

/** Sign in as another account: the file-level session of the fixture channel is dropped first. */
async function signIn(page: Page, who: Creator) {
  await page.context().clearCookies();
  await loginViaUi(page, who.email, who.password);
}

/** The big number of a `StatCard` (first token of the cell's text; the badge and label follow it). */
async function statValue(page: Page, id: string): Promise<string> {
  const text = await page.getByTestId(`stat-${id}`).innerText();
  return text.trim().split(/\s+/)[0]!;
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function chooseRange(page: Page, label: string) {
  await page.getByRole('combobox', { name: 'بازه‌ی زمانی' }).click();
  await page.getByRole('option', { name: label }).click();
}

/** Rows of the chart's data table (header excluded), oldest first. */
const chartRows = (page: Page) => page.getByRole('table', { name: /جدول داده‌های نمودار/ }).getByRole('row');

/** Browser-side probe: for every Jalali x-axis label, is the number drawn to the RIGHT of the month name? */
const TICK_ORDER_PROBE = () => {
  const out: { text: string; numberIsOnTheRight: boolean }[] = [];
  const firstTextNode = (node: Node): Text | null => {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
    for (const child of Array.from(node.childNodes)) {
      const found = firstTextNode(child);
      if (found) return found;
    }
    return null;
  };
  for (const label of Array.from(document.querySelectorAll('.recharts-wrapper svg text'))) {
    const text = label.textContent ?? '';
    const number = /[۰-۹]+/.exec(text);
    const word = /[ء-يٰ-ۓ]+/.exec(text);
    const node = firstTextNode(label);
    if (!number || !word || !node) continue;
    const rect = (start: number, end: number) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      return range.getBoundingClientRect();
    };
    out.push({
      text: text.split(String.fromCharCode(0x200f)).join('<RLM>'),
      numberIsOnTheRight: rect(number.index, number.index + number[0].length).left > rect(word.index, word.index + word[0].length).left,
    });
  }
  return out;
};

/* ------------------------------------------------------------------------------------------- dashboard */

test.describe('dashboard /studio', () => {
  test('headline numbers, videos, comments and alerts equal the database fixtures', async ({ page }) => {
    await page.goto('/studio');

    // the onboarding block belongs to users WITHOUT a channel
    await expect(page.getByRole('heading', { name: 'کانال خودتان را بسازید' })).toHaveCount(0);

    const today = todayKey();
    expect(await statValue(page, 'videos')).toBe(fa(5));
    await expect(page.getByTestId('stat-videos')).toContainText(`${fa(3)} منتشرشده`);
    expect(await statValue(page, 'followers')).toBe(fa(2));
    expect(await statValue(page, 'total-views')).toBe(fa(views.length));
    expect(await statValue(page, 'today-views')).toBe(fa(views.filter((v) => tehranKey(v.at) === today).length));

    // synthetic rows are labelled where they are part of a number, and only there
    await expect(page.getByTestId('stat-total-views')).toContainText('نمونه');
    await expect(page.getByTestId('stat-today-views')).not.toContainText('نمونه');
    await expect(page.getByTestId('sample-footnote')).toBeVisible();

    // latest videos with all-time views and likes
    const rows = page.getByTestId('dashboard-video');
    await expect(rows).toHaveCount(5);
    const v1 = rows.filter({ hasText: TITLES.v1 });
    await expect(v1.getByTitle('بازدید', { exact: true })).toContainText(fa(views.filter((v) => v.video === 'v1').length));
    await expect(v1.getByTitle('پسند', { exact: true })).toContainText(fa(2));
    await expect(v1.getByRole('link', { name: `آمار «${TITLES.v1}»` })).toHaveAttribute('href', `/studio/analytics?video=${main.videoIds.v1}`);
    await expect(rows.filter({ hasText: TITLES.v2 }).getByTitle('بازدید', { exact: true })).toContainText(fa(views.filter((v) => v.video === 'v2').length));

    // upload alerts
    const alerts = page.getByTestId('upload-alerts');
    await expect(alerts).toContainText(`${fa(1)} ویدیو پردازش نشد`);
    await expect(alerts).toContainText(`${fa(1)} ویدیو در حال پردازش است`);
    await expect(alerts.getByRole('link', { name: TITLES.failed })).toHaveAttribute('href', `/studio/videos/${main.videoIds.failed}/edit`);

    // comments: one waiting for approval, one published
    await expect(page.getByTestId('pending-comments')).toContainText(`${fa(1)} دیدگاه در انتظار تأیید شما`);
    const comments = page.getByTestId('recent-comments').getByTestId('dashboard-comment');
    await expect(comments).toHaveCount(2);
    await expect(comments.filter({ hasText: PENDING_BODY })).toContainText('در انتظار تأیید');
    await expect(comments.filter({ hasText: APPROVED_BODY })).not.toContainText('در انتظار تأیید');

    // the two tips link to real pages
    const tips = page.getByRole('region', { name: 'نکته‌هایی برای سازندگان' });
    await expect(tips.getByRole('link', { name: /راهنمای سازندگان/ })).toHaveAttribute('href', '/help');
    await expect(tips.getByRole('link', { name: /بارگذاری ویدیو/ })).toHaveAttribute('href', '/studio/upload');
    await expect(tips.getByRole('link', { name: /مشاهده‌ی شورتس/ })).toHaveAttribute('href', '/shorts');
    await expectNoHorizontalScroll(page);
  });

  test('a channel without videos gets a first-upload call to action and honest zeros', async ({ page }) => {
    const empty = seedCreator('empty');
    await signIn(page, empty);
    await page.goto('/studio');

    const cta = page.getByTestId('first-upload');
    await expect(cta).toBeVisible();
    await expect(cta.getByRole('link', { name: /بارگذاری/ }).first()).toHaveAttribute('href', '/studio/upload');
    expect(await statValue(page, 'videos')).toBe(fa(0));
    expect(await statValue(page, 'followers')).toBe(fa(0));
    expect(await statValue(page, 'total-views')).toBe(fa(0));
    expect(await statValue(page, 'today-views')).toBe(fa(0));
    await expect(page.getByTestId('sample-footnote')).toHaveCount(0);
    await expect(page.getByTestId('recent-comments')).toContainText('هنوز دیدگاهی ثبت نشده است');

    // analytics has nothing to analyse yet and says so instead of drawing empty charts
    await page.goto('/studio/analytics');
    await expect(page.getByText('هنوز ویدیویی بارگذاری نکرده‌اید')).toBeVisible();
    await expect(page.getByTestId('analytics-chart')).toHaveCount(0);
  });

  test('quick approve publishes a pending comment through the moderation core', async ({ page }) => {
    const owner = seedCreator('approve', {
      fans: ['f1'],
      videos: [{ key: 'v1', title: TITLES.v1 }],
      comments: [{ video: 'v1', fan: 'f1', at: new Date().toISOString(), status: 'PENDING', body: PENDING_BODY }],
    });
    const commentId = owner.commentIds[0]!;
    expect(runFixture<{ status: string }>({ command: 'comment', id: commentId }).status).toBe('PENDING');

    await signIn(page, owner);
    await page.goto('/studio');
    await expect(page.getByTestId('pending-comments')).toContainText(`${fa(1)} دیدگاه در انتظار تأیید شما`);
    await page.getByRole('button', { name: /^تأیید دیدگاه/ }).click();

    await expect(page.getByText('دیدگاه تأیید و منتشر شد.')).toBeVisible();
    await expect(page.getByTestId('pending-comments')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-comment').filter({ hasText: PENDING_BODY })).not.toContainText('در انتظار تأیید');
    expect(runFixture<{ status: string }>({ command: 'comment', id: commentId }).status).toBe('APPROVED');
  });
});

/* ------------------------------------------------------------------------------------------- analytics */

test.describe('analytics /studio/analytics', () => {
  test('default 30 days: cards, chart table, breakdowns and per-video table equal the database', async ({ page }) => {
    await page.goto('/studio/analytics');

    const current = between(views, keyBack(29), keyBack(0));
    const previous = between(views, keyBack(59), keyBack(30));
    const now = summarize(current);
    const before = summarize(previous);
    expect(now.views).toBe(10); // sanity of the fixture itself: 3 today + 1 yesterday + 3 + 1 + 2 older

    expect(await statValue(page, 'views')).toBe(fa(now.views));
    expect(await statValue(page, 'unique')).toBe(fa(now.unique));
    expect(await statValue(page, 'watch-minutes')).toBe(fa(now.minutes));
    expect(await statValue(page, 'today')).toBe(fa(views.filter((v) => tehranKey(v.at) === todayKey()).length));
    expect(await statValue(page, 'followers')).toBe(fa(2));
    expect(await statValue(page, 'notify')).toBe(fa(1));
    expect(await statValue(page, 'month')).toBe(fa(between(views, monthStartKey(), todayKey()).length));
    // % change versus the 30 days before: 10 against 11 (5 real + 6 sample) = -9.1 %, drawn as a decrease (never colour only)
    const change = percentChange(now.views, before.views);
    expect(change).toBeLessThan(0);
    await expect(page.getByTestId('stat-views')).toContainText(faPercent(Math.abs(change)));
    await expect(page.getByTestId('stat-views')).toContainText('کاهش نسبت به بازه‌ی قبل');

    // the period line says which days are compared
    await expect(page.getByTestId('analytics-period')).toContainText('مقایسه با');

    // follower growth (channel level, REAL only in this range): 2 new, 1 lost
    await expect(page.getByTestId('growth-new')).toHaveText(fa(2));
    await expect(page.getByTestId('growth-lost')).toHaveText(fa(1));
    await expect(page.getByTestId('growth-net')).toContainText(fa(1));

    // text alternative of the chart: one row per Tehran day, oldest first, with the boundary events on the right days
    const rows = chartRows(page);
    await expect(rows).toHaveCount(31); // header + 30 days
    const viewsOn = async (daysBack: number) => (await rows.nth(1 + (29 - daysBack)).getByRole('cell').first().innerText()).trim();
    for (const daysBack of [0, 1, 2, 3, 4, 10, 20]) {
      expect(await viewsOn(daysBack), `day ${daysBack} days ago`).toBe(fa(between(views, keyBack(daysBack), keyBack(daysBack)).length));
    }
    expect(await viewsOn(3)).toBe(fa(3)); // includes the 00:01 event; a UTC-bucketed series would show 2
    expect(await viewsOn(1)).toBe(fa(1)); // the 23:59 event

    // breakdowns are text first (number and share), bars are decoration
    const devices = page.locator('[data-slot="card"]').filter({ hasText: 'بازدیدها بر اساس نوع دستگاه بیننده' });
    const mobile = views.filter((v) => v.device === 'MOBILE' && tehranKey(v.at) >= keyBack(29));
    await expect(devices).toContainText(`رایانه ${fa(current.length - mobile.length)}`);
    await expect(devices).toContainText(`موبایل ${fa(mobile.length)}`);

    // per-video table for the same range
    const row = (title: string) => page.getByTestId('video-row').filter({ hasText: title });
    for (const key of ['v1', 'v2', 'v3'] as const) {
      await expect(row(TITLES[key]).getByRole('cell').nth(1)).toHaveText(fa(between(views, keyBack(29), keyBack(0), key).length));
    }
    await expect(row(TITLES.v1).getByRole('link', { name: TITLES.v1 })).toHaveAttribute('href', new RegExp(`video=${main.videoIds.v1}`));
    await expectNoHorizontalScroll(page);
  });

  test('legend toggles hide series, the data table can be shown, and Jalali tick labels read right to left', async ({ page }) => {
    await page.goto('/studio/analytics');
    const chart = page.getByTestId('analytics-chart');
    await expect(chart.locator('svg.recharts-surface')).toBeVisible();

    const likes = page.getByRole('button', { name: /^پسند/ });
    await expect(likes).toHaveAttribute('aria-pressed', 'true');
    const lines = chart.locator('.recharts-line');
    const before = await lines.count();
    await likes.click();
    await expect(likes).toHaveAttribute('aria-pressed', 'false');
    await expect(lines).toHaveCount(before - 1);
    await likes.click();
    await expect(lines).toHaveCount(before);

    const toggle = page.getByRole('button', { name: 'نمایش جدول داده‌ها' });
    await toggle.click();
    await expect(page.getByRole('button', { name: 'پنهان‌کردن جدول داده‌ها' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('table', { name: /جدول داده‌های نمودار/ })).toBeVisible();

    // «۲۱ مهر»: the number must be drawn on the right of the month name
    const ticks = await page.evaluate(TICK_ORDER_PROBE);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.filter((t) => !t.numberIsOnTheRight), JSON.stringify(ticks)).toEqual([]);
  });

  test('range presets, custom Jalali range and monthly granularity change the numbers', async ({ page }) => {
    await page.goto('/studio/analytics');

    // ۷ روز اخیر
    await chooseRange(page, `${fa(7)} روز اخیر`);
    await expect(page).toHaveURL(/range=7d/);
    const week = summarize(between(views, keyBack(6), keyBack(0)));
    await expect.poll(() => statValue(page, 'views')).toBe(fa(week.views));
    expect(await statValue(page, 'unique')).toBe(fa(week.unique));
    await expect(chartRows(page)).toHaveCount(8);

    // ماه جاری شمسی and ماه قبل follow the Jalali calendar, not 30-day windows
    await chooseRange(page, 'ماه جاری شمسی');
    await expect(page).toHaveURL(/range=this-month/);
    await expect.poll(() => statValue(page, 'views')).toBe(fa(between(views, monthStartKey(), todayKey()).length));
    await expect(chartRows(page)).toHaveCount(1 + jalali(todayKey()).day);

    const last = previousMonth();
    await chooseRange(page, 'ماه قبل');
    await expect(page).toHaveURL(/range=last-month/);
    await expect.poll(() => statValue(page, 'views')).toBe(fa(between(views, last.from, last.to).length));

    // سفارشی: the first day of this Jalali month to today, picked in the Jalali calendar
    await chooseRange(page, 'سفارشی');
    const calendar = page.getByRole('dialog', { name: 'تقویم شمسی' });
    await page.getByRole('button', { name: 'تاریخ شروع' }).click();
    await calendar.getByRole('button', { name: new RegExp(`^${fa(1)} `) }).click();
    await expect(calendar).toHaveCount(0);
    await page.getByRole('button', { name: 'تاریخ پایان' }).click();
    await calendar.getByRole('button', { name: 'امروز' }).click(); // the "today" shortcut leaves the popover open
    await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0);
    await page.getByRole('button', { name: 'اعمال' }).click();
    await expect(page).toHaveURL(new RegExp(`range=custom&from=${monthStartKey()}&to=${todayKey()}`));
    await expect.poll(() => statValue(page, 'views')).toBe(fa(between(views, monthStartKey(), todayKey()).length));

    // ماهانه: one row per Jalali month touched by the range
    await page.goto('/studio/analytics?range=90d');
    await page.getByRole('radio', { name: 'ماهانه' }).click();
    await expect(page).toHaveURL(/granularity=month/);
    const months = new Set<string>();
    for (let back = 0; back < 90; back += 1) months.add(`${jalali(keyBack(back)).year}-${jalali(keyBack(back)).month}`);
    await expect(chartRows(page)).toHaveCount(1 + months.size);
    let total = 0;
    for (let i = 0; i < months.size; i += 1) total += digitsToNumber(await chartRows(page).nth(1 + i).getByRole('cell').first().innerText());
    expect(total).toBe(between(views, keyBack(89), keyBack(0)).length);
  });

  test('the sample-data notice appears only when synthetic rows are inside the range', async ({ page }) => {
    await page.goto('/studio/analytics'); // last 30 days: only REAL rows
    await expect(page.getByTestId('analytics-chart')).toBeVisible();
    await expect(page.getByTestId('seed-notice')).toHaveCount(0);

    await page.goto('/studio/analytics?range=90d'); // reaches back to the SEED rows 45 days ago
    const notice = page.getByTestId('seed-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('بخشی از داده‌های این بازه نمونهٔ آزمایشی است');
    const inRange = summarize(between(views, keyBack(89), keyBack(0)));
    await expect(notice).toContainText(`${fa(inRange.seed)} از ${fa(inRange.views)} بازدید`);
    await expect(page.getByTestId('growth-new')).toContainText(fa(4)); // 2 real + 2 sample new followers, flagged below
    await expect(page.getByText(/رویداد.*نمونه/).first()).toBeVisible();

    // a range that stops before them is clean again
    await page.goto('/studio/analytics?range=7d');
    await expect(page.getByTestId('analytics-chart')).toBeVisible();
    await expect(page.getByTestId('seed-notice')).toHaveCount(0);
  });

  test('?video= scopes everything to one video; foreign and malformed ids are 404', async ({ page }) => {
    const other = seedCreator('other', { videos: [{ key: 'x', title: 'ویدیوی یک کانال دیگر' }] });

    // arrive the way a creator does: from the dashboard's "آمار" shortcut
    await page.goto('/studio');
    await page.getByRole('link', { name: `آمار «${TITLES.v1}»` }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/analytics\\?video=${main.videoIds.v1}`));
    await expect(page.getByTestId('video-filter')).toContainText(TITLES.v1);

    const mine = summarize(between(views, keyBack(29), keyBack(0), 'v1'));
    expect(mine.views).toBe(4);
    expect(await statValue(page, 'views')).toBe(fa(mine.views));
    expect(await statValue(page, 'unique')).toBe(fa(mine.unique));
    await expect(page.getByTestId('stat-followers')).toHaveCount(0); // follower numbers are channel level
    await expect(page.getByTestId('growth-new')).toHaveCount(0);
    await page.getByRole('link', { name: 'نمایش کل کانال' }).click();
    await expect(page.getByTestId('video-filter')).toHaveCount(0);

    // Somebody else's video, an unknown id and a malformed one are indistinguishable: the not-found page, no data.
    // (The page streams behind loading.tsx, so Next answers 200 with the not-found UI; the API answers a real 404.)
    for (const id of [other.videoIds.x!, 'doesNotExi1', 'bad id!']) {
      await page.goto(`/studio/analytics?video=${encodeURIComponent(id)}`);
      await expect(page.getByRole('heading', { name: /پیدا نشد/ })).toBeVisible();
      await expect(page.getByText('ویدیوی یک کانال دیگر')).toHaveCount(0);
      await expect(page.getByTestId('video-filter')).toHaveCount(0);
    }
    const foreignCsv = await page.request.get(`/api/studio/analytics/export?video=${other.videoIds.x}`);
    expect(foreignCsv.status()).toBe(404);
    expect(await foreignCsv.text()).not.toContain('ویدیوی یک کانال دیگر');
  });

  test('CSV export downloads the exact per-day numbers (UTF-8 BOM, Tehran days)', async ({ page }) => {
    await page.goto('/studio/analytics');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'خروجی CSV روزانه' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^tamashagah-analytics-e2e-main-.*\.csv$/);

    const bytes = await fs.readFile((await download.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = bytes.toString('utf8').replace(String.fromCharCode(0xfeff), '').split('\r\n').filter(Boolean).map((line) => line.split(','));
    const header = rows[0]!;
    expect(header).toContain('بازدید');
    const days = rows.slice(1);
    expect(days).toHaveLength(30);

    const column = header.indexOf('بازدید');
    for (const daysBack of [0, 1, 3, 4]) {
      const row = days.find((r) => r[0] === keyBack(daysBack))!;
      expect(Number(row[column]), `CSV row ${keyBack(daysBack)}`).toBe(between(views, keyBack(daysBack), keyBack(daysBack)).length);
    }
    expect(days.reduce((sum, r) => sum + Number(r[column]), 0)).toBe(10);

    // per-video export of the same range
    const [videos] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'خروجی CSV ویدیوها' }).click()]);
    expect(videos.suggestedFilename()).toMatch(/-videos\.csv$/);
    const text = (await fs.readFile((await videos.path())!)).toString('utf8');
    expect(text).toContain(main.videoIds.v1);
    expect(text).toContain(TITLES.v1);
  });

  test('invalid ranges fall back to 30 days with a clear message; a quiet channel shows an empty chart', async ({ page }) => {
    const quiet = seedCreator('quiet', { videos: [{ key: 'v1', title: TITLES.v1 }] });
    await signIn(page, quiet);
    await page.goto('/studio/analytics?range=custom&from=2026-02-30&to=2026-03-01');
    await expect(page.getByText(`آمار ${fa(30)} روز اخیر نمایش داده می‌شود.`)).toBeVisible();
    await page.goto(`/studio/analytics?range=custom&from=${keyBack(1)}&to=${keyBack(5)}`);
    await expect(page.getByText(`آمار ${fa(30)} روز اخیر نمایش داده می‌شود.`)).toBeVisible();

    await page.goto('/studio/analytics');
    expect(await statValue(page, 'views')).toBe(fa(0));
    await expect(page.getByText('در این بازه رویدادی ثبت نشده است.')).toBeVisible();
    await expect(page.getByTestId('video-row')).toHaveCount(1);
    await expect(page.getByTestId('video-row').getByRole('cell').nth(1)).toHaveText(fa(0));
  });
});

/* -------------------------------------------------------------------------------------------- settings */

test.describe('settings /studio/settings', () => {
  const PNG = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#7c3aed' } }).png().toBuffer();

  test('avatar: rejects bad files, shows the new image in the header, replaces and removes it', async ({ page }) => {
    const owner = seedCreator('avatar');
    await signIn(page, owner);
    await page.goto('/studio/settings');
    const menuImage = page.getByRole('button', { name: 'منوی حساب کاربری' }).locator('img');
    const input = page.getByLabel('انتخاب تصویر نمایه');
    await expect(menuImage).toHaveCount(0); // initials until there is an image

    // not an image: the browser-side check
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'فقط تصویر JPG، PNG یا WebP پذیرفته می‌شود.' })).toBeVisible();
    // claims to be a PNG but is a script: only the server-side magic-byte check can catch this one
    await input.setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<?php system($_GET["c"]); ?> pretending to be a picture') });
    await expect(page.getByRole('alert').filter({ hasText: 'فقط تصویر' })).toBeVisible();
    await expect(menuImage).toHaveCount(0);
    expect(runFixture<{ avatarKey: string | null }>({ command: 'user', id: owner.userId }).avatarKey).toBeNull();

    // a real picture: stored as a 400x400 WebP and shown in the header after the refresh
    await input.setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await PNG() });
    await expect(page.getByText('تصویر ذخیره شد.').first()).toBeVisible();
    await expect(menuImage).toHaveAttribute('src', /\/media\//);
    const first = (await menuImage.getAttribute('src'))!;
    const stored = await page.request.get(first);
    expect(stored.status()).toBe(200);
    expect(stored.headers()['content-type']).toBe('image/webp');
    const meta = await sharp(await stored.body()).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([400, 400, 'webp']);

    // replace: the header follows, the old file is deleted from storage
    await input.setInputFiles({ name: 'me2.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 500, height: 500, channels: 3, background: '#0ea5e9' } }).png().toBuffer() });
    await expect(menuImage).not.toHaveAttribute('src', first);
    const second = (await menuImage.getAttribute('src'))!;
    expect(second).not.toBe(first);
    expect((await page.request.get(first)).status()).toBe(404);
    expect((await page.request.get(second)).status()).toBe(200);

    // remove: back to initials and the file is gone
    await page.getByRole('button', { name: 'حذف', exact: true }).first().click();
    await expect(page.getByText('تصویر حذف شد.').first()).toBeVisible();
    await expect(menuImage).toHaveCount(0);
    expect((await page.request.get(second)).status()).toBe(404);
    expect(runFixture<{ avatarKey: string | null }>({ command: 'user', id: owner.userId }).avatarKey).toBeNull();
  });

  test('channel tab: name, links and banner are saved and visible straight away', async ({ page }) => {
    const owner = seedCreator('channel');
    await signIn(page, owner);
    await page.goto('/studio/settings?tab=channel');
    await expect(page.getByRole('tab', { name: 'کانال' })).toHaveAttribute('aria-selected', 'true');

    // the handle cannot be changed, and the page says so
    await expect(page.getByLabel('شناسه‌ی کانال')).toHaveAttribute('readonly', '');
    await expect(page.getByText('تغییر شناسه‌ی کانال فعلاً پشتیبانی نمی‌شود.')).toBeVisible();

    const name = `کانال تازه ${unique()}`;
    await page.getByLabel('نام کانال', { exact: true }).fill(name);
    await page.getByLabel('توضیحات کانال').fill('درباره‌ی کانال: آموزش و تجربه.');
    await page.getByRole('button', { name: 'افزودن پیوند' }).click();
    await page.getByLabel('عنوان پیوند ۱').fill('وب‌سایت');
    await page.getByLabel('نشانی پیوند ۱').fill('http://insecure.example');
    await page.getByRole('button', { name: 'ذخیره‌ی اطلاعات کانال' }).click();
    await expect(page.getByText(/https/).filter({ hasText: /باید|معتبر|امن/ }).first()).toBeVisible(); // only https links are accepted

    await page.getByLabel('نشانی پیوند ۱').fill('https://example.com/me');
    await page.getByRole('button', { name: 'ذخیره‌ی اطلاعات کانال' }).click();
    await expect(page.getByText('اطلاعات کانال ذخیره شد.').first()).toBeVisible();

    await openAccountMenu(page);
    await expect(page.getByRole('menu').getByText(name)).toBeVisible(); // header menu follows without a manual reload
    await page.keyboard.press('Escape');

    // banner upload shows a preview and the public channel page serves it
    await page.getByLabel('انتخاب بنر کانال').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 1600, height: 400, channels: 3, background: '#f59e0b' } }).png().toBuffer() });
    const preview = page.getByTestId('banner-preview');
    await expect(preview).toHaveAttribute('src', /\/media\//);
    const banner = await page.request.get((await preview.getAttribute('src'))!);
    expect(banner.status()).toBe(200);
    const meta = await sharp(await banner.body()).metadata();
    expect([meta.width, meta.height]).toEqual([1920, 480]);

    // what the public pages read from the database: the new name (and its search form), the https link, the banner key
    const stored = runFixture<{ name: string; description: string; links: { title: string; url: string }[]; searchName: string; bannerKey: string | null }>({
      command: 'channel',
      id: owner.channelId,
    });
    expect(stored).toMatchObject({ name, description: 'درباره‌ی کانال: آموزش و تجربه.', links: [{ title: 'وب‌سایت', url: 'https://example.com/me' }] });
    expect(stored.searchName).toContain(name); // normalised name and handle, so the channel is found by its new name
    expect(stored.bannerKey).toBeTruthy();
  });

  test('account tab: display name and numerals apply everywhere; a new password signs the other device out', async ({ page, browser, baseURL }) => {
    const owner = seedCreator('account', { videos: [{ key: 'v1', title: TITLES.v1 }] });
    await signIn(page, owner);
    const other = await browser.newContext({ baseURL, locale: 'fa-IR', timezoneId: 'Asia/Tehran', storageState: SIGNED_OUT });
    const otherPage = await other.newPage();
    await signIn(otherPage, owner);
    await otherPage.goto('/studio');
    await expect(otherPage).toHaveURL(/\/studio$/);

    await page.goto('/studio/settings');
    const name = `نام تازه ${unique()}`;
    await page.getByLabel('نام نمایشی').fill(name);
    await page.getByRole('radio', { name: 'انگلیسی (123)' }).click();
    await page.getByRole('button', { name: 'ذخیره‌ی تغییرات' }).click();
    await expect(page.getByRole('button', { name: 'ذخیره‌ی تغییرات' })).toBeDisabled(); // saved: the form is clean again

    expect(runFixture<{ displayName: string; digitStyle: string }>({ command: 'user', id: owner.userId })).toMatchObject({ displayName: name, digitStyle: 'EN' });
    await page.goto('/studio');
    await expect.poll(() => statValue(page, 'videos')).toBe('1'); // Western digits everywhere after the preference changed
    await page.goto('/studio/settings');
    await expect(page.getByLabel('نام نمایشی')).toHaveValue(name);

    // change the password: the other device is signed out, this one stays
    await page.goto('/studio/settings');
    const next = `${E2E_PASSWORD}-new`;
    await page.getByLabel('گذرواژه‌ی فعلی').fill(owner.password);
    await page.getByLabel('گذرواژه‌ی جدید', { exact: true }).fill(next);
    await page.getByLabel('تکرار گذرواژه‌ی جدید').fill(next);
    await page.getByRole('button', { name: 'تغییر گذرواژه' }).click();
    await expect(page.getByText('گذرواژه تغییر کرد. از سایر دستگاه‌ها خارج شدید.').first()).toBeVisible();
    await page.goto('/studio');
    await expect(page).toHaveURL(/\/studio$/);
    await otherPage.goto('/studio');
    await expect(otherPage).toHaveURL(/\/login/);
    await other.close();
  });

  test('sessions: revoking one device logs exactly that device out; "log out everywhere" logs out all', async ({ page, browser, baseURL }) => {
    const owner = seedCreator('sessions');
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const context = (userAgent?: string) => browser.newContext({ baseURL, locale: 'fa-IR', timezoneId: 'Asia/Tehran', userAgent, storageState: SIGNED_OUT });
    const phone = await context(iphone);
    const tablet = await context();
    const phonePage = await phone.newPage();
    const tabletPage = await tablet.newPage();

    await signIn(page, owner);
    await signIn(phonePage, owner);
    await signIn(tabletPage, owner);

    await page.goto('/studio/settings');
    const rows = page.getByTestId('session-row');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('[data-testid="session-row"][data-current="true"]')).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Safari روی آیفون' })).toHaveCount(1);

    // revoke the phone only
    await page.getByRole('button', { name: 'خروج دستگاه Safari روی آیفون' }).click();
    await expect(rows).toHaveCount(2);
    await phonePage.goto('/studio');
    await expect(phonePage).toHaveURL(/\/login/);
    await tabletPage.goto('/studio');
    await expect(tabletPage).toHaveURL(/\/studio$/);

    // everywhere, this device included
    await page.getByRole('button', { name: 'خروج از همه‌ی دستگاه‌ها' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'خروج از همه' }).click();
    await expect(page).toHaveURL(/\/login/);
    await tabletPage.goto('/studio');
    await expect(tabletPage).toHaveURL(/\/login/);
    await phone.close();
    await tablet.close();
  });

  test('users without a channel get the account tab only', async ({ page }) => {
    const email = `${E2E_EMAIL_PREFIX}plain-${unique()}@example.test`;
    const plain = runFixture<{ userId: string }>({ command: 'plainUser', email, password: E2E_PASSWORD });
    created.push(plain.userId);
    await page.context().clearCookies();
    await loginViaUi(page, email, E2E_PASSWORD);
    await page.goto('/studio/settings?tab=channel');
    await expect(page.getByRole('tab', { name: 'حساب کاربری' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'کانال' })).toHaveCount(0);
    await expect(page.getByText('هنوز کانال ندارید')).toBeVisible();
    // the account menu of a channel-less user shows the display name, which follows an edit straight away
    const renamed = `نام ساده ${unique()}`;
    await page.getByLabel('نام نمایشی').fill(renamed);
    await page.getByRole('button', { name: 'ذخیره‌ی تغییرات' }).click();
    await expect(page.getByRole('button', { name: 'ذخیره‌ی تغییرات' })).toBeDisabled();
    await openAccountMenu(page);
    await expect(page.getByRole('menu').getByText(renamed)).toBeVisible();
    await page.keyboard.press('Escape');
    // the upload endpoints of a channel are closed to them, whatever the UI shows
    const response = await page.request.post('/api/studio/channel/banner', { multipart: { file: { name: 'b.png', mimeType: 'image/png', buffer: await PNG() } }, headers: { origin: new URL(page.url()).origin } });
    expect(response.status()).toBe(403);
  });
});

/* --------------------------------------------------------------------------------------- monetization */

test.describe('monetization /studio/monetization', () => {
  const ELIGIBLE = {
    followerCount: 1_000,
    videos: ['m1', 'm2', 'm3', 'm4', 'm5'].map((key, i) => ({ key, title: `ویدیوی عمومی ${i + 1}` })),
    // 2000 real views x 910 s = 505.55 watch hours inside the last 365 days (the page rounds DOWN: never overstates)
    bulkViews: [{ video: 'm1', count: 2_000, watch: 910, spreadDays: 300 }],
  };

  test('not eligible: progress and what is missing are shown, sending is closed, and revenue is an honest empty state', async ({ page }) => {
    const owner = seedCreator('mon-new', { videos: [{ key: 'a', title: 'تنها ویدیو' }] });
    await signIn(page, owner);
    await page.goto('/studio/monetization');

    await expect(page.getByTestId('not-eligible-banner')).toBeVisible();
    for (const key of ['followers', 'watchHours', 'publicVideos']) await expect(page.getByTestId(`requirement-${key}`)).toHaveAttribute('data-met', 'false');
    await expect(page.getByTestId('requirement-followers')).toContainText(`${fa(0)} از ${fa(1000)} دنبال‌کننده`);
    await expect(page.getByTestId('requirement-publicVideos')).toContainText(`${fa(4)} ویدیوی عمومی دیگر لازم است`);
    await expect(page.getByTestId('submit-application')).toBeDisabled();

    // the revenue section never invents money
    const revenue = page.getByTestId('revenue');
    await expect(revenue).toContainText('درآمدی ثبت نشده است — اتصال به سرویس پرداخت هنوز انجام نشده');
    expect(await page.locator('main, body').first().innerText()).not.toMatch(/\d+\s*(تومان|ریال)|[۰-۹]+\s*(تومان|ریال)|\$/);

    // the 12-month history is real data: one row per Jalali month
    await expect(page.getByTestId('history-row')).toHaveCount(12);
  });

  test('synthetic (SEED) events never make a channel eligible', async ({ page }) => {
    const owner = seedCreator('mon-seed', { ...ELIGIBLE, bulkViews: [{ ...ELIGIBLE.bulkViews[0]!, source: 'SEED' }] });
    await signIn(page, owner);
    await page.goto('/studio/monetization');
    await expect(page.getByTestId('requirement-followers')).toHaveAttribute('data-met', 'true');
    await expect(page.getByTestId('requirement-publicVideos')).toHaveAttribute('data-met', 'true');
    await expect(page.getByTestId('requirement-watchHours')).toHaveAttribute('data-met', 'false'); // 0 real hours
    await expect(page.getByTestId('not-eligible-banner')).toBeVisible();
    await expect(page.getByTestId('sample-excluded')).toContainText('به‌هیچ‌وجه لحاظ نشده است');
    await expect(page.getByTestId('submit-application')).toBeDisabled();
  });

  test('eligible: submit with a snapshot, withdraw, resubmit, then a reviewer decision shows with its note', async ({ page }) => {
    const owner = seedCreator('mon-ok', ELIGIBLE);
    const rows = () => runFixture<ApplicationRow[]>({ command: 'application', channelId: owner.channelId });
    await signIn(page, owner);
    await page.goto('/studio/monetization');

    await expect(page.getByTestId('eligible-banner')).toBeVisible();
    for (const key of ['followers', 'watchHours', 'publicVideos']) await expect(page.getByTestId(`requirement-${key}`)).toHaveAttribute('data-met', 'true');
    await expect(page.getByTestId('requirement-watchHours')).toContainText(`${fa(505.5, { maximumFractionDigits: 1 })} از ${fa(500)} ساعت`);

    // the terms are required
    await page.getByLabel('ایمیل تماس').fill('creator@example.test');
    await page.getByTestId('submit-application').click();
    await expect(page.getByText('برای ارسال درخواست باید شرایط برنامه‌ی درآمدزایی را بپذیرید.').first()).toBeVisible();
    expect(rows()).toHaveLength(0);

    await page.getByRole('checkbox').check();
    await page.getByTestId('submit-application').click();
    await expect(page.getByTestId('application-status-badge')).toHaveText('ارسال شده');
    const snapshot = page.getByTestId('snapshot');
    await expect(snapshot).toContainText(fa(1000));
    await expect(snapshot).toContainText('creator@example.test');
    const [submitted] = rows();
    expect(submitted).toMatchObject({ status: 'SUBMITTED', contactEmail: 'creator@example.test' });
    expect(submitted!.statsSnapshot).toMatchObject({ followers: 1000, videoCount: 5 });
    expect(submitted!.statsSnapshot!.watchHours).toBeCloseTo(505.56, 1);

    // withdrawing returns it to an editable draft (no review had started)
    await page.getByTestId('withdraw-application').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'انصراف از درخواست' }).click();
    await expect(page.getByText('پیش‌نویس شما ذخیره شده است')).toBeVisible();
    await expect(page.getByTestId('application-status')).toHaveCount(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: 'DRAFT', statsSnapshot: null });

    // send it again
    await page.getByTestId('submit-application').click();
    await expect(page.getByTestId('application-status-badge')).toHaveText('ارسال شده');
    expect(rows()).toHaveLength(1); // still one application: a channel never has two active ones

    // the admin panel decides (conditional update); the creator only reads the decision
    runFixture({ command: 'decide', channelId: owner.channelId, status: 'APPROVED', note: 'شرایط کانال بررسی و تأیید شد؛ موفق باشید.' });
    await page.reload();
    await expect(page.getByTestId('application-status-badge')).toHaveText('تأیید شده');
    await expect(page.getByTestId('decision-note')).toContainText('شرایط کانال بررسی و تأیید شد؛ موفق باشید.');
    await expect(page.getByText('تأیید به‌معنای پرداخت نیست')).toBeVisible();
    await expect(page.getByTestId('withdraw-application')).toHaveCount(0); // decided applications cannot be withdrawn
    await expect(page.getByTestId('submit-application')).toHaveCount(0); // and no second application can be opened
    await expect(page.getByTestId('revenue')).toContainText('درآمدی ثبت نشده است — اتصال به سرویس پرداخت هنوز انجام نشده');
  });
});

/* ----------------------------------------------------------------------------------------- accessibility */

test.describe('accessibility of the studio pages (axe, WCAG 2 A/AA)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const route of ['/studio', '/studio/analytics', '/studio/analytics?range=90d', '/studio/settings', '/studio/settings?tab=channel', '/studio/monetization']) {
      test(`${route} (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(
          results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })),
        ).toEqual([]);
      });
    }
  }
});
