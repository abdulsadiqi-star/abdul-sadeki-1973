# Staff panel (`/admin`)

Where moderators and administrators work: the reports queue, content moderation, accounts and roles, creator-program
requests, support tickets and the audit log. Persian/RTL, URL-driven filters (shareable links), 20 rows per page, and
**every rule enforced on the server** — the UI only mirrors it by hiding or disabling controls.

## Routes

| Route | Role | What it does |
| --- | --- | --- |
| `/admin` | MODERATOR+ | counters (open reports, pending requests, open tickets) and the latest audit rows the viewer may see |
| `/admin/reports`, `/reports/[id]` | MODERATOR+ | queue (status, target, reason, age, search, sort); detail with preview, reporter, sibling reports and history |
| `/admin/videos` | MODERATOR+ (force delete: ADMIN) | search/filter, take down / restore, force delete (+ `enqueueVideoCleanup`) |
| `/admin/channels`, `/[id]` | MODERATOR+ | verify / unverify, suspend / restore, live stats, history |
| `/admin/users`, `/[id]` | MODERATOR+ read, ADMIN acts | directory; role change, suspend / restore (sessions revoked at once) |
| `/admin/monetization`, `/[id]` | ADMIN | snapshot vs live statistics; approve / reject / suspend / reinstate |
| `/admin/verification`, `/[id]` | MODERATOR+ | requests with safe evidence links; approve (grants the badge) / reject |
| `/admin/support`, `/[id]` | MODERATOR+ | thread, staff reply (`isStaff`, status → `ANSWERED`), close / reopen |
| `/admin/activity` | MODERATOR+ scoped, ADMIN all | audit log: actor, target, type, Jalali date range |

## Layers

- `features/admin/policy.ts` — pure and unit-tested: capability → minimum role matrix, target rules, the state-machine tables
  (report, monetization, verification, ticket), audit visibility scope.
- `features/moderation/*` — services. One transaction per decision: conditional state change + side effects + **exactly one
  `ModerationAction` row** (`writeAudit(tx, …)`); the notification is sent after the commit. No `next/*` imports.
- `features/admin/actions/*` — thin Server Actions: `requireStaff(capability, limit)` (session → role from the DB → rate
  limit) → Zod (`schemas.ts`, Persian messages) → service → `revalidatePublicSite()`.
- `features/admin/queries/*` — read models (`server-only`), grouped counts instead of per-row queries.
- `components/admin/*` + `components/layout/admin-*` — UI. `ReasonDialog` is the one confirmation every decision goes through.

Every page calls `requireStaffPage(min)` itself (layouts are not re-rendered on client navigation).

## Rules (all in `policy.ts`, all server-side)

- Nobody acts on themselves (own videos, channel, account, comments). A moderator never acts on an administrator and
  never grants roles. The last active ADMIN can be neither demoted nor suspended: role/suspend operations lock all active
  admins + the target (`SELECT … FOR UPDATE`, id order) before checking, so two concurrent demotions cannot both pass.
- A reason (3–500 characters) is mandatory for takedown/delete/suspend/warn/dismiss/role change and for rejections;
  approvals may carry an optional note. Reasons are stored, audited and shown to the affected user.
- State machines are enforced with `UPDATE … WHERE status = <status read>`: a stale screen or double click gets a 409 and a
  Persian "reload" message, never a double decision.
- Comment status changes only go through `applyCommentStatus` (counters stay exact); the report resolution and the
  audit row commit in the same transaction (additive `tx` / `audit` options on that function).
- Resolving a report sets `status` (`ACTIONED` / `DISMISSED`), `resolution`, `handledById`, `handledAt`. "Close the other
  open reports about the same target" is an option on each decision.
- Suspending a user deletes their sessions in the same transaction. Suspending a channel hides it and its videos from the
  public queries (`publicVideoWhere`); the owner keeps access and is told why.

## Audit log

- `ModerationAction` rows are the only trail; sentences ("ناظر X ویدیوی «…» را از دسترس عمومی خارج کرد") are built at read
  time by `describeModerationAction` from the row, the joined names and `meta`, so renamed things stay readable.
- ADMIN sees everything. A moderator sees their own rows and content moderation; role changes, user suspensions and
  monetization decisions (`ADMIN_ONLY_ACTION_TYPES`) are hidden — in the list, the overview and every "history" panel.
- Workflow markers (opening a report: `OPEN → REVIEWING`; opening a request: `SUBMITTED → UNDER_REVIEW`) write **no** audit
  row; they are not decisions. They happen from a client effect, never from a GET.
- Approving a verification request writes `CHANNEL_VERIFY`; rejecting writes `VERIFICATION_REJECT`.

## Schema

One additive migration, `20261011134837_admin_audit_types_and_indexes`: enum values `CREATOR_WARN`, `VERIFICATION_REJECT`,
`TICKET_REPLY`, `TICKET_CLOSE`, `TICKET_REOPEN`, and lookup indexes on `Report(videoId|commentId|channelId)` and
`ModerationAction(videoId|commentId|targetUserId|type, createdAt desc)`.

## Limits (`features/admin/limits.ts`, per staff member)

`write` 120 / min · `sensitive` 30 / 10 min (force delete, role change, user suspend/restore, monetization) · `reply` 60 / 10 min.

## Notes

- Force delete is administrator-only: it removes the row (cascading comments, likes, reports) and queues file cleanup; when
  the queue is down the action still succeeds and says so.
- Monetization statistics next to a request show the snapshot taken at submission and the live numbers; `SEED` hours are
  labelled as such.
- The public media route caches a video's visibility for 10 s, so a taken-down video's files can stay reachable for up to
  10 s; pages and feeds are cut off at once (`revalidatePath`).
- Tests: `tests/unit/admin-*.test.ts`, `tests/integration/admin-*.test.ts` (real PostgreSQL; `admin-atomicity` installs a
  trigger that fails every audit insert and proves each mutation then rolls back as a whole, sessions included),
  `tests/e2e/admin.spec.ts` (DB fixtures via `tests/e2e/support/admin-fixtures-cli.ts`, because Playwright cannot import
  the Prisma client; run it with `E2E_BASE_URL=http://localhost:<port> pnpm exec playwright test tests/e2e/admin.spec.ts`).
  Demo backlog for screenshots: `pnpm exec tsx --env-file=.env tests/e2e/seed-admin-demo.ts [--force]`.
