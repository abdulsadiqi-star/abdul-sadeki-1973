/**
 * Staff panel, end to end, in a real browser (desktop + mobile projects).
 *
 * Rows that the UI cannot create yet (staff accounts, a viewer's report, tickets, creator requests) come from
 * tests/e2e/support/admin-fixtures-cli.ts, which also answers "what is the database state now?". Everything else —
 * logging in, deciding, confirming, checking what visitors and creators see — goes through the real UI.
 */
import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_PASSWORD, loginViaUi } from './helpers';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------

type Person = { id: string; email: string; name: string; channel: { id: string; handle: string; name: string } | null };
type Scenario = {
  token: string;
  moderator: Person;
  admin: Person;
  creator: Person;
  viewer: Person;
  commenter: Person;
  promotee: Person;
  applicant: Person;
  verifier: Person;
  auditActor: Person;
  video: { id: string; title: string; posterKey: string };
  video2: { id: string; title: string; posterKey: string };
  comment: { id: string };
  report: { id: string };
  commentReport: { id: string };
  ticket: { id: string; number: number; subject: string };
  monetization: { id: string };
  verification: { id: string };
};

function cli<T>(...args: string[]): T {
  const out = execFileSync('pnpm', ['exec', 'tsx', '--env-file-if-exists=.env', 'tests/e2e/support/admin-fixtures-cli.ts', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out.trim().split('\n').at(-1)!) as T;
}

/** What `dbState` can ask for (mirrors `StateQuery` of the fixtures CLI). */
type StateQuery = {
  videoId?: string;
  reportIds?: string[];
  commentId?: string;
  channelId?: string;
  userId?: string;
  ticketId?: string;
  monetizationId?: string;
  verificationId?: string;
  notificationsFor?: string;
  auditWhere?: { videoId?: string; commentId?: string; channelId?: string; targetUserId?: string; actorId?: string };
};
type NotificationRow = { type: string; title: string; body: string | null };
/** The answer: only the parts named in the query are present at run time (reading anything else fails the test loudly). */
type DbState = {
  video: { exists: boolean; takedown: boolean; takedownReason: string | null; commentCount: number };
  reports: Record<string, { status: string; resolution: string | null; handled: boolean }>;
  comment: { status: string; moderationNote: string | null };
  channel: { isVerified: boolean; suspended: boolean };
  user: { role: string; status: string; sessions: number };
  ticket: { status: string; messages: number };
  monetization: { status: string; decisionNote: string | null };
  verification: { status: string; decisionNote: string | null };
  notifications: NotificationRow[];
  audit: { type: string; reason: string | null; reportId: string | null }[];
};

const createScenario = () => cli<Scenario>('scenario', E2E_PASSWORD);
const dbState = (query: StateQuery) => cli<DbState>('state', JSON.stringify(query));

/** The header bell's API: what the signed-in user was told. */
async function notificationsOf(page: Page): Promise<NotificationRow[]> {
  const body = (await (await page.request.get('/api/notifications?limit=10')).json()) as { items: NotificationRow[] };
  return body.items;
}

// ---------------------------------------------------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------------------------------------------------

const login = (page: Page, who: Person) => loginViaUi(page, who.email, E2E_PASSWORD);

async function newVisitor(browser: Browser, baseURL: string | undefined): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  return { context, page: await context.newPage() };
}

async function newSession(browser: Browser, baseURL: string | undefined, who: Person) {
  const visitor = await newVisitor(browser, baseURL);
  await login(visitor.page, who);
  return visitor;
}

/** Fill the mandatory reason of the open reason dialog and confirm. */
async function decide(page: Page, reason: string, confirmLabel: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/دلیل|توضیح/).fill(reason);
  await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
}

const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${page.url()} is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);
}

/** Is the watch page implemented yet? (Until it is merged `/watch/[id]` is a "coming soon" placeholder for everyone.) */
async function watchPageIsReal(page: Page, videoId: string): Promise<boolean> {
  await page.goto(`/watch/${videoId}`);
  return (await page.getByTestId('coming-soon').count()) === 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------------------------------------------------

test.describe('access control', () => {
  test('visitors are sent to log in and come back to /admin afterwards', async ({ page }) => {
    await page.goto('/admin/reports');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Freports/);
  });

  test('viewers and creators are redirected away from every admin page; moderators and admins get in', async ({ page, browser, baseURL }) => {
    const s = createScenario();
    await login(page, s.viewer);
    for (const path of ['/admin', '/admin/reports', '/admin/users', `/admin/reports/${s.report.id}`, '/admin/monetization']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: 'نمای کلی', level: 1 })).toHaveCount(0);
    }

    const creator = await newSession(browser, baseURL, s.creator);
    await creator.page.goto('/admin');
    await expect(creator.page).toHaveURL(/\/$/);
    await creator.context.close();

    const mod = await newSession(browser, baseURL, s.moderator);
    await mod.page.goto('/admin');
    await expect(mod.page.getByRole('heading', { name: 'نمای کلی', level: 1 })).toBeVisible();
    // administrator-only sections: no link, and a direct visit goes back to the overview
    await expect(mod.page.getByRole('link', { name: 'درخواست‌های درآمدزایی' })).toHaveCount(0);
    await mod.page.goto('/admin/monetization');
    await expect(mod.page).toHaveURL(/\/admin$/);
    await mod.context.close();

    const admin = await newSession(browser, baseURL, s.admin);
    await admin.page.goto('/admin/monetization');
    await expect(admin.page.getByRole('heading', { name: 'درخواست‌های درآمدزایی', level: 1 })).toBeVisible();
    await admin.context.close();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The acceptance flow
// ---------------------------------------------------------------------------------------------------------------------

test.describe('moderation flow', () => {
  test('a viewer’s report → moderator takes the video down → visitor gets 404 → moderator restores it', async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const s = createScenario();
    const visitor = await newVisitor(browser, baseURL);

    // 1. before: everybody can find the video and fetch its files
    const posterUrl = `/media/${s.video.posterKey}`;
    await visitor.page.goto('/');
    await expect(visitor.page.getByRole('link', { name: s.video.title }).first()).toBeVisible();
    expect((await visitor.page.request.get(posterUrl)).status()).toBe(200);
    const watchIsReal = await watchPageIsReal(visitor.page, s.video.id);
    if (watchIsReal) expect((await visitor.page.goto(`/watch/${s.video.id}`))?.status()).toBe(200);

    // 2. the moderator finds the report in the queue and opens it
    await login(page, s.moderator);
    await page.goto('/admin/reports?sort=newest');
    const queueLink = page.getByRole('link', { name: s.video.title }).first();
    await expect(queueLink).toBeVisible();
    await queueLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/reports/`));
    await expect(page.getByRole('heading', { name: 'گزارش درباره‌ی ویدیو', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: s.video.title })).toBeVisible();
    await expect(page.getByText(s.viewer.name).first()).toBeVisible(); // the reporter
    await expect(page.getByText(`اطلاعات نادرست در ویدیو ${s.token}`)).toBeVisible(); // the reporter's details
    await expect(page.getByText('در حال بررسی').first()).toBeVisible(); // opened → REVIEWING

    // 3. a decision always needs a reason; the confirmation dialog can be cancelled without effect
    await page.getByRole('button', { name: 'خارج‌کردن ویدیو از دسترس' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('خارج‌کردن ویدیو از دسترس عمومی')).toBeVisible();
    await dialog.getByRole('button', { name: 'خارج‌کردن از دسترس', exact: true }).click();
    await expect(dialog.getByText('دلیل باید دست‌کم ۳ نویسه باشد.')).toBeVisible();
    await dialog.getByRole('button', { name: 'انصراف' }).click();
    await expect(dialog).toHaveCount(0);
    expect(dbState({ videoId: s.video.id }).video.takedown).toBe(false);

    // 4. take the video down with a reason
    const reason = `نقض قانون اطلاعات نادرست ${s.token}`;
    await page.getByRole('button', { name: 'خارج‌کردن ویدیو از دسترس' }).click();
    await decide(page, reason, 'خارج‌کردن از دسترس');
    await toast(page, 'ویدیو از دسترس عمومی خارج شد.');
    await expect(page.getByText('این گزارش بررسی شده است.')).toBeVisible();
    await expect(page.getByText('اقدام شد').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'بازگرداندن ویدیو' })).toBeVisible(); // only the undo is offered now

    const afterTakedown = dbState({
      videoId: s.video.id,
      reportIds: [s.report.id],
      auditWhere: { videoId: s.video.id },
      notificationsFor: s.creator.id,
    });
    expect(afterTakedown.video).toMatchObject({ takedown: true, takedownReason: reason });
    expect(afterTakedown.reports[s.report.id]).toMatchObject({ status: 'ACTIONED', handled: true });
    expect(afterTakedown.audit).toEqual([expect.objectContaining({ type: 'VIDEO_TAKEDOWN', reason })]); // exactly one audit row
    expect(afterTakedown.notifications.some((n) => n.type === 'MODERATION' && !!n.body?.includes(reason))).toBe(true);

    // 5. the visitor no longer finds it and gets a 404 for its files; staff still can see it.
    //    (the media route remembers a video's visibility for up to 10 s, hence the polling)
    await visitor.page.goto('/');
    await expect(visitor.page.getByRole('link', { name: s.video.title })).toHaveCount(0);
    await expect.poll(async () => (await visitor.page.request.get(posterUrl)).status(), { timeout: 20_000 }).toBe(404);
    expect((await page.request.get(posterUrl)).status()).toBe(200);
    if (watchIsReal) expect((await visitor.page.goto(`/watch/${s.video.id}`))?.status()).toBe(404);
    else test.info().annotations.push({ type: 'note', description: '/watch/[id] is still a placeholder in this checkout: the page-level 404 assertion runs once the watch page is merged' });

    // 6. the creator is told why (notification API of the header bell)
    const creator = await newSession(browser, baseURL, s.creator);
    const note = (await notificationsOf(creator.page)).find((n) => n.title.includes(s.video.title));
    expect(note?.body).toContain(reason);
    await creator.context.close();

    // 7. restoring from the video list
    await page.goto(`/admin/videos?q=${encodeURIComponent(s.token)}&takedown=YES`);
    const row = page.getByRole('listitem').filter({ hasText: s.video.title });
    await expect(row).toBeVisible();
    await expect(row.getByText('خارج‌شده از دسترس')).toBeVisible();
    await row.getByRole('button', { name: 'بازگرداندن' }).click();
    await decide(page, `بازبینی شد و مشکلی نبود ${s.token}`, 'بازگرداندن ویدیو');
    await toast(page, 'ویدیو دوباره در دسترس قرار گرفت.');
    await expect(page.getByRole('listitem').filter({ hasText: s.video.title })).toHaveCount(0); // no longer in the "taken down" list
    expect(dbState({ videoId: s.video.id }).video.takedown).toBe(false);

    await visitor.page.goto('/');
    await expect(visitor.page.getByRole('link', { name: s.video.title }).first()).toBeVisible();
    await expect.poll(async () => (await visitor.page.request.get(posterUrl)).status(), { timeout: 20_000 }).toBe(200);
    if (watchIsReal) expect((await visitor.page.goto(`/watch/${s.video.id}`))?.status()).toBe(200);
    await visitor.context.close();

    // 8. both decisions are in the audit log with their reasons
    await page.goto(`/admin/activity?target=${s.video.id}`);
    const log = page.getByRole('list', { name: 'گزارش فعالیت‌ها' });
    await expect(log.getByRole('listitem')).toHaveCount(2);
    await expect(log.getByText(reason)).toBeVisible();
    await expect(log.getByText(/را برای همیشه|را از دسترس عمومی خارج کرد/)).toBeVisible();
    await expect(log.getByText(/را دوباره در دسترس قرار داد/)).toBeVisible();
  });

  test('a reported comment is deleted, restored and its author blocked — counters and audit stay exact', async ({ page }) => {
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto(`/admin/reports/${s.commentReport.id}`);
    await expect(page.getByRole('heading', { name: 'گزارش درباره‌ی دیدگاه', level: 1 })).toBeVisible();
    await expect(page.getByText(`تبلیغ مزاحم ${s.token}`).first()).toBeVisible();
    await expect(page.getByText(s.commenter.name).first()).toBeVisible();

    await page.getByRole('button', { name: 'حذف دیدگاه' }).click();
    await decide(page, 'تبلیغ مزاحم و تکراری', 'حذف دیدگاه');
    await toast(page, 'دیدگاه حذف شد.');
    let state = dbState({ commentId: s.comment.id, videoId: s.video.id, reportIds: [s.commentReport.id] });
    expect(state.comment.status).toBe('DELETED');
    expect(state.video.commentCount).toBe(0);
    expect(state.reports[s.commentReport.id].status).toBe('ACTIONED');

    await page.getByRole('button', { name: 'بازگرداندن دیدگاه' }).click();
    await decide(page, 'اشتباه بود، دیدگاه مشکلی ندارد', 'بازگرداندن دیدگاه');
    await toast(page, /دیدگاه بازگردانده شد/);
    state = dbState({ commentId: s.comment.id, videoId: s.video.id });
    expect(state.comment.status).toBe('APPROVED');
    expect(state.video.commentCount).toBe(1);

    await page.getByRole('button', { name: 'مسدودکردن دیدگاه‌نویس' }).click();
    await decide(page, 'ارسال مکرر تبلیغات در این کانال', 'مسدودکردن');
    await toast(page, 'دیدگاه‌نویس در این کانال مسدود شد.');
    await expect(page.getByRole('button', { name: 'رفع مسدودیت دیدگاه‌نویس' })).toBeVisible();

    const audit = dbState({ auditWhere: { commentId: s.comment.id } }).audit.map((r) => r.type);
    expect(audit).toEqual(['COMMENT_DELETE', 'COMMENT_RESTORE']);
    expect(dbState({ auditWhere: { targetUserId: s.commenter.id } }).audit.map((r) => r.type)).toContain('CHANNEL_USER_BLOCK');
  });

  test('a report can be dismissed with a reason', async ({ page }) => {
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto(`/admin/reports/${s.report.id}`);
    await page.getByRole('button', { name: 'رد گزارش' }).click();
    await decide(page, 'ادعا با مدارک همخوانی ندارد', 'رد گزارش');
    await toast(page, 'گزارش رد شد.');
    await expect(page.getByText('رد شد').first()).toBeVisible();
    const state = dbState({ reportIds: [s.report.id], videoId: s.video.id, auditWhere: { videoId: s.video.id } });
    expect(state.reports[s.report.id].status).toBe('DISMISSED');
    expect(state.video.takedown).toBe(false);
    expect(state.audit.map((r) => r.type)).toEqual(['REPORT_DISMISS']);
  });

  test('the queue filters, sorts and links to the report', async ({ page }) => {
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto('/admin/reports?status=OPEN&target=COMMENT&sort=newest');
    await expect(page.getByRole('link', { name: new RegExp(`تبلیغ مزاحم ${s.token}`) }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: s.video.title })).toHaveCount(0); // a video report is filtered out

    // the filter bar drives the URL
    await page.goto('/admin/reports');
    await page.getByLabel('نوع مورد').selectOption('VIDEO');
    await expect(page).toHaveURL(/target=VIDEO/);
    await page.getByLabel('دلیل گزارش').selectOption('MISINFORMATION');
    await expect(page).toHaveURL(/reason=MISINFORMATION/);
    await page.getByRole('button', { name: 'پاک‌کردن فیلترها' }).click();
    await expect(page).not.toHaveURL(/target=|reason=/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------------------------------------------------

test.describe('roles and accounts', () => {
  test('an administrator promotes a user, suspends them (their session dies) and restores them', async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const s = createScenario();
    await login(page, s.admin);
    await page.goto(`/admin/users?q=${encodeURIComponent(s.promotee.email)}`);
    await page.getByRole('link', { name: s.promotee.name }).first().click();
    await expect(page.getByRole('heading', { name: s.promotee.name, level: 1 })).toBeVisible();

    // promote to moderator
    await page.getByLabel('نقش کاربر').selectOption('MODERATOR');
    await page.getByRole('button', { name: 'تغییر نقش' }).click();
    await decide(page, 'ارتقا پس از دوره‌ی آزمایشی', 'ثبت نقش جدید');
    await toast(page, 'نقش به «ناظر» تغییر کرد.');
    await expect(page.getByText('ناظر').first()).toBeVisible();
    expect(dbState({ userId: s.promotee.id }).user.role).toBe('MODERATOR');

    // the promoted user reaches the panel
    const promoted = await newSession(browser, baseURL, s.promotee);
    await promoted.page.goto('/admin');
    await expect(promoted.page.getByRole('heading', { name: 'نمای کلی', level: 1 })).toBeVisible();
    await expect(promoted.page.getByRole('link', { name: 'درخواست‌های درآمدزایی' })).toHaveCount(0); // moderator, not admin

    // suspend: the session stops working on the next request
    await page.getByRole('button', { name: 'تعلیق حساب' }).click();
    await decide(page, 'نقض قوانین سازمانی', 'تعلیق حساب');
    await toast(page, /حساب تعلیق شد/);
    const suspended = dbState({ userId: s.promotee.id });
    expect(suspended.user).toMatchObject({ status: 'SUSPENDED', sessions: 0 });
    await promoted.page.goto('/admin');
    await expect(promoted.page).toHaveURL(/\/login/);
    await promoted.context.close();

    // restore: they can sign in again
    await page.getByRole('button', { name: 'رفع تعلیق حساب' }).click();
    await decide(page, 'استیناف پذیرفته شد', 'رفع تعلیق');
    await toast(page, 'تعلیق حساب برداشته شد.');
    const again = await newSession(browser, baseURL, s.promotee);
    await again.page.goto('/admin');
    await expect(again.page.getByRole('heading', { name: 'نمای کلی', level: 1 })).toBeVisible();
    await again.context.close();

    expect(dbState({ auditWhere: { targetUserId: s.promotee.id } }).audit.map((r) => r.type)).toEqual(['USER_ROLE_CHANGE', 'USER_SUSPEND', 'USER_RESTORE']);
    const notes = dbState({ notificationsFor: s.promotee.id }).notifications.map((n) => n.type);
    expect(notes).toEqual(expect.arrayContaining(['SYSTEM', 'MODERATION']));
  });

  test('nobody manages their own account and moderators cannot manage anybody', async ({ page, browser, baseURL }) => {
    const s = createScenario();
    await login(page, s.admin);
    await page.goto(`/admin/users/${s.admin.id}`);
    await expect(page.getByText('نمی‌توانید نقش یا وضعیت حساب خودتان را تغییر دهید.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'تعلیق حساب' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'تغییر نقش' })).toBeDisabled();

    const mod = await newSession(browser, baseURL, s.moderator);
    await mod.page.goto(`/admin/users/${s.promotee.id}`);
    await expect(mod.page.getByText('تغییر نقش و تعلیق حساب فقط برای مدیران ممکن است.')).toBeVisible();
    await expect(mod.page.getByRole('button', { name: 'تعلیق حساب' })).toHaveCount(0);
    await expect(mod.page.getByLabel('نقش کاربر')).toHaveCount(0);
    await mod.context.close();
  });

  test('channels: verify, unverify, suspend and restore', async ({ page }) => {
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto(`/admin/channels/${s.creator.channel!.id}`);
    await expect(page.getByRole('heading', { name: s.creator.channel!.name, level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'تأیید کانال' }).click();
    await decide(page, 'هویت کانال تأیید شد', 'تأیید کانال');
    await toast(page, 'نشان تأیید به کانال داده شد.');
    await expect(page.getByRole('button', { name: 'برداشتن تیک' })).toBeVisible();
    expect(dbState({ channelId: s.creator.channel!.id }).channel.isVerified).toBe(true);

    await page.getByRole('button', { name: 'تعلیق', exact: true }).click();
    await decide(page, 'تبلیغ طرح‌های مشکوک', 'تعلیق کانال');
    await toast(page, 'کانال تعلیق شد.');
    await expect(page.getByText(/تعلیق‌شده در/)).toBeVisible();
    expect(dbState({ channelId: s.creator.channel!.id }).channel.suspended).toBe(true);

    await page.getByRole('button', { name: 'رفع تعلیق' }).click();
    await decide(page, 'استیناف پذیرفته شد', 'رفع تعلیق');
    await toast(page, 'تعلیق کانال برداشته شد.');
    await page.getByRole('button', { name: 'برداشتن تیک' }).click();
    await decide(page, 'نقض شرایط تیک تأیید', 'برداشتن تیک');
    await toast(page, 'نشان تأیید برداشته شد.');
    expect(dbState({ auditWhere: { channelId: s.creator.channel!.id } }).audit.map((r) => r.type)).toEqual(['CHANNEL_VERIFY', 'CHANNEL_SUSPEND', 'CHANNEL_RESTORE', 'CHANNEL_UNVERIFY']);
  });

  test('videos: force delete is an administrator-only, confirmed action', async ({ page, browser, baseURL }) => {
    const s = createScenario();
    const mod = await newSession(browser, baseURL, s.moderator);
    await mod.page.goto(`/admin/videos?q=${encodeURIComponent(s.video2.title)}`);
    const modRow = mod.page.getByRole('listitem').filter({ hasText: s.video2.title });
    await expect(modRow).toBeVisible();
    await expect(modRow.getByRole('button', { name: 'حذف قطعی' })).toHaveCount(0);
    await mod.context.close();

    await login(page, s.admin);
    await page.goto(`/admin/videos?q=${encodeURIComponent(s.video2.title)}`);
    const row = page.getByRole('listitem').filter({ hasText: s.video2.title });
    await row.getByRole('button', { name: 'حذف قطعی' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('این کار قابل بازگشت نیست.')).toBeVisible();
    await dialog.getByRole('button', { name: 'انصراف' }).click();
    expect(dbState({ videoId: s.video2.id }).video.exists).toBe(true);

    await row.getByRole('button', { name: 'حذف قطعی' }).click();
    await decide(page, 'حکم قضایی حق تکثیر', 'حذف قطعی');
    await toast(page, /ویدیو برای همیشه حذف شد|ویدیو حذف شد/);
    expect(dbState({ videoId: s.video2.id }).video.exists).toBe(false);
    await expect(page.getByRole('listitem').filter({ hasText: s.video2.title })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Requests and support
// ---------------------------------------------------------------------------------------------------------------------

test.describe('creator programs', () => {
  test('monetization: opened → under review, decision needs a note to reject, approval notifies the creator', async ({ page, browser, baseURL }) => {
    const s = createScenario();
    await login(page, s.admin);
    // waiting applications are listed oldest first, so a fresh one is found by searching, not by paging
    await page.goto(`/admin/monetization?q=${encodeURIComponent(s.token)}`);
    await expect(page.getByRole('link', { name: new RegExp(s.applicant.channel!.name) }).first()).toBeVisible();
    await page.goto(`/admin/monetization/${s.monetization.id}`);
    await expect(page.getByRole('heading', { name: new RegExp(`درخواست درآمدزایی «${s.applicant.channel!.name}»`), level: 1 })).toBeVisible();
    // snapshot vs live statistics: a table on wide screens, one block per metric on phones — the verdict is visible in both
    const stats = page.locator('#stats');
    await expect(stats.getByText('دنبال‌کننده').filter({ visible: true }).first()).toBeVisible();
    await expect(stats.getByText(/رسیده/).filter({ visible: true }).first()).toBeVisible();
    await expect.poll(() => dbState({ monetizationId: s.monetization.id }).monetization.status).toBe('UNDER_REVIEW');

    await page.getByRole('button', { name: 'رد درخواست' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'رد درخواست', exact: true }).click();
    await expect(dialog.getByText('توضیح تصمیم باید دست‌کم ۳ نویسه باشد.')).toBeVisible();
    await dialog.getByRole('button', { name: 'انصراف' }).click();
    expect(dbState({ monetizationId: s.monetization.id }).monetization.status).toBe('UNDER_REVIEW');

    await page.getByRole('button', { name: 'تأیید درخواست' }).click();
    await decide(page, 'شرایط برنامه برقرار است', 'تأیید درخواست');
    await toast(page, 'درخواست درآمدزایی تأیید شد.');
    await expect(page.getByText('تأیید شده').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'تعلیق درآمدزایی' })).toBeVisible(); // only the legal next move is offered
    expect(dbState({ monetizationId: s.monetization.id }).monetization).toMatchObject({ status: 'APPROVED', decisionNote: 'شرایط برنامه برقرار است' });

    const creator = await newSession(browser, baseURL, s.applicant);
    const items = await notificationsOf(creator.page);
    expect(items.some((n) => n.title.includes('درخواست درآمدزایی') && n.title.includes('تأیید شد'))).toBe(true);
    await creator.context.close();
  });

  test('verification: evidence links are safe, approval grants the badge', async ({ page }) => {
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto(`/admin/verification?q=${encodeURIComponent(s.token)}`);
    await page.getByRole('link', { name: 'بررسی', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/verification/${s.verification.id}`));
    await expect(page.getByRole('heading', { name: /درخواست تیک تأیید/, level: 1 })).toBeVisible();
    const official = page.getByRole('link', { name: /example\.com\/official-page/ });
    await expect(official).toHaveAttribute('href', 'https://example.com/official-page');
    await expect(official).toHaveAttribute('rel', /noopener/);
    await expect(official).toHaveAttribute('target', '_blank');
    await expect(page.locator('a[href^="javascript"]')).toHaveCount(0);
    await expect(page.getByText(/نشانی نامعتبر/)).toBeVisible();

    await page.getByRole('button', { name: 'رد درخواست' }).click();
    await decide(page, 'مدارک کافی نیست', 'رد درخواست');
    await toast(page, 'درخواست رد شد.');
    await expect(page.getByText('رد شده').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'تأیید و دادن تیک' })).toHaveCount(0); // decided: final
    expect(dbState({ verificationId: s.verification.id }).verification.status).toBe('REJECTED');
  });

  test('verification: approval sets the channel badge', async ({ page }) => {
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto(`/admin/verification/${s.verification.id}`);
    await page.getByRole('button', { name: 'تأیید و دادن تیک' }).click();
    await decide(page, 'هویت تأیید شد', 'تأیید و دادن تیک');
    await toast(page, 'درخواست تأیید شد و کانال نشان تأیید گرفت.');
    expect(dbState({ channelId: s.verifier.channel!.id, verificationId: s.verification.id })).toMatchObject({ channel: { isVerified: true }, verification: { status: 'APPROVED' } });
  });
});

test.describe('support', () => {
  test('a staff reply answers the ticket, notifies the user and can be closed and reopened', async ({ page }) => {
    test.setTimeout(150_000);
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto(`/admin/support?q=${encodeURIComponent(s.token)}`);
    await expect(page.getByRole('link', { name: s.ticket.subject })).toBeVisible();
    await page.getByRole('link', { name: s.ticket.subject }).click();
    await expect(page.getByRole('heading', { name: /تیکت شماره‌ی/, level: 1 })).toBeVisible();
    await expect(page.getByText('ویدیوی من ساعت‌هاست در صف پردازش مانده است.')).toBeVisible();

    // validation first
    await page.getByRole('button', { name: 'ارسال پاسخ' }).click();
    await expect(page.getByText('متن پاسخ را بنویسید.').first()).toBeVisible();

    const reply = `سلام؛ مشکل از صف پردازش بود و برطرف شد. ${s.token}`;
    await page.getByLabel(/پاسخ شما به تیکت/).fill(reply);
    await page.getByRole('button', { name: 'ارسال پاسخ' }).click();
    await toast(page, 'پاسخ برای کاربر ارسال شد.');
    await expect(page.getByRole('list', { name: 'پیام‌های تیکت' }).getByText(reply)).toBeVisible();
    await expect(page.getByText('پاسخ داده شده').first()).toBeVisible();
    const answered = dbState({ ticketId: s.ticket.id, notificationsFor: s.creator.id });
    expect(answered.ticket).toEqual({ status: 'ANSWERED', messages: 2 });
    expect(answered.notifications.some((n) => n.type === 'TICKET_REPLY' && !!n.body?.includes(reply))).toBe(true);

    // close (confirmed) and reopen
    await page.getByRole('button', { name: 'بستن تیکت' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'بستن تیکت' }).click();
    await toast(page, 'تیکت بسته شد.');
    await expect(page.getByText('این تیکت بسته است.')).toBeVisible();
    await expect(page.getByLabel(/پاسخ شما به تیکت/)).toHaveCount(0);
    await page.getByRole('button', { name: 'بازگشایی تیکت' }).click();
    await toast(page, 'تیکت دوباره باز شد.');
    expect(dbState({ ticketId: s.ticket.id }).ticket.status).toBe('OPEN');
    expect(dbState({ auditWhere: { targetUserId: s.creator.id } }).audit.map((r) => r.type)).toEqual(['TICKET_REPLY', 'TICKET_CLOSE', 'TICKET_REOPEN']);

    // the ticket shows up in the filtered list
    await page.goto(`/admin/support?status=OPEN&category=UPLOAD&q=${encodeURIComponent(s.token)}`);
    await expect(page.getByRole('link', { name: s.ticket.subject })).toBeVisible();
    await page.goto(`/admin/support?status=CLOSED&q=${encodeURIComponent(s.token)}`);
    await expect(page.getByText('تیکتی با این فیلترها پیدا نشد')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------------------------------

test.describe('audit log', () => {
  test('filters by actor, type and Jalali date, and paginates', async ({ page }) => {
    const s = createScenario();
    await login(page, s.admin);
    await page.goto(`/admin/activity?actor=${encodeURIComponent(s.auditActor.name)}`);
    const log = page.getByRole('list', { name: 'گزارش فعالیت‌ها' });
    await expect(log.getByRole('listitem')).toHaveCount(20);
    await expect(page.getByRole('navigation', { name: 'صفحه‌بندی' })).toBeVisible();
    await expect(log.getByText(/به تیکت شماره‌ی ۲ پاسخ داد|تیکت شماره‌ی ۲ را بست/).first()).toBeVisible(); // Persian digits in descriptions

    await page.getByRole('link', { name: 'بعدی' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(log.getByRole('listitem')).toHaveCount(20);
    await page.getByRole('link', { name: 'بعدی' }).click();
    await expect(page).toHaveURL(/page=3/);
    await expect(log.getByRole('listitem')).toHaveCount(5);

    // type filter (native select) resets to the first page and narrows the list
    await page.getByLabel('نوع اقدام').selectOption('VIDEO_TAKEDOWN');
    await expect(page).toHaveURL(/type=VIDEO_TAKEDOWN/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(log.getByRole('listitem')).toHaveCount(9); // 45 rows, every 5th is a take-down
    await expect(log.getByText('را از دسترس عمومی خارج کرد').first()).toBeVisible();

    // Jalali date range: from today keeps everything, a past "to" day empties the list
    await page.getByRole('button', { name: 'از تاریخ' }).click();
    await page.getByRole('button', { name: 'امروز' }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
    await expect(log.getByRole('listitem')).toHaveCount(9);
    await page.goto(`/admin/activity?actor=${encodeURIComponent(s.auditActor.name)}&to=2020-01-01`);
    await expect(page.getByText('اقدامی با این فیلترها پیدا نشد')).toBeVisible();

    // every row carries the decision's reason exactly as the staff member wrote it
    await page.goto(`/admin/activity?actor=${encodeURIComponent(s.auditActor.name)}`);
    await expect(log.getByText(`دلیل شماره 1 ${s.token}`)).toBeVisible();
  });

  test('moderators see a scoped log; administrator-only decisions stay hidden from them', async ({ page, browser, baseURL }) => {
    const s = createScenario();

    // the administrator sees the role change and the suspension of the viewer ...
    const admin = await newSession(browser, baseURL, s.admin);
    await admin.page.goto(`/admin/activity?target=${s.viewer.id}`);
    const adminLog = admin.page.getByRole('list', { name: 'گزارش فعالیت‌ها' });
    await expect(adminLog.getByRole('listitem')).toHaveCount(2);
    await expect(adminLog.getByText(`ارتقای آزمایشی ${s.token}`)).toBeVisible();
    await expect(adminLog.getByText(`تعلیق آزمایشی ${s.token}`)).toBeVisible();
    await admin.context.close();

    // ... a moderator does not, and is told why
    await login(page, s.moderator);
    await page.goto(`/admin/activity?target=${s.viewer.id}`);
    await expect(page.getByText('اقدامی با این فیلترها پیدا نشد')).toBeVisible();
    await expect(page.getByText(`ارتقای آزمایشی ${s.token}`)).toHaveCount(0);

    await page.goto('/admin/activity');
    await expect(page.getByText('تصمیم‌های مربوط به نقش‌ها، تعلیق حساب‌ها و درآمدزایی فقط برای مدیران قابل مشاهده است.')).toBeVisible();
    const types = await page.getByLabel('نوع اقدام').locator('option').allTextContents();
    expect(types).not.toContain('تغییر نقش');
    expect(types).not.toContain('تعلیق حساب');
    expect(types).toContain('خارج‌کردن ویدیو از دسترس');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Responsive layout + accessibility
// ---------------------------------------------------------------------------------------------------------------------

test.describe('layout and accessibility', () => {
  /** Every staff page that has real data behind it. Moderators open all of these; administrators additionally the two below. */
  const staffPages = (s: Scenario) => [
    '/admin',
    '/admin/reports',
    `/admin/reports/${s.report.id}`,
    `/admin/reports/${s.commentReport.id}`,
    '/admin/videos',
    '/admin/channels',
    `/admin/channels/${s.creator.channel!.id}`,
    '/admin/users',
    `/admin/users/${s.creator.id}`,
    '/admin/verification',
    `/admin/verification/${s.verification.id}`,
    '/admin/support',
    `/admin/support/${s.ticket.id}`,
    '/admin/activity',
  ];
  const adminOnlyPages = (s: Scenario) => ['/admin/monetization', `/admin/monetization/${s.monetization.id}`];

  async function checkLayout(page: Page, paths: string[]) {
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
      await expectNoHorizontalScroll(page);
    }
  }

  async function checkAccessibility(page: Page, paths: string[]) {
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page }).include('main').analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), path).toEqual([]);
    }
  }

  test('RTL, no horizontal scroll and exactly one h1 on every page (moderator and administrator views)', async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const s = createScenario();
    await login(page, s.moderator);
    await checkLayout(page, staffPages(s));

    const admin = await newSession(browser, baseURL, s.admin);
    await checkLayout(admin.page, [...staffPages(s), ...adminOnlyPages(s)]);
    await admin.context.close();
  });

  test('sidebar on desktop, drawer on phones', async ({ page, isMobile }) => {
    const s = createScenario();
    await login(page, s.moderator);
    await page.goto('/admin');
    const nav = page.getByRole('navigation', { name: 'منوی پنل مدیریت' });
    if (isMobile) {
      await expect(nav).toBeHidden();
      await page.getByRole('button', { name: 'منوی اصلی' }).click();
      await expect(nav).toBeVisible();
      for (const label of ['نمای کلی', 'گزارش‌ها', 'ویدیوها', 'کانال‌ها', 'کاربران', 'درخواست‌های تیک تأیید', 'پشتیبانی', 'گزارش فعالیت‌ها']) {
        await expect(nav.getByRole('link', { name: new RegExp(label) })).toBeVisible();
      }
      await nav.getByRole('link', { name: /گزارش‌ها/ }).click();
      await expect(page).toHaveURL(/\/admin\/reports/);
      await expect(nav).toBeHidden(); // the drawer closes after navigating
    } else {
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: 'نمای کلی' })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('link', { name: /گزارش‌ها/ }).click();
      await expect(page).toHaveURL(/\/admin\/reports/);
      await expect(nav.getByRole('link', { name: /گزارش‌ها/ })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('no serious accessibility violations on any page (including an open dialog)', async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const s = createScenario();
    await login(page, s.moderator);
    await checkAccessibility(page, staffPages(s));

    await page.goto(`/admin/reports/${s.report.id}`);
    await page.getByRole('button', { name: 'رد گزارش' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

    const admin = await newSession(browser, baseURL, s.admin);
    await checkAccessibility(admin.page, adminOnlyPages(s));
    await admin.context.close();
  });
});
