# Engineering conventions

Read this before writing code. It is the contract between features; following it keeps everything consistent.

## 1. Commands

```bash
pnpm dev                 # Next.js dev server (Turbopack)            PORT=3001 pnpm dev   to change the port
pnpm dev:worker          # BullMQ worker (tsx watch)                  needs Redis + ffmpeg
pnpm typecheck           # next typegen && tsc --noEmit   (typed routes: <Link href> must be a real route)
pnpm lint                # eslint .                       (must be 0 errors; avoid warnings)
pnpm test:unit | test:integration | test:e2e | test   (integration needs PostgreSQL, see docs/testing.md)
pnpm build               # prisma generate && next build
pnpm db:migrate          # prisma migrate dev            (creates a migration)  — see §10
pnpm db:seed             # categories + demo accounts
node scripts/screenshot.mjs / /login --viewports=desktop,mobile --theme=dark --as=sara@tamashagah.test
```

## 2. Layering and ownership

```
src/app/**                 routes only: fetch via features/*, render components. No business logic.
src/features/<name>/       schemas.ts (zod) · queries.ts (read, server-only) · actions.ts ('use server') · service.ts · components/
src/components/ui/         primitives (do not fork; extend via className)
src/components/<area>/     shared composite components
src/lib/                   infrastructure (see §3)
worker/                    background jobs (imports lib + features/*/service.ts only)
```

* Put new code in your feature folder. **Do not edit files owned by another feature**; if you need a change, add a small
  well-named export in a file you own, or note it in your final report.
* Shared files that need extra care (touch minimally, never reformat): `prisma/schema.prisma`, `package.json`,
  `src/app/globals.css`, `src/components/layout/*`, `src/lib/*`.
* A page file is `export default async function Page({ params, searchParams })` — **both are Promises in Next 16**.
* Route handlers use `apiHandler` (see §5). Server Actions live in `features/*/actions.ts` and use `runAction`.

## 3. Shared infrastructure (use it, do not re-implement)

| Need | Import | Notes |
| --- | --- | --- |
| Config | `env` from `@/lib/env` | Zod-validated, lazy. Never read `process.env` directly. |
| DB | `db` from `@/lib/db` | Prisma 7. Raw SQL: quote camelCase identifiers (`"Video"."viewCount"`), cast `count(*)::int`, `sum(x)::float8`. |
| Redis / queues | `getRedis()`, `getQueue()`, `enqueueVideoProcessing()` | `src/lib/redis.ts`, `src/lib/queue` |
| Storage | `getStorage()`, `keys`, `isPublicMediaKey` from `@/lib/storage` | Build keys only with `keys.*`. fs and S3 share one interface. |
| Logging | `logger` from `@/lib/logger` | JSON (pino). `logger.error({ err, videoId }, 'msg')`. |
| Errors | `Errors.*`, `AppError`, `runAction`, `ActionResult` from `@/lib/errors` | User-facing messages are Persian. |
| Validation | `parse`, `parseJsonBody`, `parseSearchParams` from `@/lib/validation` | Import `@/lib/zod-fa` in every `schemas.ts` (Persian Zod messages). |
| Rate limit | `enforceRateLimit(bucket, id, limits.x)` from `@/lib/rate-limit` | Add a rule to `limits` when needed. |
| Auth | `getCurrentUser`, `toActor` (`@/lib/auth/session`); guards in `@/lib/auth/guards` | See §5. |
| Permissions | `canViewVideo`, `canManageVideo`, … `@/lib/permissions` | Pure functions, unit-tested. |
| Video visibility | `publicVideoWhere`, `linkableVideoWhere`, `PUBLIC_VIDEO_SQL` | `@/features/videos/visibility` — never hand-write these conditions. |
| Video cards | `videoCardSelect`, `toVideoCard`, `VideoCardData` | `@/features/videos/card` — every list uses this shape. |
| Notifications | `notify`, `notifyMany` from `@/features/notifications/service` | Best-effort, never throws. Runtime-agnostic (worker may use it). |
| Persian text | `normalizeUserText`, `buildVideoSearchFields`, `buildTsQuery`, `toPersianDigits` … `@/lib/persian` | Always normalize user text before storing. |
| Formatting | `useFormatter()` (client) / `await getFormatter()` (server) | Digits fa/en, Jalali dates, compact numbers, durations, bytes, relative time. Never `toLocaleString` ad hoc. |
| Jalali / Tehran time | `@/lib/jalali` | Day buckets for analytics use Asia/Tehran (SQL: `date_trunc('day', x AT TIME ZONE 'Asia/Tehran')`). |
| Labels | `labels`, `common` from `@/lib/i18n/fa` | Enum → Persian label maps. Add new shared labels here. |
| Media URLs | `mediaUrl(key)`, `hlsMasterUrl(id)` from `@/lib/media-url` | |
| IDs | `newVideoId()`, `randomToken()`, `sha256Hex()` from `@/lib/ids` | |
| Like / follow / watch-later | `setLike`, `setFollow`, `setWatchLater`, `getViewerState` (`@/features/engagement/service`); actions `toggleLikeAction` etc.; `LikeButton`, `FollowButton`, `SaveButton` (`@/features/engagement/components/*`) | Idempotent, counters in the same transaction. Use these everywhere (watch page, shorts, channel, library). |
| Recommendations | `getRelatedVideos`, `getTrendingVideos` from `@/features/recommendations` | Signatures are stable; internals are improved by the discovery feature. |
| Image uploads | `processImage`, `readImageFile`, `sniffImageType` from `@/lib/images` | sharp: validates by decoding, strips EXIF, re-encodes (webp/jpeg). Never store the original bytes. |
| Jalali date inputs | `JalaliDatePicker`, `JalaliDateTimeInput` from `@/components/forms/jalali-date-picker` | Values are `Date` instants (start of Tehran day / exact time). |
| Confirmations | `ConfirmDialog` from `@/components/confirm-dialog` | Async-aware destructive confirmation. |
| Test helpers | `createUser/createChannel/createVideo(state)/createCategory`, `loginAs(userId)`, `requestContext`, `lastTokenFor` | `tests/helpers/*` |

`src/lib/{env,db,redis,logger,storage,queue,format,persian,jalali,ids,errors,rate-limit,validation,permissions,media-url}`
and `features/notifications/service.ts` are shared with the worker: **no `next/*`, no `server-only` imports there.**

## 4. Server / client boundaries

* Default to Server Components. Add `'use client'` only for state, effects, event handlers, browser APIs.
* **Never pass functions or components as props from a Server Component to a Client Component** (e.g. a Lucide icon
  component). Pass JSX (`icon={<Icon />}`) or serializable data. `EmptyState`/`StatCard` are server-safe and take
  an icon *component*, so render them from Server Components; client components should receive elements.
* Dates crossing the boundary are ISO strings. BigInt never crosses (convert with `toNumber`).
* Client data fetching: TanStack Query hitting `GET` route handlers; mutations: Server Actions via `useTransition`
  or `useMutation`. Always handle loading, empty and error states.

## 5. Mutations, auth and security

```ts
// features/comments/actions.ts
'use server';
export async function postCommentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await requireVerifiedUser();                       // throws AppError
    const data = parse(postCommentSchema, input);                   // throws AppError(VALIDATION)
    await enforceRateLimit('comment:user', user.id, limits.comment);
    const video = await db.video.findUnique({ where: { id: data.videoId }, select: {...} });
    if (!video || !canViewVideo(toActor(user), video)) throw Errors.notFound();   // never leak existence
    ...                                                             // re-check permissions on the SERVER
  });
}
```

* **Never trust the client**: re-derive ownership/role/visibility from the database in every action and handler.
  Hiding a button is not authorization.
* Pages/layouts: `requirePageUser()`, `requirePageChannelUser()`, `requirePageRole('MODERATOR')` (redirect).
  Actions/handlers: `requireUser()`, `requireVerifiedUser()`, `requireChannelUser()`, `requireRole()` (throw).
* Route handlers: `export const POST = apiHandler(async (req, { params }) => { … return {…} })`. Non-GET requests get the
  Origin check automatically. Return plain objects (→ JSON) or a `Response`.
* Return `ActionResult` (`{ ok: true, data } | { ok: false, code, message, fieldErrors? }`). Throw `Errors.*` for expected failures.
* Public lists must use `publicVideoWhere`; deletes/edits must check `canManageVideo`/ownership; moderation checks `canModerateComments`.
* Rate-limit every write that a bot could spam. Validate every input with Zod (max lengths!).
* Secrets only through `env`. Never log tokens, passwords, cookies.

## 5b. Data rules

* Denormalized counters (`Video.viewCount/likeCount/commentCount`, `Channel.followerCount`, `Comment.replyCount`) are updated in the
  **same transaction** as the row they summarize. The worker reconciles them periodically.
* Offset pagination for studio tables (`page`, `pageSize` ≤ 50, total count), cursor pagination for feeds/comments/notifications.
* Every list query has an `orderBy` that is total (add `id` as a tie-breaker).
* Use indexes that exist in the schema; if you add a query pattern, add the index in a migration.
* Metrics must come from persisted events. Seeded demo events have `source = 'SEED'`; real ones `'REAL'`. Show the seed notice
  when a studio range includes SEED rows.

## 6. UI rules (RTL + Persian)

1. **Logical properties only**: `ms-* me-* ps-* pe-* start-* end-* text-start text-end border-s border-e rounded-s rounded-e`.
   Forbidden: `ml-* mr-* pl-* pr-* left-* right-* text-left text-right border-l border-r rounded-l rounded-r float-*`.
   (Exception: centering with `left-1/2 -translate-x-1/2`, and `dir="ltr"` islands.)
2. Prefer `gap-*` over `space-x-*`. Flip directional icons with `rtl:rotate-180` or use `ChevronEnd/ChevronStart`
   (`@/components/icons`). Media-control icons (play ▶, skip) are NOT flipped.
3. All copy is Persian. Numbers/dates/durations only through the formatter (Persian digits by default, user can switch).
4. User-generated text (titles, comments, names, descriptions) gets `dir="auto"` (and `className="user-text"` for blocks).
   Emails, URLs, handles, code → `className="ltr-isolate"`.
5. Charts keep an LTR time axis (oldest → newest, left → right) with Persian tick labels; wrap in `dir="ltr"`.
6. Use the shared components: `PageHeader`, `EmptyState`, `ErrorState`, `StatCard`, `Pagination`, `VideoCard`,
   `VideoGrid`, `ChannelAvatar`, `VerifiedBadge`, `Badge`, `Alert`, `Tabs variant="pills|underline|segmented"`, `Dialog`,
   `AlertDialog` (confirmations), `DropdownMenu`, `Sheet`, `Form*`.
7. Every data view needs: loading skeleton (`loading.tsx` or `Skeleton`), empty state, error state.
8. Toasts via `import { toast } from 'sonner'`. Forms: React Hook Form + `zodResolver(schema)` + `applyServerErrors(form, result)`
   + `<FormError />`.
9. Respect both themes: use tokens (`bg-card text-muted-foreground border-border …`), never raw hex/`bg-white`/`text-gray-*`.
10. Responsive: design mobile-first; the content must work at 360 px without horizontal scroll.

## 7. Accessibility checklist

Semantic landmarks (`header/nav/main/aside`), one `h1` per page, labelled controls (`aria-label` in Persian for icon buttons),
visible focus (`focus-visible:ring-*` is built into primitives), dialogs via Radix (focus trap), `aria-live` for async status,
`aria-current="page"` in navigation, `aria-pressed` for toggles, no color-only meaning, respect `prefers-reduced-motion`,
sufficient contrast (tokens are AA), keyboard operability for every interaction (player shortcuts included).

## 8. Testing

* Pure logic → `tests/unit/*.test.ts`. DB-backed behaviour (actions, queries, permissions) → `tests/integration/*.test.ts`
  using `tests/helpers/factories.ts` and `requestContext`. UI logic → `tests/components`. User journeys → `tests/e2e`.
* A feature is **not done** without tests for: authorization (who can/can't), validation failures, and the happy path.
* Time-based or async work: poll with a deadline, never fixed sleeps.

## 9. Definition of done for a feature (verify, don't assume)

1. `pnpm typecheck && pnpm lint` clean · relevant tests added and green · `pnpm build` passes.
2. Run the app (`pnpm build && PORT=… pnpm start`) and **look at it**: screenshots at desktop and mobile
   (`scripts/screenshot.mjs`), light and dark, with seeded/own data. Fix what is ugly or broken.
3. Exercise the real flow in a browser (Playwright) — at least one e2e spec per feature area.
4. No `ComingSoon` left on routes you own; no dead buttons; no fake numbers.
5. Commit with a clear message; report what was verified and what was NOT.

## 10. Database changes

Prefer **no** schema changes. If unavoidable: edit `schema.prisma`, run
`pnpm prisma migrate dev --name <what> --create-only`, hand-check the SQL, apply with `pnpm db:deploy`, run
`pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (must report no
difference), and mention the change prominently in your report. Never edit an existing migration.

## 11. Git

Work on your branch, small meaningful commits (`feat(studio): …`, `fix(upload): …`, `test(comments): …`). Do not rewrite
shared history. Do not commit `.env`, `.data/`, `node_modules`, `src/generated`, screenshots.
