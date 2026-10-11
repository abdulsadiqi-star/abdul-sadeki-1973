/**
 * Media journey in a real browser: upload → progress → processing → ready → edit → delete, pause / resume,
 * resuming after a page reload, and "somebody else's video is not yours".
 *
 * Needs the full stack (app + worker + Postgres + Redis + ffmpeg, see docs/testing.md). The creators are inserted
 * straight into the database (registration is rate limited to 5 per hour per address) and sign in through the real
 * login form.
 */
import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { hashPassword } from '@/lib/auth/password';
import { db } from '@/lib/db';
import { newVideoId } from '@/lib/ids';
import { buildChannelSearchName } from '@/lib/persian';
import { generateFixture } from '../../scripts/make-test-video.mjs';
import { E2E_PASSWORD, loginViaUi } from './helpers';

const FIXTURE_DIR = path.join(os.tmpdir(), 'tg-e2e-fixtures');
const READY_TIMEOUT = 150_000;

async function createCreator(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${label}-${suffix}@example.test`;
  const handle = `${label}-${suffix}`;
  const user = await db.user.create({
    data: {
      email,
      displayName: 'سازنده‌ی آزمایشی',
      role: 'CREATOR',
      passwordHash: await hashPassword(E2E_PASSWORD),
      emailVerifiedAt: new Date(),
    },
  });
  await db.channel.create({ data: { ownerId: user.id, handle, name: 'کانال آزمایشی', searchName: buildChannelSearchName('کانال آزمایشی', handle) } });
  return { email, handle, userId: user.id };
}

test.afterAll(async () => {
  await db.$disconnect();
});

const cardFor = (page: Page, name: string): Locator => page.getByTestId('upload-card').filter({ hasText: name });
const videoIdOf = async (card: Locator) => {
  const href = await card.getByRole('link', { name: 'ویرایش کامل' }).getAttribute('href');
  return /\/studio\/videos\/([0-9A-Za-z]{11})\/edit/.exec(href ?? '')![1]!;
};
const percentOf = async (card: Locator) => Number(await card.getByRole('progressbar').first().getAttribute('aria-valuenow'));

/** Limit the upload bandwidth of the page (bytes per second) so a 20 MB file takes long enough to interact with. */
async function throttleUpload(page: Page, bytesPerSecond: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: bytesPerSecond });
}

test.describe('media: upload, process, edit, delete', () => {
  test('a creator uploads a video, watches it get processed, edits it and deletes it', async ({ page }) => {
    const creator = await createCreator('media');
    await loginViaUi(page, creator.email);
    const file = await generateFixture('landscape-720p', { dir: FIXTURE_DIR, seconds: 3 });
    const fileName = path.basename(file);

    // --- upload --------------------------------------------------------------------------------------------------
    await page.goto('/studio/upload');
    await expect(page.getByRole('heading', { name: 'ویدیوهای خود را اینجا بکشید و رها کنید' })).toBeVisible();
    await page.getByTestId('upload-input').setInputFiles(file);
    const card = cardFor(page, fileName);
    await expect(card).toBeVisible();

    // metadata can be filled in and saved while the file is still being sent / processed
    const title = `ویدیوی آزمایشی ${Date.now().toString(36)}`;
    await card.getByLabel('عنوان ویدیو').fill(title);
    await card.getByLabel('توضیحات').fill('این ویدیو در آزمون مرورگر بارگذاری شد.');
    const save = card.getByRole('button', { name: 'ذخیره‌ی اطلاعات' });
    await expect(save).toBeEnabled({ timeout: 20_000 }); // enabled as soon as the server created the upload
    await save.click();
    await expect(page.getByText('تغییرات ذخیره شد.').first()).toBeVisible();

    // --- processing → ready --------------------------------------------------------------------------------------
    await expect(card).toHaveAttribute('data-phase', /^(processing|ready)$/, { timeout: 60_000 });
    await expect(card).toHaveAttribute('data-phase', 'ready', { timeout: READY_TIMEOUT });
    await expect(card.getByText('ویدیو آماده است')).toBeVisible();
    const id = await videoIdOf(card);

    // the HLS output is served from /media with the right types
    const master = await page.request.get(`/media/videos/${id}/hls/master.m3u8`);
    expect(master.status()).toBe(200);
    expect(master.headers()['content-type']).toContain('mpegurl');
    const masterText = await master.text();
    expect(masterText).toContain('#EXT-X-STREAM-INF');
    const variant = masterText.split('\n').find((line) => line.endsWith('.m3u8'))!;
    const variantRes = await page.request.get(`/media/videos/${id}/hls/${variant}`);
    expect(variantRes.status()).toBe(200);
    const segment = (await variantRes.text()).split('\n').find((line) => line.endsWith('.ts'))!;
    const segmentRes = await page.request.get(`/media/videos/${id}/hls/${variant.replace('index.m3u8', '')}${segment}`);
    expect(segmentRes.status()).toBe(200);
    expect(segmentRes.headers()['content-type']).toBe('video/mp2t');

    // --- the video list -----------------------------------------------------------------------------------------
    await page.goto('/studio/videos');
    const listed = page.getByTestId('video-card').filter({ hasText: title });
    await expect(listed).toBeVisible();
    await expect(listed.getByText('منتشر شده', { exact: true })).toBeVisible();

    // --- edit ---------------------------------------------------------------------------------------------------
    await listed.getByRole('link', { name: /^ویرایش/ }).first().click();
    await expect(page.getByRole('heading', { name: 'ویرایش ویدیو' })).toBeVisible();
    await expect(page.getByLabel('عنوان ویدیو')).toHaveValue(title);
    await page.getByLabel('عنوان ویدیو').fill(`${title} (ویرایش‌شده)`);
    await page.getByRole('radio', { name: /فقط با لینک/ }).click();
    await page.getByRole('button', { name: 'ذخیره‌ی تغییرات' }).click();
    await expect(page.getByText('تغییرات ذخیره شد.').first()).toBeVisible();

    // a different generated frame as the poster
    await page.getByTestId('thumbnail-option').nth(1).click();
    await expect(page.getByText('تصویر بندانگشتی تغییر کرد.').first()).toBeVisible();

    // subtitles
    await page.getByTestId('subtitle-input').setInputFiles({
      name: 'fa.vtt',
      mimeType: 'text/vtt',
      buffer: Buffer.from('WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nسلام\n'),
    });
    await page.getByRole('button', { name: 'افزودن زیرنویس' }).click();
    await expect(page.getByTestId('subtitle-item')).toHaveCount(1);

    // --- delete -------------------------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'حذف ویدیو' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'حذف برای همیشه' }).click();
    await expect(page).toHaveURL(/\/studio\/videos$/);
    await expect(page.getByTestId('video-card').filter({ hasText: title })).toHaveCount(0);
    expect((await page.request.get(`/media/videos/${id}/hls/master.m3u8`)).status()).toBe(404);
    await db.channel.delete({ where: { handle: creator.handle } }).catch(() => undefined);
  });

  test('uploads can be paused and resumed, and continue after the page was reloaded', async ({ page }) => {
    test.setTimeout(240_000);
    const creator = await createCreator('resume');
    await loginViaUi(page, creator.email);
    const file = await generateFixture('large-1080p', { dir: FIXTURE_DIR });
    const fileName = path.basename(file);
    page.on('dialog', (dialog) => void dialog.accept()); // "leave this page?" while an upload runs

    await page.goto('/studio/upload');
    await throttleUpload(page, 1.5 * 1024 * 1024);
    await page.getByTestId('upload-input').setInputFiles(file);
    const card = cardFor(page, fileName);
    await expect(card).toHaveAttribute('data-phase', 'uploading');

    // progress, speed and ETA are shown while sending
    await expect.poll(() => percentOf(card), { timeout: 60_000 }).toBeGreaterThan(5);
    await expect(card.getByTestId('upload-percent')).toContainText('٪');
    await expect(card.getByText(/در ثانیه/)).toBeVisible();

    // pause: nothing more is sent
    await card.getByRole('button', { name: 'توقف موقت بارگذاری' }).click();
    await expect(card).toHaveAttribute('data-phase', 'paused');
    const pausedAt = await percentOf(card);
    await page.waitForTimeout(2_500);
    expect(await percentOf(card)).toBe(pausedAt);

    // resume: it continues and moves on
    await card.getByRole('button', { name: 'ادامه‌ی بارگذاری' }).click();
    await expect(card).toHaveAttribute('data-phase', 'uploading');
    await expect.poll(() => percentOf(card), { timeout: 60_000 }).toBeGreaterThan(pausedAt);

    // reload in the middle of the upload: the server kept what it got
    await expect.poll(() => percentOf(card), { timeout: 60_000 }).toBeGreaterThan(30);
    await page.reload();
    await expect(page.getByTestId('upload-card')).toHaveCount(0);
    const pending = page.getByTestId('pending-upload');
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText(fileName);

    // picking the same file again continues from the server's offset
    await page.getByTestId('pending-input').setInputFiles(file);
    const resumed = cardFor(page, fileName);
    await expect(resumed).toContainText('ادامه‌ی بارگذاری قبلی');
    await expect.poll(() => percentOf(resumed), { timeout: 30_000 }).toBeGreaterThan(20);
    await expect(resumed).toHaveAttribute('data-phase', /^(finishing|processing|ready)$/, { timeout: 150_000 });
    await expect(resumed).toHaveAttribute('data-phase', 'ready', { timeout: READY_TIMEOUT });

    await db.channel.delete({ where: { handle: creator.handle } }).catch(() => undefined);
  });

  test('another creator can neither see nor touch your video', async ({ browser, page }) => {
    const owner = await createCreator('owner');
    const intruder = await createCreator('intruder');
    const ownerVideo = await db.video.create({
      data: { id: newVideoId(), channelId: (await db.channel.findUniqueOrThrow({ where: { handle: owner.handle } })).id, title: 'ویدیوی خصوصی من', visibility: 'PRIVATE', processingStatus: 'AWAITING_UPLOAD', sourceSizeBytes: 1000n },
    });

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const otherPage = await other.newPage();
    await loginViaUi(otherPage, intruder.email);

    // pages
    const edit = await otherPage.goto(`/studio/videos/${ownerVideo.id}/edit`);
    expect(edit?.status()).toBe(404);
    // the upload endpoint and the status endpoint answer exactly like for an id that does not exist
    const head = await otherPage.request.fetch(`/api/upload/${ownerVideo.id}`, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
    expect(head.status()).toBe(404);
    const status = await otherPage.request.get(`/api/studio/videos/${ownerVideo.id}/status`);
    expect(status.status()).toBe(404);
    // the owner's list does not leak into the intruder's studio
    await otherPage.goto('/studio/videos');
    await expect(otherPage.getByText('ویدیوی خصوصی من')).toHaveCount(0);

    // anonymous visitors are turned away from the upload endpoint
    const anonymous = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const anon = await anonymous.request.fetch(`/api/upload/${ownerVideo.id}`, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
    expect(anon.status()).toBe(401);

    await other.close();
    await anonymous.close();
    await page.close();
    await db.video.delete({ where: { id: ownerVideo.id } });
    await db.channel.deleteMany({ where: { handle: { in: [owner.handle, intruder.handle] } } }).catch(() => undefined);
  });
});
