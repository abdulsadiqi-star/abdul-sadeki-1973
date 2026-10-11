# Testing guide

| Layer | Location | Runner | Needs |
| --- | --- | --- | --- |
| Unit | `tests/unit/**/*.test.ts` | `pnpm test:unit` | nothing |
| Component | `tests/components/**/*.test.tsx` | `pnpm test` (jsdom) | nothing |
| Integration | `tests/integration/**/*.test.ts` | `pnpm test:integration` | PostgreSQL (test DB), Redis optional |
| End-to-end | `tests/e2e/**/*.spec.ts` | `pnpm test:e2e` | built app + worker + PostgreSQL + Redis (+ ffmpeg) |

## Integration tests

* Use a **dedicated database**: `DATABASE_URL_TEST`, or `DATABASE_URL` with `_test` appended to the database name.
  Create it once: `createdb tamashagah_test` (compose: `docker compose exec postgres createdb -U tamashagah tamashagah_test`).
* The global setup runs `prisma migrate deploy` on it; every test starts from empty tables (`resetDatabase()`).
* Redis database **15** is flushed before each test (rate-limit counters). Without Redis the limiter falls back to memory.
* Server Actions run for real: `next/headers`, `next/cache` and `next/navigation` are mocked in `tests/setup/integration.ts`,
  and `requestContext` (`tests/helpers/request-context.ts`) plays the browser (cookies, headers).
* Mail goes to a temp dir (`MAIL_TRANSPORT=file`); read it with `lastTokenFor()` / `readMailbox()` (polling helpers).
* Create data with `tests/helpers/factories.ts` (`createUser`, `createChannel`, `createVideo(state)`, `createCategory`).

```ts
const owner = await createUser({ withChannel: true });
const video = await createVideo(owner.channel!.id, { state: 'private' });
expect(canViewVideo(null, access(video))).toBe(false);
```

## End-to-end tests

`playwright.config.ts` starts nothing by default — run the stack yourself and point `E2E_BASE_URL` at it:

```bash
pnpm build && PORT=3100 pnpm start &            # production build, MAIL_TRANSPORT=file recommended
pnpm dev:worker &                                # for upload/processing specs
E2E_BASE_URL=http://localhost:3100 pnpm test:e2e
```

The preinstalled Chromium is auto-detected (`PW_CHROMIUM_PATH` overrides). Specs create their own users via the UI
with random e-mails and read verification links from the file mailbox (`MAIL_FILE_DIR`).

## Visual verification

`node scripts/screenshot.mjs / /studio --as=sara@tamashagah.test --viewports=desktop,mobile --theme=dark --full`
writes PNGs to `.data/screenshots` (use `--out=` to change). Look at them — layout bugs are easy to miss in code.
