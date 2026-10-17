/**
 * The watch experience end to end: real HLS playback in Chromium (play, seek, speed, quality, captions, fullscreen,
 * resume), honest view counting, hidden videos, and the signed-in journey — like, follow, save, report, comment
 * (held for approval), the creator approving and answering from /studio/comments, and the notifications.
 *
 * Fixtures: two real accounts (a creator with a channel, a viewer) are registered through the UI and a handful of
 * short VP9/Opus HLS videos are generated on the creator's channel by `scripts/watch-fixture.ts` (needs ffmpeg and
 * the database of the app under test). They are created once per project (desktop / mobile) and shared by the tests.
 */
import { test as base, expect, type Browser, type Locator, type Page, type WorkerInfo } from '@playwright/test';
import { playerLabels } from '@/components/player/labels';
import {
  BROWSER_UA,
  createFixtureVideo,
  createVerifiedUser,
  newActorPage,
  submitLoginForm,
  type Actor,
  type FixtureVideo,
} from './watch-helpers';

type World = {
  creator: Actor & { handle: string; channelName: string };
  viewer: Actor;
  videos: { player: FixtureVideo; views: FixtureVideo; journey: FixtureVideo; hidden: FixtureVideo };
};

const JOURNEY_DESCRIPTION = 'دستور کامل را این‌جا ببینید: https://example.com/recipe?id=12 و اگر خوشتان آمد #آشپزی را دنبال کنید.';

async function buildWorld(browser: Browser, info: WorkerInfo): Promise<World> {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const handle = `w${tag}`;
  const channelName = 'کانال آزمایشی تماشا';
  const creator = await createVerifiedUser(browser, info, { name: 'سازنده‌ی آزمایشی', prefix: 'creator', channel: { name: channelName, handle } });
  const viewer = await createVerifiedUser(browser, info, { name: 'بیننده‌ی آزمایشی', prefix: 'viewer' });

  // The first call also puts the channel in approval mode (the comment journey relies on it).
  const player = await createFixtureVideo(handle, ['--title=ویدیوی آزمایشی پخش‌کننده', '--comments-mode=APPROVAL_REQUIRED']);
  const [views, journey, hidden] = await Promise.all([
    createFixtureVideo(handle, ['--title=ویدیوی آزمایشی بازدید']),
    createFixtureVideo(handle, ['--title=ویدیوی آزمایشی تعامل', `--description=${JOURNEY_DESCRIPTION}`, '--tags=آشپزی,آزمایش']),
    createFixtureVideo(handle, ['--title=ویدیوی آزمایشی خصوصی', '--visibility=PRIVATE']),
  ]);
  return { creator: { ...creator, handle, channelName }, viewer, videos: { player, views, journey, hidden } };
}

const test = base.extend<{ asCreator: Page }, { world: World }>({
  world: [
    // (Playwright's fixture callback is called `provide` here: the name `use` trips react-hooks/rules-of-hooks.)
    async ({ browser }, provide, workerInfo) => {
      await provide(await buildWorld(browser, workerInfo));
    },
    { scope: 'worker', timeout: 360_000 },
  ],
  asCreator: async ({ browser, world }, provide, testInfo) => {
    const { context, page } = await newActorPage(browser, testInfo, world.creator.state);
    await provide(page);
    await context.close();
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const faNumber = (n: number) => n.toLocaleString('fa-IR');

const playerOf = (page: Page) => page.getByRole('group', { name: playerLabels.region });
const videoOf = (player: Locator) => player.locator('video');
const timeOf = (player: Locator) => videoOf(player).evaluate((v: HTMLVideoElement) => v.currentTime);

/** Open the watch page and wait until the player has loaded the manifest. */
async function openWatch(page: Page, id: string, query = ''): Promise<Locator> {
  await page.goto(`/watch/${id}${query}`);
  const player = playerOf(page);
  await expect(player).toHaveAttribute('data-player-state', 'ready', { timeout: 20_000 });
  return player;
}

/** Make sure the video is playing (autoplay may or may not have been allowed) and has really advanced. */
async function startPlayback(player: Locator) {
  if ((await player.getAttribute('data-playing')) !== 'true') {
    await player.getByRole('button', { name: playerLabels.play, exact: true }).first().click({ timeout: 5_000 }).catch(() => undefined);
  }
  await expect(player).toHaveAttribute('data-playing', 'true');
  await expect.poll(() => timeOf(player), { timeout: 20_000 }).toBeGreaterThan(0.4);
}

async function pausePlayback(page: Page, player: Locator) {
  if ((await player.getAttribute('data-playing')) === 'true') {
    await player.focus();
    await page.keyboard.press('k');
  }
  await expect(player).toHaveAttribute('data-playing', 'false');
}

/** Bring the (auto-hiding) control bar back and open the settings menu. */
async function openSettings(player: Locator): Promise<Locator> {
  await player.hover();
  await player.getByRole('button', { name: playerLabels.settings }).click();
  const menu = player.getByRole('menu', { name: playerLabels.settings });
  await expect(menu).toBeVisible();
  return menu;
}

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function viewResponse(page: Page, id: string) {
  return page.waitForResponse((r) => r.url().endsWith(`/api/videos/${id}/view`) && r.request().method() === 'POST', { timeout: 30_000 });
}

// ---------------------------------------------------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------------------------------------------------

test.describe('watch page', () => {
  test('renders the video page: RTL layout, metadata, JSON-LD and a safe linkified description', async ({ page, world }) => {
    const video = world.videos.journey;
    const response = await page.goto(`/watch/${video.id}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(video.title);
    await expect(page).toHaveTitle(new RegExp(escapeRegExp(video.title)));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // structured data for search engines
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}');
    expect(ld['@type']).toBe('VideoObject');
    expect(ld.name).toBe(video.title);
    expect(ld.duration).toMatch(/^PT/);
    expect(ld.contentUrl ?? ld.embedUrl ?? ld.url).toBeTruthy();

    // description: URLs and hashtags become safe links, nothing else is interpreted
    const link = page.getByRole('link', { name: 'https://example.com/recipe?id=12' });
    await expect(link).toHaveAttribute('href', 'https://example.com/recipe?id=12');
    await expect(link).toHaveAttribute('rel', /nofollow/);
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(page.getByRole('link', { name: '#آشپزی' }).first()).toHaveAttribute('href', /\/search\?q=/);

    // channel row + action bar + comments + related column all render without a "coming soon" placeholder
    await expect(page.getByRole('link', { name: world.creator.channelName }).first()).toBeVisible();
    await expect(page.getByRole('toolbar', { name: /اقدام/ })).toBeVisible();
    await expect(page.locator('#comments-heading')).toBeVisible();
    await expect(page.getByText(/به‌زودی|بزودی/)).toHaveCount(0);

    const viewport = page.viewportSize()!;
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    if (viewport.width >= 1024) {
      // RTL: the main column sits on the right, the related videos on the left
      const main = (await playerOf(page).boundingBox())!;
      const aside = (await page.locator('aside[aria-labelledby="related-heading"]').boundingBox())!;
      expect(main.x).toBeGreaterThan(aside.x);
    } else {
      // phones and tablets: the player is pinned under the header so it stays visible while reading and commenting
      const box = (await playerOf(page).boundingBox())!;
      expect(box.width).toBeGreaterThan(viewport.width - 4);
      await page.evaluate(() => window.scrollTo(0, 320)); // (it stays pinned while its own column is on screen)
      await expect.poll(async () => (await playerOf(page).boundingBox())!.y).toBeLessThan(140);
      expect((await playerOf(page).boundingBox())!.y).toBeGreaterThanOrEqual(0);
    }
  });

  test('hidden videos are a plain 404 on the page and on the view, heartbeat and comment endpoints', async ({ page, request, browser, world }, testInfo) => {
    const id = world.videos.hidden.id;
    const origin = new URL(testInfo.project.use.baseURL ?? 'http://localhost:3100').origin;
    const headers = { Origin: origin, 'User-Agent': BROWSER_UA };

    // a visitor: the real HTTP status is 404 and the page looks like any other missing page
    const response = await page.goto(`/watch/${id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /پیدا نشد/ })).toBeVisible();
    await expect(playerOf(page)).toHaveCount(0);

    // an unknown id behaves exactly the same (nothing leaks about what exists)
    expect((await page.goto('/watch/AAAAAAAAAAA'))?.status()).toBe(404);
    expect((await page.goto('/watch/not-a-video'))?.status()).toBe(404);

    const attempts = async (api: Page['request']) => {
      const view = await api.post(`/api/videos/${id}/view`, { headers, data: { played: 12, position: 12 } });
      const beat = await api.post(`/api/videos/${id}/heartbeat`, { headers, data: { delta: 10, position: 12 } });
      const comments = await api.get(`/api/comments?videoId=${id}`, { headers });
      return [view.status(), beat.status(), comments.status()];
    };
    expect(await attempts(request)).toEqual([404, 404, 404]);

    // a signed-in stranger gets the same answers
    const stranger = await newActorPage(browser, testInfo, world.viewer.state);
    try {
      expect((await stranger.page.goto(`/watch/${id}`))?.status()).toBe(404);
      expect(await attempts(stranger.page.request)).toEqual([404, 404, 404]);
    } finally {
      await stranger.context.close();
    }
  });

  test('the owner can still open a private video and is told who can see it', async ({ asCreator, world }) => {
    const response = await asCreator.goto(`/watch/${world.videos.hidden.id}`);
    expect(response?.status()).toBe(200);
    await expect(playerOf(asCreator)).toBeVisible();
    await expect(asCreator.getByText(/خصوصی است و فقط/)).toBeVisible();
    await expect(asCreator.getByRole('link', { name: /ویرایش در استودیو/ })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// the player
// ---------------------------------------------------------------------------------------------------------------------

test.describe('player', () => {
  test('plays, seeks with the mouse and the keyboard (RTL) and changes the speed', async ({ page, world }) => {
    const video = world.videos.player;
    const player = await openWatch(page, video.id);
    await startPlayback(player);

    // Mouse: the bar fills from the RIGHT, so a click near its LEFT end is late in the video.
    await player.hover();
    const slider = player.getByRole('slider', { name: playerLabels.seek });
    await expect(slider).toHaveAttribute('aria-valuemax', String(video.durationSeconds));
    const box = (await slider.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
    await expect.poll(() => timeOf(player)).toBeGreaterThan(video.durationSeconds * 0.7);
    await pausePlayback(page, player);

    // Keyboard: ← is forward (the visual direction of the bar), → backward, J / L are ±10 s.
    await slider.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => timeOf(player)).toBeLessThan(0.5);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => timeOf(player)).toBeCloseTo(5, 0);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => timeOf(player)).toBeCloseTo(10, 0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => timeOf(player)).toBeCloseTo(5, 0);
    await player.focus();
    await page.keyboard.press('KeyL');
    await expect.poll(() => timeOf(player)).toBeCloseTo(15, 0);
    await page.keyboard.press('KeyJ');
    await expect.poll(() => timeOf(player)).toBeCloseTo(5, 0);
    await page.keyboard.press('Digit5'); // 50 %
    await expect.poll(() => timeOf(player)).toBeCloseTo(video.durationSeconds / 2, 0);
    await expect(slider).toHaveAttribute('aria-valuenow', String(video.durationSeconds / 2));

    // Speed through the settings menu (and back to normal with the "<" shortcut).
    const menu = await openSettings(player);
    await menu.getByRole('menuitem', { name: new RegExp(playerLabels.speed) }).click();
    await menu.getByRole('menuitemradio', { name: new RegExp(faNumber(1.5)) }).click();
    await expect.poll(() => videoOf(player).evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
    await expect(menu).toBeHidden();
    await player.focus();
    await page.keyboard.press('Shift+Comma'); // "<": one step slower → 1.25
    await expect.poll(() => videoOf(player).evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.25);
  });

  test('switches between the renditions manually and back to automatic, and remembers the choice', async ({ page, world }) => {
    const video = world.videos.player;
    expect(video.heights.length).toBeGreaterThanOrEqual(2);
    const [high, low] = [video.heights[0]!, video.heights[video.heights.length - 1]!];
    const player = await openWatch(page, video.id);
    await startPlayback(player);

    let menu = await openSettings(player);
    await menu.getByRole('menuitem', { name: new RegExp(playerLabels.quality) }).click();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(video.heights.length + 1); // Auto + every rendition
    await menu.getByRole('menuitemradio', { name: `${low}p` }).click();
    await expect(player).toHaveAttribute('data-quality', String(low));
    await expect(player).toHaveAttribute('data-active-height', String(low), { timeout: 15_000 });
    await expect.poll(() => videoOf(player).evaluate((v: HTMLVideoElement) => v.videoHeight), { timeout: 15_000 }).toBe(low);

    menu = await openSettings(player);
    await menu.getByRole('menuitem', { name: new RegExp(playerLabels.quality) }).click();
    await menu.getByRole('menuitemradio', { name: `${high}p` }).click();
    await expect(player).toHaveAttribute('data-active-height', String(high), { timeout: 15_000 });
    await expect.poll(() => videoOf(player).evaluate((v: HTMLVideoElement) => v.videoHeight), { timeout: 15_000 }).toBe(high);
    await expect.poll(() => timeOf(player)).toBeGreaterThan(0.5); // still playing after both switches

    // the manual choice is remembered for the next visit
    menu = await openSettings(player);
    await menu.getByRole('menuitem', { name: new RegExp(playerLabels.quality) }).click();
    await menu.getByRole('menuitemradio', { name: `${low}p` }).click();
    await expect(player).toHaveAttribute('data-quality', String(low));
    await page.reload();
    await expect(playerOf(page)).toHaveAttribute('data-player-state', 'ready');
    await expect(playerOf(page)).toHaveAttribute('data-quality', String(low));

    // and back to automatic
    menu = await openSettings(playerOf(page));
    await menu.getByRole('menuitem', { name: new RegExp(playerLabels.quality) }).click();
    await menu.getByRole('menuitemradio', { name: new RegExp(playerLabels.qualityAuto) }).click();
    await expect(playerOf(page)).toHaveAttribute('data-quality', 'auto');
  });

  test('shows subtitles, switches their language and turns them off and on', async ({ page, world }) => {
    const player = await openWatch(page, world.videos.player.id);
    await startPlayback(player);
    await pausePlayback(page, player);

    // The creator marked the Persian track as default, so it starts ON; the first cue covers seconds 1–4.
    const faCue = 'این یک زیرنویس آزمایشی فارسی است.';
    const enCue = 'This is a test English subtitle.';
    await expect(player).not.toHaveAttribute('data-captions', 'off');
    await videoOf(player).evaluate((v: HTMLVideoElement) => (v.currentTime = 2));
    await expect(player.getByText(faCue)).toBeVisible();

    await player.hover();
    await player.getByRole('button', { name: playerLabels.captionsOn }).click(); // "turn captions off"
    await expect(player).toHaveAttribute('data-captions', 'off');
    await expect(player.getByText(faCue)).toHaveCount(0);

    await player.getByRole('button', { name: playerLabels.captionsOff }).click(); // "turn captions on"
    await expect(player).not.toHaveAttribute('data-captions', 'off');
    await expect(player.getByText(faCue)).toBeVisible();

    // another language from the menu
    const menu = await openSettings(player);
    await menu.getByRole('menuitem', { name: new RegExp(playerLabels.subtitles) }).click();
    await menu.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(player.getByText(enCue)).toBeVisible();
    await expect(player.getByText(faCue)).toHaveCount(0);

    // "C" toggles them too, and the choice survives a reload
    await player.focus();
    await page.keyboard.press('KeyC');
    await expect(player).toHaveAttribute('data-captions', 'off');
    await page.reload();
    await expect(playerOf(page)).toHaveAttribute('data-player-state', 'ready');
    await expect(playerOf(page)).toHaveAttribute('data-captions', 'off');
  });

  test('goes fullscreen and back, and shows the keyboard help', async ({ page, world }) => {
    const player = await openWatch(page, world.videos.player.id);
    await startPlayback(player);
    await pausePlayback(page, player);

    await player.hover();
    await player.getByRole('button', { name: playerLabels.fullscreen }).click();
    await expect(player).toHaveAttribute('data-fullscreen', 'true');
    expect(await page.evaluate(() => document.fullscreenElement?.getAttribute('role'))).toBe('group'); // the player itself, so our controls stay
    const size = await player.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);

    await player.hover();
    await player.getByRole('button', { name: playerLabels.exitFullscreen }).click();
    await expect(player).toHaveAttribute('data-fullscreen', 'false');
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);

    // the "F" key does the same
    await player.focus();
    await page.keyboard.press('KeyF');
    await expect(player).toHaveAttribute('data-fullscreen', 'true');
    await page.keyboard.press('KeyF');
    await expect(player).toHaveAttribute('data-fullscreen', 'false');

    // "?" opens the shortcuts dialog (modal, closes with Esc and gives focus back)
    await page.keyboard.press('Shift+Slash');
    const dialog = page.getByRole('dialog', { name: playerLabels.help.title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('J');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('shortcuts follow the physical key (Persian layout) and never fire while typing', async ({ page, world }) => {
    const player = await openWatch(page, world.videos.player.id);
    await startPlayback(player);
    await pausePlayback(page, player);

    // A Persian layout reports key = "ن" for the physical K key; the shortcut still works.
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'ن', bubbles: true, cancelable: true })));
    await expect(player).toHaveAttribute('data-playing', 'true');
    await pausePlayback(page, player);

    // Typing in a text field is not a shortcut: the same keys in the search box leave the video alone.
    const search = page.getByRole('search').getByRole('searchbox').or(page.getByRole('searchbox')).first();
    if (await search.isVisible()) {
      await search.click();
      await page.keyboard.type('k f m 5');
      await expect(player).toHaveAttribute('data-playing', 'false');
      await expect(player).toHaveAttribute('data-fullscreen', 'false');
    }
  });

  test('double-tapping the sides skips 10 seconds (touch devices)', async ({ page, world, hasTouch }) => {
    test.skip(!hasTouch, 'touch-only gesture');
    const player = await openWatch(page, world.videos.player.id);
    await startPlayback(player);
    await pausePlayback(page, player);
    await videoOf(player).evaluate((v: HTMLVideoElement) => (v.currentTime = 8));
    const box = (await player.boundingBox())!;
    const y = box.y + box.height * 0.4;

    // RTL: the LEFT third goes forward, the RIGHT third backward (the visual direction of the bar).
    await page.touchscreen.tap(box.x + box.width * 0.15, y);
    await page.touchscreen.tap(box.x + box.width * 0.15, y);
    await expect.poll(() => timeOf(player)).toBeCloseTo(18, 0);
    await page.touchscreen.tap(box.x + box.width * 0.85, y);
    await page.touchscreen.tap(box.x + box.width * 0.85, y);
    await expect.poll(() => timeOf(player)).toBeCloseTo(8, 0);
  });

  test('resumes where you stopped after a reload', async ({ page, world }) => {
    const video = world.videos.player;
    const player = await openWatch(page, video.id);
    await startPlayback(player);
    await player.hover();
    const box = (await player.getByRole('slider', { name: playerLabels.seek }).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2); // 60 % → 14.4 s
    await expect.poll(() => timeOf(player)).toBeGreaterThan(video.durationSeconds * 0.58);
    await pausePlayback(page, player);
    const stoppedAt = await timeOf(player);
    expect(stoppedAt).toBeGreaterThan(10);

    await page.reload();
    const again = playerOf(page);
    await expect(again).toHaveAttribute('data-player-state', 'ready');
    await expect.poll(() => timeOf(again), { timeout: 15_000 }).toBeGreaterThan(stoppedAt - 1.5);
    expect(await timeOf(again)).toBeLessThan(stoppedAt + 6); // (a browser that autoplays has moved on a little)

    // an explicit ?t= wins over the saved position
    await openWatch(page, video.id, '?t=3');
    await expect.poll(() => timeOf(playerOf(page)), { timeout: 15_000 }).toBeLessThan(8);
  });

  test('shows a friendly error with a retry when the stream cannot be loaded', async ({ page, world }) => {
    const video = world.videos.player;
    const manifest = `**/media/videos/${video.id}/hls/master.m3u8`;
    await page.route(manifest, (route) => route.fulfill({ status: 404, body: 'missing' }));
    await page.goto(`/watch/${video.id}`);
    const player = playerOf(page);
    await expect(player).toHaveAttribute('data-player-state', 'error', { timeout: 30_000 });
    const alert = player.getByRole('alert');
    await expect(alert).toContainText(playerLabels.errorTitle);
    await expect(alert).toContainText('در دسترس نیست');

    // the stream comes back: "تلاش دوباره" recovers without reloading the page
    await page.unroute(manifest);
    await alert.getByRole('button', { name: playerLabels.retry }).click();
    await expect(player).toHaveAttribute('data-player-state', 'ready', { timeout: 20_000 });
    await startPlayback(player);
  });

  test('is usable on this screen: controls reachable, no horizontal scroll, comfortable touch targets', async ({ page, world }) => {
    const player = await openWatch(page, world.videos.player.id);
    await startPlayback(player);
    await player.hover();
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);

    const controls = player.getByRole('group', { name: playerLabels.controls });
    await expect(controls).toBeVisible();
    for (const name of [playerLabels.pause, playerLabels.settings, playerLabels.fullscreen]) {
      const box = (await player.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(36);
      expect(box.height, name).toBeGreaterThanOrEqual(36);
      const frame = (await player.boundingBox())!;
      expect(box.x, name).toBeGreaterThanOrEqual(frame.x - 1);
      expect(box.x + box.width, name).toBeLessThanOrEqual(frame.x + frame.width + 1);
    }
    // the seek bar spans the player and is at least as tall as a finger-friendly hit area
    const bar = (await player.getByRole('slider', { name: playerLabels.seek }).boundingBox())!;
    expect(bar.height).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// view counting
// ---------------------------------------------------------------------------------------------------------------------

test.describe('view counting', () => {
  test('counts one view per viewer per 30 minutes and never trusts the heartbeat numbers', async ({ page, request, browser, world }, testInfo) => {
    const video = world.videos.views;
    const origin = new URL(testInfo.project.use.baseURL ?? 'http://localhost:3100').origin;
    const headers = { Origin: origin };

    // 1. a real viewer who watches past the threshold is counted
    const first = viewResponse(page, video.id);
    const player = await openWatch(page, video.id);
    await startPlayback(player);
    const firstBody = await (await first).json();
    expect(firstBody).toMatchObject({ counted: true });
    expect(typeof firstBody.viewId).toBe('string');
    const counted = Date.now();

    // 2. heartbeats cannot be inflated: asking for 600 s a moment later yields about as many seconds as really passed
    const inflated = await page.request.post(`/api/videos/${video.id}/heartbeat`, { headers, data: { viewId: firstBody.viewId, delta: 600, position: 6 } });
    expect(inflated.status()).toBe(200);
    const { accepted } = await inflated.json();
    expect(accepted).toBeLessThanOrEqual((Date.now() - counted) / 1000 + 2.5);
    expect(accepted).toBeLessThanOrEqual(20);
    const second = await (await page.request.post(`/api/videos/${video.id}/heartbeat`, { headers, data: { viewId: firstBody.viewId, delta: 600, position: 6 } })).json();
    expect(second.accepted).toBeLessThanOrEqual(1.5); // back-to-back: nearly nothing has elapsed

    // somebody else's view id is ignored (no watch time added for a stranger's event)
    const stranger = await request.post(`/api/videos/${video.id}/heartbeat`, { headers: { ...headers, 'User-Agent': BROWSER_UA }, data: { viewId: firstBody.viewId, delta: 15, position: 6 } });
    expect((await stranger.json()).accepted).toBe(0);

    // 3. the same viewer again within 30 minutes (here: a reload) is NOT a new view, and gets the same event back
    await pausePlayback(page, player);
    const again = viewResponse(page, video.id);
    await page.reload();
    await startPlayback(playerOf(page));
    const againBody = await (await again).json();
    expect(againBody).toMatchObject({ counted: false, reason: 'duplicate', viewId: firstBody.viewId });

    // 4. a different viewer (own cookie) is a new view
    const other = await newActorPage(browser, testInfo);
    try {
      const otherView = viewResponse(other.page, video.id);
      const otherPlayer = await openWatch(other.page, video.id);
      await startPlayback(otherPlayer);
      expect(await (await otherView).json()).toMatchObject({ counted: true });
    } finally {
      await other.context.close();
    }

    // 5. exactly those two viewers show up on the page
    await page.goto(`/watch/${video.id}`);
    await expect(page.getByTestId('view-count')).toContainText(faNumber(2));

    // 6. bots and clients that did not really play are never counted
    const bot = await request.post(`/api/videos/${video.id}/view`, { headers: { ...headers, 'User-Agent': 'curl/8.5.0' }, data: { played: 20, position: 20 } });
    expect(await bot.json()).toMatchObject({ counted: false, reason: 'bot' });
    const tooShort = await request.post(`/api/videos/${video.id}/view`, { headers: { ...headers, 'User-Agent': BROWSER_UA }, data: { played: 1, position: 1 } });
    expect(await tooShort.json()).toMatchObject({ counted: false, reason: 'below-threshold' });
    await page.goto(`/watch/${video.id}`);
    await expect(page.getByTestId('view-count')).toContainText(faNumber(2));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// the signed-in journey
// ---------------------------------------------------------------------------------------------------------------------

test.describe('engagement and comments', () => {
  test('visitor is sent to log in and back; like, follow, save, report and comment work; the creator approves and answers; notifications arrive', async ({ page, asCreator, browser, world }, testInfo) => {
    test.setTimeout(240_000);
    const video = world.videos.journey;
    const { viewer, creator } = world;
    const commentText = `ویدیوی خیلی خوبی بود، دستتان درد نکند (${testInfo.project.name})`;
    const replyText = 'ممنون که دیدید؛ حتماً ویدیوهای بعدی را هم ببینید.';

    await test.step('a visitor who likes is sent to the login page and brought back', async () => {
      await page.goto(`/watch/${video.id}`);
      await expect(playerOf(page)).toBeVisible();
      await page.getByRole('button', { name: 'پسندیدن', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${escapeRegExp(encodeURIComponent(`/watch/${video.id}`))}`));
      await submitLoginForm(page, viewer);
      await expect(page).toHaveURL(new RegExp(`/watch/${video.id}$`));
      await expect(playerOf(page)).toHaveAttribute('data-player-state', 'ready');
    });

    await test.step('like: exact counter, survives a reload, can be undone', async () => {
      // (the buttons are disabled while the server action is in flight; "enabled" = the server has answered)
      const like = page.getByRole('button', { name: 'پسندیدن', exact: true });
      const unlike = page.getByRole('button', { name: 'لغو پسندیدن' });
      await like.click();
      await expect(unlike).toHaveAttribute('aria-pressed', 'true');
      await expect(unlike).toBeEnabled();
      await expect(unlike).toContainText(faNumber(1));
      await page.reload();
      await expect(unlike).toContainText(faNumber(1));
      await unlike.click();
      await expect(like).toContainText(faNumber(0));
      await expect(like).toBeEnabled();
      await like.click(); // end liked: the creator is notified
      await expect(unlike).toContainText(faNumber(1));
      await expect(unlike).toBeEnabled();
    });

    await test.step('follow: exact follower count, survives a reload', async () => {
      const follow = page.getByRole('button', { name: /^دنبال/ });
      await expect(follow).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('follower-count')).toContainText(faNumber(0));
      await follow.click();
      await expect(follow).toHaveAttribute('aria-pressed', 'true');
      await expect(follow).toBeEnabled();
      await expect(page.getByTestId('follower-count')).toContainText(faNumber(1));
      await page.reload();
      await expect(page.getByRole('button', { name: /^دنبال/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('follower-count')).toContainText(faNumber(1));
    });

    await test.step('save for later and add to a new playlist', async () => {
      const save = page.getByRole('button', { name: /^ذخیره/ });
      await expect(save).toHaveAttribute('aria-pressed', 'false');
      await save.click();
      await expect(save).toHaveAttribute('aria-pressed', 'true');
      await expect(save).toBeEnabled();
      await expect(page.getByText(/بعداً تماشا/).first()).toBeVisible();

      await page.getByRole('button', { name: /فهرست پخش/ }).click();
      const dialog = page.getByRole('dialog', { name: /ذخیره در فهرست پخش/ });
      await dialog.getByRole('button', { name: /ساخت فهرست پخش جدید/ }).click();
      await dialog.getByLabel('نام فهرست پخش').fill('فهرست آزمایشی من');
      await dialog.getByRole('button', { name: /ساخت و افزودن ویدیو/ }).click();
      await expect(dialog.getByRole('checkbox', { name: /فهرست آزمایشی من/ })).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    await test.step('report the video (once)', async () => {
      const dialog = page.getByRole('dialog'); // (its name changes from "گزارش ویدیو" to "گزارش شما ثبت شد" on success)
      await page.getByRole('button', { name: /^گزارش$/ }).click();
      await dialog.getByRole('button', { name: /ارسال گزارش/ }).click();
      await expect(dialog.getByText('دلیل گزارش را انتخاب کنید.', { exact: true })).toBeVisible(); // a reason is required
      await dialog.getByRole('radio').first().check();
      await dialog.getByRole('button', { name: /ارسال گزارش/ }).click();
      await expect(dialog.getByText('گزارش شما ثبت شد', { exact: true })).toBeVisible();
      await dialog.getByRole('status').getByRole('button', { name: 'بستن' }).click();
      await expect(dialog).toBeHidden();

      await page.getByRole('button', { name: /^گزارش$/ }).click();
      await dialog.getByRole('radio').first().check();
      await dialog.getByRole('button', { name: /ارسال گزارش/ }).click();
      await expect(dialog.getByText(/قبلاً/)).toBeVisible(); // reporting twice is refused
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    await test.step('typing a comment never triggers a player shortcut', async () => {
      const player = playerOf(page);
      const box = page.getByRole('textbox', { name: 'نوشتن دیدگاه' });
      await box.scrollIntoViewIfNeeded();
      await box.click();
      const playing = await player.getAttribute('data-playing');
      await page.keyboard.type('k f m l j 5 c');
      await expect(player).toHaveAttribute('data-fullscreen', 'false');
      await expect(player).toHaveAttribute('data-playing', playing ?? 'false');
      await box.fill('');
    });

    await test.step('comment: the channel needs approval, so it is held and only the author sees it', async () => {
      const box = page.getByRole('textbox', { name: 'نوشتن دیدگاه' });
      await box.fill(commentText);
      await page.getByRole('button', { name: 'ارسال دیدگاه' }).click();
      await expect(page.getByText(/پس از تأیید سازنده منتشر/).first()).toBeVisible();
      const item = page.getByRole('listitem').filter({ hasText: commentText });
      await expect(item.getByText('در انتظار تأیید سازنده')).toBeVisible();
      await expect(page.getByTestId('comment-count')).toHaveText(faNumber(0)); // pending comments are not counted

      // a visitor (fresh browser) sees nothing
      const visitor = await newActorPage(browser, testInfo);
      try {
        await visitor.page.goto(`/watch/${video.id}`);
        await expect(visitor.page.getByTestId('comment-count')).toHaveText(faNumber(0));
        await expect(visitor.page.getByText(commentText)).toHaveCount(0);
      } finally {
        await visitor.context.close();
      }
    });

    await test.step('a second comment is rejected by the creator and is gone for everybody', async () => {
      const rejectedText = `این دیدگاه را سازنده رد می‌کند (${testInfo.project.name})`;
      await page.getByRole('textbox', { name: 'نوشتن دیدگاه' }).fill(rejectedText);
      await page.getByRole('button', { name: 'ارسال دیدگاه' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: rejectedText }).getByText('در انتظار تأیید سازنده')).toBeVisible();

      await asCreator.goto('/studio/comments?tab=pending');
      const row = asCreator.locator('li[data-comment-id]').filter({ hasText: rejectedText });
      await row.getByRole('button', { name: `گزینه‌های دیدگاه ${viewer.name}` }).click();
      await asCreator.getByRole('menuitem', { name: /رد کردن/ }).click();
      await expect(asCreator.getByText('دیدگاه رد شد.')).toBeVisible();
      await expect(row).toHaveCount(0);

      await page.reload();
      await expect(page.getByText(rejectedText)).toHaveCount(0);
    });

    await test.step('the creator sees it under "تأیید نشده" and publishes it from /studio/comments', async () => {
      await asCreator.goto('/studio/comments?tab=pending');
      const row = asCreator.locator('li[data-comment-id]').filter({ hasText: commentText });
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-status', 'PENDING');
      await expect(row.getByText(viewer.name)).toBeVisible();
      await expect(row.getByRole('link', { name: new RegExp(escapeRegExp(video.title)) })).toHaveAttribute('href', new RegExp(`/watch/${video.id}`));
      await row.getByRole('button', { name: /تأیید و انتشار/ }).click();
      await expect(asCreator.getByText('دیدگاه تأیید و منتشر شد.')).toBeVisible();
      await expect(asCreator.locator('li[data-comment-id]').filter({ hasText: commentText })).toHaveCount(0); // gone from "pending"
    });

    await test.step('the creator answers inline', async () => {
      await asCreator.goto('/studio/comments');
      const row = asCreator.locator('li[data-comment-id]').filter({ hasText: commentText });
      await expect(row).toHaveAttribute('data-status', 'APPROVED');
      await row.getByRole('button', { name: `پاسخ به ${viewer.name}` }).click();
      await row.getByRole('textbox', { name: `پاسخ به ${viewer.name}` }).fill(replyText);
      await row.getByRole('button', { name: 'ارسال پاسخ' }).click();
      await expect(asCreator.getByText('پاسخ شما ثبت شد.')).toBeVisible();
    });

    await test.step('the viewer now sees the published comment, the creator answer and the counters', async () => {
      await page.goto(`/watch/${video.id}`);
      await expect(page.getByTestId('comment-count')).toHaveText(faNumber(2)); // the comment + the reply
      const item = page.getByRole('listitem').filter({ hasText: commentText }).first();
      await expect(item).toBeVisible();
      await expect(item.getByText('در انتظار تأیید سازنده')).toHaveCount(0);
      await item.getByRole('button', { name: new RegExp(`${faNumber(1)} پاسخ`) }).click();
      await expect(page.getByText(replyText)).toBeVisible();
      await expect(page.locator('[aria-label="پاسخ‌ها"]').getByText('سازنده', { exact: true })).toBeVisible();
    });

    await test.step('notifications: the creator and the viewer both find them in the center', async () => {
      // creator: new follower, like, and the comment that was waiting
      await asCreator.goto('/studio/notifications');
      await expect(asCreator.getByRole('heading', { name: 'اعلان‌ها', level: 1 })).toBeVisible();
      await expect(asCreator.getByText(new RegExp(`${escapeRegExp(viewer.name)}.*دنبال`)).first()).toBeVisible();
      await expect(asCreator.getByText(new RegExp(`${escapeRegExp(viewer.name)}.*پسندید`)).first()).toBeVisible();
      await expect(asCreator.getByText(/منتظر تأیید شماست/).first()).toBeVisible();
      await asCreator.getByRole('link', { name: /خوانده‌نشده/ }).click();
      await expect(asCreator).toHaveURL(/filter=unread/);
      await asCreator.getByRole('button', { name: /علامت‌گذاری همه/ }).click();
      await expect(asCreator.getByText(/همه‌ی اعلان‌ها خوانده شده‌اند|هنوز اعلانی ندارید/)).toBeVisible();

      // viewer: the approval and the creator's reply
      await page.goto('/studio/notifications');
      await expect(page.getByText(/تأیید و منتشر شد/).first()).toBeVisible();
      await expect(page.getByText(new RegExp(`${escapeRegExp(creator.channelName)}.*پاسخ داد`)).first()).toBeVisible();
      await expect(page.getByText(/به‌زودی|بزودی/)).toHaveCount(0);
    });

    await test.step('a blocked commenter cannot post (enforced on the server) until unblocked', async () => {
      await asCreator.goto('/studio/comments');
      const row = asCreator.locator('li[data-comment-id]').filter({ hasText: commentText });
      await row.getByRole('button', { name: `گزینه‌های دیدگاه ${viewer.name}` }).click();
      await asCreator.getByRole('menuitem', { name: /مسدود کردن کاربر/ }).click();
      await expect(asCreator.getByText(/مسدود شد/).first()).toBeVisible();

      await page.goto(`/watch/${video.id}`);
      const box = page.getByRole('textbox', { name: 'نوشتن دیدگاه' });
      await box.fill('این دیدگاه نباید ثبت شود، چون من مسدود شده‌ام.');
      await page.getByRole('button', { name: 'ارسال دیدگاه' }).click();
      await expect(page.getByRole('alert').filter({ hasText: /محدود شده/ })).toBeVisible();
      await expect(page.getByText('این دیدگاه نباید ثبت شود')).toHaveCount(1); // only the draft in the box, never in the list
      await expect(page.getByRole('listitem').filter({ hasText: 'این دیدگاه نباید ثبت شود' })).toHaveCount(0);

      await asCreator.reload();
      await row.getByRole('button', { name: `گزینه‌های دیدگاه ${viewer.name}` }).click();
      await asCreator.getByRole('menuitem', { name: /رفع مسدودیت کاربر/ }).click();
      await expect(asCreator.getByText(/از مسدودیت خارج شد/).first()).toBeVisible();
    });

    await test.step('the saved position follows the signed-in viewer to another device', async () => {
      const player = playerOf(page);
      await page.goto(`/watch/${video.id}`);
      await expect(player).toHaveAttribute('data-player-state', 'ready');
      await startPlayback(player);
      await player.hover();
      const bar = (await player.getByRole('slider', { name: playerLabels.seek }).boundingBox())!;
      await page.mouse.click(bar.x + bar.width * 0.4, bar.y + bar.height / 2); // 60 %
      await expect.poll(() => timeOf(player)).toBeGreaterThan(video.durationSeconds * 0.58);
      await pausePlayback(page, player);
      const stoppedAt = await timeOf(player);
      await page.waitForTimeout(1_500); // the pause beacon reaches the server

      const device = await newActorPage(browser, testInfo, await page.context().storageState());
      try {
        const there = await openWatch(device.page, video.id);
        await expect.poll(() => timeOf(there), { timeout: 15_000 }).toBeGreaterThan(stoppedAt - 2);
      } finally {
        await device.context.close();
      }
    });
  });
});
