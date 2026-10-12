# Implementation status

Last full verification: see "Verification" below. Everything listed is implemented and covered by tests unless marked otherwise.

## Routes

| Area | Routes | Notes |
| --- | --- | --- |
| Public | `/` `/search` `/category/[slug]` `/channel/[handle]` `/shorts` `/watch/[id]` `/library[/tab]` `/playlist/[id]` | HLS player (hls.js), Persian FTS, rule-based recommendations |
| Auth | `/login` `/register` `/forgot-password` `/reset-password` `/verify-email` | argon2id, opaque sessions, verified e-mail gates |
| Studio | `/studio` `/studio/upload` `/studio/videos` `/studio/videos/[id]/edit` `/studio/comments` `/studio/analytics` `/studio/notifications` `/studio/settings` `/studio/monetization` | tus uploads, FFmpeg worker, analytics from stored events |
| Admin | `/admin` + reports, videos, channels, users, monetization, verification, support, activity | server-enforced matrix, transactional audit |
| Info | `/about` `/help` `/help/tickets` `/apps` `/verification` `/copyright` `/terms` `/privacy` | real forms; legal pages are templates |
| SEO/PWA | `/robots.txt` `/sitemap.xml` `/manifest.webmanifest` service worker | |

No `ComingSoon` placeholder remains in `src/app`.

## Verification (merged tree)

* `pnpm typecheck`, `pnpm lint`, `pnpm audit:security`, `pnpm audit --prod`: clean.
* `pnpm test:unit` 592, `pnpm test:components` 21, `pnpm test:integration` 782 passed (16 skipped: S3 emulator absent).
* Production build; full Playwright suite (desktop + mobile incl. axe) — see `docs/testing.md`.
* Docker: images built, full Compose stack run; register → SMTP mail → verify → channel → tus upload → worker → HLS in S3 → FFmpeg decode OK (`docs/deployment.md` §13).

## Not verified / external

See [`known-limitations.md`](known-limitations.md).
