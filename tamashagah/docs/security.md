# Security — تماشاگاه (Tamashagah)

What protects the platform, where the code lives, how it is tested, and what is deliberately **not** covered
(see also [`known-limitations.md`](known-limitations.md)). Every statement below was checked against the code or a test;
file names are the places to start reading.

## 1. Trust boundaries

```
 Browser ──HTTPS──▶ reverse proxy (Caddy, optional) ──▶ web (Next.js) ──▶ PostgreSQL
    │                                                      │  └────────▶ Redis (rate limits, queues)
    └── tus uploads / media reads (same origin) ───────────┘  └────────▶ object storage (private bucket)
                                                  worker (FFmpeg) ◀── BullMQ ── Redis
```

* Everything the browser sends is untrusted: ids, roles, sizes, MIME types, file names, `playedSeconds`, referrers, user agents.
* The bucket is private; the browser only ever receives bytes through `/media/*` (or short-lived presigned URLs when
  `MEDIA_DELIVERY=redirect`).
* The worker is the only component that runs FFmpeg, and it only sees videos the web tier has already authorised and recorded.

## 2. Authentication and sessions

| Topic | Implementation |
| --- | --- |
| Password hashing | argon2id (`@node-rs/argon2`, 19 MiB, t=2, p=1) — `src/lib/auth/password.ts`; login timing for unknown e-mails is equalised; errors are generic (no account enumeration). |
| Session token | 256-bit random opaque token in an **HttpOnly, SameSite=Lax** cookie, `Secure` and `__Host-` prefixed when `APP_URL` is https. Only the SHA-256 of the token is stored (`Session.tokenHash`); the client IP is stored as an HMAC, never raw — `src/lib/auth/session.ts`. |
| Lifetime | sliding `SESSION_TTL_DAYS` (30) capped by `SESSION_ABSOLUTE_TTL_DAYS` (90); a worker job purges expired sessions and tokens. |
| Revocation | logout deletes the session; password change/reset revokes all other sessions; suspending a user revokes every session at once and `getCurrentUser` rejects suspended accounts on the very next request (`tests/integration/admin-users.test.ts`). |
| E-mail verification / reset | single-use random tokens (hash stored), 24 h / 1 h expiry, rate limited; uploading, commenting, reporting and creating a channel require a verified e-mail. |
| Redirects | the post-login `next` target goes through `safeRedirectPath` (same-site relative paths only, no open redirect) — `src/lib/request.ts`, `tests/unit/request-and-ids.test.ts`; `src/proxy.ts` only captures the deep link. |

Verified over HTTPS behind the Caddy overlay: the cookie is `__Host-tg_session`, `HttpOnly`, `SameSite=Lax`, `Secure`.

## 3. Authorization

* **Server-side only.** Hiding a button is cosmetic. Pages call `requirePageUser/Role/ChannelUser`; actions and handlers call
  `requireUser/VerifiedUser/ChannelUser/Role` (`src/lib/auth/guards.ts`). Ownership and visibility are re-derived from the
  database in every action — ids sent by the client only *select* a row.
* **No existence leaks.** Things the caller may not see answer **404**, never 403 (private/unlisted/taken-down videos, other
  people's playlists, uploads, studio resources, tickets).
* **One source of truth** for video visibility: `publicVideoWhere` / `canViewVideo` (`src/lib/permissions.ts`); comment status
  changes go through `applyCommentStatus` only (`src/features/comments/moderation-core.ts`).
* **Staff matrix** (`src/features/admin/policy.ts`, pure and unit-tested; enforced inside every admin action):
  moderators handle reports, takedowns, comments, channel suspension/verification, tickets; **only admins** change roles,
  suspend users, decide monetization, force-delete videos and see the full audit log. Nobody can act on themselves, a moderator
  can never act on an admin, a moderator cannot grant roles, the last active admin cannot be demoted or suspended (row locks).
* **Audit atomicity.** Every staff mutation writes exactly one `ModerationAction` in the same transaction; a database trigger
  that fails the audit insert rolls back each mutation family completely, with no notification or queue job
  (`tests/integration/admin-atomicity.test.ts`, 125-case authorization matrix in `admin-authorization.test.ts`).
* First administrator: only through the operator CLI (`pnpm user:promote` / `dist/scripts/promote-user.mjs`); audited, refuses to
  remove the last active admin (`tests/integration/promote-user-cli.test.ts`).

## 4. CSRF, origins and CORS

* Cookies are `SameSite=Lax`; **every non-GET Route Handler goes through `apiHandler`**, which validates `Origin`/`Sec-Fetch-Site`
  against `APP_URL` (+ `TRUSTED_ORIGINS`) — `src/lib/api.ts`, `src/lib/origin.ts`. Server Actions rely on Next.js' own
  Origin = Host check.
* The tus endpoint accepts the application origin only (`allowedOrigins`); there is no wildcard CORS anywhere.
* `scripts/audit-security.mjs` (in CI) fails the build when a Route Handler mutates without `apiHandler` or a Server Action has no auth guard.

## 5. Input, output and injection

* **Validation:** Zod everywhere with explicit maximum lengths and Persian messages (`src/lib/validation.ts`, `src/lib/zod-fa.ts`);
  unknown fields are rejected on privileged inputs (e.g. monetization applications cannot carry a status).
* **Errors:** a uniform envelope; unexpected errors are logged with a correlation id and never leaked (`runAction`, `apiHandler`).
* **XSS:** React escapes everything. User text (descriptions, comments) is auto-linked by tokenising into React elements — only
  `http(s):` URLs become links (`src/features/watch/linkify.ts`, unit-tested). The only `dangerouslySetInnerHTML` in the code base
  is schema.org JSON-LD, serialised with `<`, U+2028 and U+2029 escaped (`src/features/discovery/components/json-ld.tsx`); the audit fails on any other use.
* **SQL:** Prisma everywhere; the few `$queryRaw` statements (full-text search, trending, analytics) use tagged templates with bound
  parameters. `Prisma.raw` receives only module constants or a typed literal union (`PUBLIC_VIDEO_SQL`, `TimestampColumn`).
  Search input is normalised and tokenised before it reaches `to_tsquery`.
* **CSV injection:** exported cells starting with `= + - @`, tab or CR are prefixed with an apostrophe (`src/lib/analytics/csv.ts`).
* **Log injection / secrets in logs:** structured JSON (pino); cookies, passwords, tokens are redacted.

## 6. Abuse resistance

Redis fixed-window counters (atomic Lua, memory fallback when Redis is down) — `src/lib/rate-limit.ts`:

| Bucket | Limit | Bucket | Limit |
| --- | --- | --- | --- |
| login (per IP) | 10 / 10 min | comment | 12 / 5 min |
| login (per account) | 8 / 15 min | report | 10 / hour |
| register | 5 / hour | like / follow / view | 120 / 60 / 120 per min |
| password reset / resend | 5 / 3 per hour | search | 60 / min |
| upload creation | 20 / hour (+ daily count/bytes quotas) | support ticket | 5 / hour |

The client IP is taken from `X-Forwarded-For` only as far as `TRUSTED_PROXY_HOPS` says; an unknown IP shares one generous bucket
instead of locking everybody out. **Views and watch time** (`src/features/watch/view-rules.ts`, `view-service.ts`): a view needs real
played seconds, is de-duplicated per viewer+video per 30 min under an advisory lock, bot user agents are ignored, and heartbeats can
never add more watch time than the wall clock allows (`tests/integration/views.test.ts`). **Comments** pass duplicate-text, link-count and
per-channel blocklist heuristics before they are shown (`src/features/comments`), and creators/moderators can reject or delete.
These protections stop casual inflation; they do **not** stop a determined scripted client (see limitations) — which is why no
money is attached to these numbers.

## 7. Uploads, processing and media delivery

* **tus endpoint** (`src/features/uploads/tus.ts`): authorisation on *every* request (signed in, e-mail verified, owns a channel,
  channel not suspended); HEAD/PATCH/DELETE only for the owner of that very upload (anything else is 404); declared size, extension,
  MIME and daily quotas validated before a byte is stored; GET is never served; the S3 store's in-memory cache is bounded.
* **Keys, not names:** storage keys are built from generated ids (`src/lib/storage/keys.ts`, `assertSafeKey`); the file name is only
  metadata. The raw upload lives under `uploads/<videoId>` and is never served.
* **Worker:** ffprobe decides what is a video regardless of the extension; unsupported/corrupt/truncated files fail with a creator-visible
  reason. FFmpeg and FFprobe are spawned with an argv array (no shell), with an overall timeout, an inactivity watchdog and SIGTERM→SIGKILL
  (`worker/pipeline/exec.ts`); scratch directories are removed in `finally`; renditions are never upscaled.
* **Delivery** (`src/app/media/[...key]/route.ts`): only allow-listed key shapes (HLS playlists/segments, thumbnails, subtitles, avatars, banners),
  visibility enforced per video (taken-down/private files answer 404; the decision is cached for ≤ 10 s, so a takedown can take up to
  10 s to reach already-cached segments), Range/ETag support, `nosniff`. `MEDIA_DELIVERY=redirect` hands out short-lived presigned URLs.
* **Images** (avatars, banners, posters): body size bounded while reading, type decided by magic bytes, then **re-encoded** with sharp
  (metadata and any appended payload are dropped); the replaced object is deleted (`src/features/settings/image-routes.ts`, `src/lib/images.ts`).

## 8. Data protection

* Stored about a person: e-mail, display name, argon2id hash, session metadata (user agent, HMAC of IP), watch history, comments.
* Raw IPs and raw tokens are never persisted. Seeded/demo rows are marked (`source = 'SEED'`) and excluded from eligibility decisions.
* No account-deletion/data-export flow exists yet (limitation). The operator must supply a privacy policy (`/privacy` is a template).

## 9. HTTP security headers

`next.config.ts`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`,
`Cross-Origin-Opener-Policy: same-origin`, restrictive `Permissions-Policy` (microphone only for voice search) and, in production,
`Strict-Transport-Security` and a CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, media/img/connect only
from self and the configured storage origin). `script-src` needs `'unsafe-inline'` because Next.js inlines bootstrap scripts without
per-request nonces — documented residual risk, mitigated by the absence of any user-controlled HTML.

## 10. Infrastructure

* Docker images run as the unprivileged `node` user; the migrate image contains only the Prisma CLI; no secrets are baked in (build-time
  placeholders only); `.dockerignore` excludes every `.env*` except the example.
* Compose publishes Postgres/Redis/object store/Mailpit on `127.0.0.1` only; the proxy overlay publishes 80/443 only.
* `pnpm setup:env` generates the session secret and service passwords; nothing sensitive is hard-coded in the repository (the CI database
  and S3 passwords belong to throw-away service containers).
* The environment is validated at start-up (Zod); production requires an https `APP_URL` unless `ALLOW_INSECURE_HTTP` is set explicitly.

## 11. Automated checks

| Check | Where |
| --- | --- |
| Static audit (guards, `apiHandler`, dangerous constructs, raw SQL, `child_process`, direct `process.env`, tracked `.env`/keys) | `pnpm audit:security` (CI `quality`) — self-tested against deliberately unguarded code |
| Known vulnerabilities in production dependencies | `pnpm audit --prod --audit-level=high` (CI `quality`); currently clean |
| Authorization matrix, atomicity, suspended sessions | `tests/integration/admin-*.test.ts` |
| Upload authorisation/quotas, tus locking, S3 emulation | `upload-tus.test.ts`, `tus-locker.test.ts`, `s3-emulator.test.ts`, `scripts/check-storage.ts` |
| View/heartbeat integrity | `tests/integration/views.test.ts`, `tests/unit/view-rules.test.ts` |
| Media delivery visibility | `tests/integration/media-delivery.test.ts` |
| Accessibility (axe, WCAG 2.1 A/AA) | `tests/e2e/a11y.spec.ts` and per-feature e2e specs |

## 12. Independent review (findings and status)

An independent read-only review of the merged code found 10 items. **Fixed:** open redirect through TAB/control characters in `safeRedirectPath`
(now rejects control characters and re-parses the origin); moderators who own a channel could use studio mutations on other channels without
policy or audit (studio is now strictly owner-only, moderators use `/admin`); public video segments were cached `immutable` for a year (now 1 h; only
token-keyed posters/avatars/banners stay immutable); FFmpeg/FFprobe now run with `-protocol_whitelist file`. **Accepted and documented**
(`known-limitations.md`): shared auth rate-limit bucket when `TRUSTED_PROXY_HOPS=0`, upload quota counted from existing rows, follow/unfollow
notification spam, registration e-mail enumeration, unverified users can open tickets, reply-counter race (nightly reconcile).

## 13. Reporting a vulnerability

Operators should publish a contact (e.g. `/.well-known/security.txt`) before launch. This repository does not name one.
