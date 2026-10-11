# Insights: studio dashboard, analytics, settings, monetization

Creator-facing numbers, built only from persisted rows. Owners: `/studio`, `/studio/analytics`, `/studio/settings`,
`/studio/monetization`, `src/features/{studio,analytics,settings,monetization}`, `src/lib/analytics`, `src/components/{studio,analytics}`.

## Routes and what they show

| Route | Content |
|---|---|
| `/studio` | Onboarding block (unchanged), four stat cards, tips, latest videos, latest comments with quick approve, notifications, upload alerts, first-upload call to action |
| `/studio/analytics` | Range + granularity controls, metric cards with % change, multi-series chart, per-video table, top videos, devices, sources, follower growth, CSV export. `?video=<id>` scopes everything to one video |
| `/studio/settings` | Account tab (name, numerals, avatar, e-mail status, password, sessions, e-mail preference); channel tab (name, description, links, avatar, banner, comment policy, default visibility). Works without a channel (account tab only) |
| `/studio/monetization` | Eligibility with progress, application flow and timeline, 12 Jalali-month history, honest revenue empty state. Design of the missing billing part: `docs/monetization-architecture.md` |

## Data flow

`page.tsx` (server) → `features/analytics/queries.ts` (SQL, server-only) → `AnalyticsOverview` (plain JSON) → client components that only
render (`AnalyticsFrame` navigates with query strings; the chart is a client island rendered after hydration). Range parsing lives in
`lib/analytics/{time,ranges,series}.ts` as pure functions; the URL is the only state (`?range=30d|7d|90d|this-month|last-month|custom&from&to&granularity&video`).

Decisions worth knowing:

- **Events, not counters.** Every figure is aggregated from `ViewEvent`, `VideoLike`, `Comment` (approved), `FollowEvent`; the only denormalised counter read is
  `Channel.followerCount` (the *current* total, maintained with the follow rows). A counter cannot be bucketed by day or split into real and sample.
- **Tehran days.** Prisma stores `timestamp(3)` as UTC *without* a zone. `date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Tehran')` (the snippet in the
  brief) treats the column as Tehran time and shifts every bucket by 3.5 hours. Correct: `(col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tehran'`, and bounds
  as `(${iso}::timestamptz AT TIME ZONE 'UTC')`. Both live in `features/analytics/sql.ts`; `analytics-queries.test.ts` fails on the naive form.
- **Day keys** are Gregorian `YYYY-MM-DD` strings of Tehran days. JS uses a fixed +03:30 offset (Iran has no DST since 2022); it is cross-checked against ICU
  and SQL in `analytics-time.test.ts`. Ranges are inclusive day ranges (`[from, to)` as instants); the previous period is the same length right before.
- **One scan per table** over `[previous.from, to)`, split into current and previous in JS; gap-filled in JS. Distinct viewers are not additive, so they get
  their own queries (period level, and per bucket for monthly granularity).
- **Real vs sample.** `ViewEvent.source`/`FollowEvent.source` is `REAL` or `SEED`. Overviews return `{ real, seed }` counts; the notice «بخشی از داده‌های این بازه
  نمونه‌ی آزمایشی است» shows only when SEED rows fall in the range and `SHOW_SEED_DATA_NOTICE` is on. Monetization eligibility and history ignore SEED.
- **Custom ranges** are Tehran days, capped at 731 days and clamped to today. Granularity is daily or Jalali-month (partial months at the edges are clipped).
- **Owner only.** Channel and user ids come from the session; no parameter can select another channel. A foreign `?video=` is a 404.

## Endpoints and actions

| Where | What | Guard |
|---|---|---|
| `GET /api/studio/analytics/export?type=series\|videos&range…&video` | CSV (UTF-8 BOM, CRLF, formulas neutralised), `no-store` | session channel; 20 / min |
| `POST,DELETE /api/studio/account/avatar` | user avatar 400×400 webp | session, Origin, 10 / 10 min |
| `POST,DELETE /api/studio/channel/{avatar,banner}` | channel avatar 400×400, banner 1920×480 webp | channel owner, Origin, 10 / 10 min |
| `saveAccountSettingsAction`, `updateChannelAction`, `revokeSessionAction` | settings (Zod `.strict()`, keeps `searchName` in sync) | session; 30 / min |
| `approveCommentAction` | dashboard quick approve (`canModerateComments` + `applyCommentStatus`) | 60 / min |
| `saveApplicationDraftAction`, `submitApplicationAction`, `withdrawApplicationAction` | application flow (advisory lock per channel) | 30 / hour |

Uploads: bounded streaming multipart read, magic-byte sniffing and re-encoding via `lib/images.processImage`; the swap runs under `SELECT … FOR UPDATE`, and the replaced
file is deleted. Limits are defined in each feature's `limits.ts`.

## Dev helper and tests

- `scripts/seed-demo-analytics.ts` writes **SEED-only** view and follow events (`--channel`, `--days`, `--total`, `--create-videos`, `--clear`, `--clear-only`). Run with
  `pnpm exec tsx --conditions=react-server --env-file=.env scripts/seed-demo-analytics.ts --channel=<handle> --total=200000`. It refuses to run with `NODE_ENV=production` unless `--force` is given.
- Unit: `tests/unit/{analytics-*,user-agent,settings-schemas,monetization}.test.ts`. Integration (real database): `tests/integration/{analytics-queries,analytics-export,studio-dashboard,settings,monetization}.test.ts`.
  E2E: `tests/e2e/insights.spec.ts`. Fixtures: `tests/helpers/insights-fixtures.ts` (independent oracle for Tehran days).

## Known limits

`User.notifyByEmail` is stored but nothing sends notification e-mails yet. Renaming a channel does not re-index its videos' `searchBody`. Followers gained cannot be attributed
to a video (no per-video follow event). Likes and comments have no `source` column, so the seed script does not create them.
