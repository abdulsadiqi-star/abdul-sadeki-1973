# Architecture — تماشاگاه (Tamashagah)

A production-grade Persian (RTL) video-sharing platform inspired by the structure and UX of Aparat.
Everything described here is implemented, not mocked; gaps are listed in [`known-limitations.md`](known-limitations.md).

## 1. Scope and reference analysis

The product was designed from five reference screenshots of the Aparat **creator studio** (user menu, dashboard,
"my videos" grid, comment moderation, analytics). Public-site screens (home, watch page, search…) were not among the
attached images, so those follow the same visual language and common video-platform conventions.

What the screenshots dictate:

| Reference screen | Design consequences in this project |
| --- | --- |
| Account menu (channel name + "view channel", accounts, settings, channel management, my videos, view stats, live, ads, monetization) | `UserMenu` mirrors the order; live/ads are **not** built, so they are not shown (no dead buttons). |
| Dashboard | Global top bar (logo + hamburger on the right, centered search with mic, upload button / services grid / bell / avatar on the left), right sidebar with large channel avatar + nav, **4 stat cards** (videos, followers, total views, today's views), two promo cards, "my videos" and "comments" lists. |
| My videos | Pill filter tabs (all / unpublished / playlist / reshared / shorts), **6-column** thumbnail grid whose first tile is "upload", each card: duration badge, title, views, 4 actions (delete, promote, edit, stats). |
| Comments | Tabs with counts (all / spam / unapproved / replies), checkbox rows, "approve & publish", "spam writers" list. |
| Analytics | 7 metric cards (today, watch minutes, total views, followers, notifications subscribers, month views, promo CTA) and a multi-series line chart with date-range dropdown and Jalali date labels. |

Brand: original identity (violet → magenta, saffron accent, own logo mark). No Aparat logo, trademarks or media.

## 2. System overview

```
                       ┌────────────────────────── Next.js 16 (App Router, Node) ─────────────────────────┐
 Browser ─ HTTPS ────► │ RSC pages · Server Actions · Route Handlers (/api/*, /media/*, tus upload)         │
 (React 19, hls.js,    └──────┬──────────────┬───────────────────┬───────────────────┬──────────────────────┘
  TanStack Query)             │ Prisma 7     │ ioredis           │ S3 SDK / fs       │ BullMQ producers
                              ▼              ▼                   ▼                   ▼
                        PostgreSQL 16      Redis 7        Object storage        Redis queues
                        (data, FTS)    (rate limit, queues) (S3-compatible)          │
                                                                  ▲                   ▼
                                                                  └──────────  Worker process (Node)
                                                                              ffprobe → ffmpeg → HLS → storage
```

* **Web app** — Server Components render pages; mutations are Server Actions (built-in Origin check) or Route Handlers
  wrapped by `apiHandler` (explicit Origin/CSRF check, uniform errors). Heavy work never runs in a request.
* **Worker** (`worker/`) — separate process, same codebase. Consumes BullMQ jobs: transcoding, scheduled publishing,
  cleanup, counter reconciliation. Needs FFmpeg/FFprobe.
* **PostgreSQL** — source of truth, full-text search (generated `tsvector`, GIN) and trigram indexes (`pg_trgm`).
* **Redis** — BullMQ queues and the rate limiter (falls back to memory for the limiter only).
* **Storage** — private S3-compatible bucket (RustFS in the bundled Compose stack, any S3 service in production) or the local filesystem driver. `pnpm check:storage` verifies a backend (multipart, ranges, presign, listing, deletion).

## 3. Technology

| Area | Choice |
| --- | --- |
| Framework | Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript 6 (strict) |
| UI | Tailwind CSS 4, hand-written shadcn-style primitives on Radix UI (`radix-ui`), lucide-react, sonner, next-themes, Recharts 3 |
| Data | PostgreSQL 16, Prisma 7 (driver adapter `@prisma/adapter-pg`), Zod 4 (Persian locale) |
| Client data | TanStack Query 5, React Hook Form + Zod resolver |
| Jobs / media | BullMQ 6 + ioredis, FFmpeg 6 / FFprobe, HLS (MPEG-TS), hls.js 1.7 |
| Uploads | tus protocol (`@tus/server`, `tus-js-client`) → S3 multipart or fs store |
| Auth | Opaque DB-backed sessions (SHA-256-hashed tokens), argon2id (`@node-rs/argon2`), e-mail verification/reset tokens |
| Quality | Vitest 5 (unit/component/integration), Playwright 1.64 + axe, ESLint 9, Prettier 3, GitHub Actions |
| Ops | Docker Compose (postgres, redis, objectstore, mailpit, migrate, web, worker), `output: standalone` image |

> The shadcn **registry is not reachable** from the build sandbox, so UI primitives in `src/components/ui/` were written
> by hand to the same API. They are RTL-hardened (logical properties, `rtl:` flips, Radix `Direction.Provider`).

## 4. Repository layout

```
tamashagah/
├── prisma/                 schema.prisma, migrations/, seed.ts
├── src/
│   ├── app/                routes: (site) public · (auth) · studio · admin · api · media
│   ├── components/         ui/ primitives · layout/ shell · video/ · auth/ · …
│   ├── features/           domain code per feature: schemas.ts · queries.ts · actions.ts · components/
│   ├── lib/                runtime-agnostic infrastructure (env, db, redis, storage, queue, format, …)
│   ├── config/             brand + product constants
│   └── generated/          Prisma client (git-ignored)
├── worker/                 BullMQ worker + FFmpeg pipeline
├── scripts/                screenshot helper, seed-media, sandbox setup
├── tests/                  unit/ · component/ · integration/ · e2e/ · helpers/
└── docs/                   this folder
```

`src/lib/{env,db,redis,logger,storage,queue,format,persian,jalali,ids,errors,rate-limit}` are **shared with the worker**: they
must not import `next/*` or `server-only`. Next-only modules (`lib/auth/*`, `format-server`, feature `queries/actions`) do.

## 5. Domain model (see `prisma/schema.prisma`)

Users, Sessions, EmailTokens · Channels, Categories · Videos, MediaAssets, TranscodeJobs · Comments, VideoLikes, Follows,
FollowEvents · Playlists (+ system *Watch later*), PlaylistItems, WatchHistory · ViewEvents · Notifications · Reports,
ModerationActions, ChannelBlocks · MonetizationApplications, VerificationRequests · SupportTickets, TicketMessages.

### Video lifecycle (three independent axes)

```
processingStatus: AWAITING_UPLOAD → QUEUED → PROCESSING → READY | FAILED
publishStatus:    DRAFT → (SCHEDULED →) PUBLISHED          (publishOnReady / scheduledFor)
visibility:       PUBLIC | UNLISTED | PRIVATE
takedownAt:       set by moderators, hides the video from everyone except owner/moderators
```

A video is **listed** (feeds, search, recommendations) only when `READY ∧ PUBLISHED ∧ PUBLIC ∧ not taken down ∧ channel
not suspended` — encoded once in `features/videos/visibility.ts` (Prisma + raw SQL twins) and `lib/permissions.ts`.
**Watchable by link**: same but `UNLISTED` also allowed. Owners and moderators always see their own/any video.

### Comments

`PENDING → APPROVED | REJECTED | SPAM | DELETED`. Channel mode `OPEN | APPROVAL_REQUIRED | DISABLED`; blocked commenters
(`ChannelBlock`) cannot post; threads are flattened to two levels (root + replies with `replyToUserId`).

## 6. Key flows

**Auth.** Register → hashed password, verification mail (24 h token) and a session. Session cookie = 256-bit random token
(`__Host-` prefix when HTTPS), only its SHA-256 is stored. Uploading, commenting, reporting and channel creation require
a verified e-mail. Password change/reset revokes other sessions.

**Upload → playback.** `POST /api/upload` (tus) creates a `Video(AWAITING_UPLOAD)` after validating auth, e-mail
verification, size/type and daily quotas → bytes stream to private storage (`uploads/<videoId>`) → on finish the video
becomes `QUEUED` and a BullMQ job is added → worker: ffprobe, rendition ladder that **never upscales**, HLS packaging,
thumbnails, progress/stage written to `TranscodeJob` → `READY` (and auto-publish) → clients play
`/media/videos/<id>/hls/master.m3u8` through hls.js. Failed jobs retry with backoff; final failure marks the video `FAILED`
with a creator-visible reason; temp files are always cleaned.

**Media delivery.** `/media/[...key]` serves only allow-listed key shapes, enforces video visibility, supports Range and
ETag, and never exposes `uploads/…`. `MEDIA_DELIVERY=redirect` can switch segments to short-lived presigned URLs.

**Views & analytics.** The player posts a view after a playback threshold, then heartbeats. One `ViewEvent` per viewing
session de-duplicated per viewer/video window; watch time sums heartbeats. Studio statistics are SQL aggregations over real
events bucketed by **Asia/Tehran** day. Seeded demo events carry `source = SEED` and are flagged in the UI.

**Search.** Persian-aware normalization (Arabic ي/ك → ی/ک, ZWNJ → space, diacritics/tatweel stripped, digits → ASCII, آ/أ/إ → ا)
is applied identically at index and query time. `Video.searchVector` is a generated weighted `tsvector`
(title A, description/tags/channel C) with prefix queries; trigram similarity powers typo tolerance.

**Recommendations.** Transparent rule-based scoring (same category/tags/channel, recency decay, log-popularity, engagement
rate, followed channels, already-watched penalty). No ML is claimed.

## 7. Security model

* Server-side authorization for every mutation (`requireUser/Verified/Channel/Role`, `lib/permissions.ts`); UI hiding is cosmetic.
* CSRF: SameSite=Lax cookies + Origin/Sec-Fetch-Site validation on Route Handlers + Next's own check for Server Actions.
* Rate limiting (Redis, atomic Lua) on login, register, reset, comment, report, upload, view, etc.
* Zod validation everywhere; uniform error envelope; unknown errors logged with a correlation id, never leaked.
* Passwords: argon2id (19 MiB, t=2). Login timing equalized for unknown users. Generic auth errors (no enumeration).
* Uploads: type/size/quota validation, ffprobe verification, private bucket, no direct public access.
* Headers: CSP (prod), HSTS, nosniff, frame-ancestors, Permissions-Policy. Secrets only via environment (validated by Zod).
* Structured JSON logging (pino) with cookie/password redaction.

## 8. Persian / RTL strategy

`<html lang="fa" dir="rtl">`, Vazirmatn (self-hosted, SIL OFL). Tailwind **logical utilities only** (`ms-/me-/ps-/pe-/start-/end-`,
`text-start`), `rtl:` flips for directional icons, Radix `Direction.Provider` so every portal is RTL. User-generated text uses
`dir="auto"`; emails/URLs/handles are isolated with `.ltr-isolate`. Jalali dates and Persian/English numerals via
`lib/format.ts` (`useFormatter()` / `getFormatter()`); charts keep LTR time axes with Persian tick labels.

## 9. Delivery phases

1. Setup, design system, shell → 2. Public pages + watch UI → 3. Auth/profile/roles/channels → 4. Upload, storage, worker,
HLS → 5. Studio + video management → 6. Comments, follows, notifications, analytics → 7. Info pages, settings, monetization
→ 8. Tests, a11y, security review, deployment. Current progress: [`status.md`](status.md).
