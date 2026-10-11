# Watch: page, player, views, comments, notifications

Owner area: `/watch/[id]`, the HLS player, view tracking, playlists / reports / share, viewer comments, the creator
comment moderation page `/studio/comments` and the notifications center `/studio/notifications`.

## What it does
- **`/watch/[id]`** (`src/app/(site)/watch/[id]`): player, title, channel row (follow), like / share / save / playlist /
  report bar, expandable description (safe links + hashtags), tags, comments, related videos. `generateMetadata`
  (title, OpenGraph, canonical) + `VideoObject` JSON-LD. Owner / moderator get a status notice (draft, scheduled,
  private, unlisted, taken down) and, while not READY, a live processing panel (polls `/api/videos/[id]/status`).
- **Hidden means 404, never 403.** `canViewVideo` decides in `features/watch/access.ts`; the check lives in
  `watch/[id]/layout.tsx` (outside `loading.tsx`) so the HTTP status really is 404 for private, draft, taken-down,
  unfinished and unknown videos, and the view / heartbeat / comment endpoints answer the same.
- **Player** (`src/components/player`): hls.js (dynamic import) with a native-HLS fallback; RTL seek slider (fills
  right to left; ← is forward), speed, quality (Auto + renditions), subtitles (our own overlay), fullscreen, PiP,
  keyboard shortcuts (`?` lists them; matched by `event.code`, so they work on the Persian layout and never fire while
  typing), double-tap ±10 s, resume, friendly errors (retry with back-off, "browser cannot decode this").
  Root data attributes (`data-player-state`, `data-playing`, `data-quality`, `data-active-height`, `data-captions`,
  `data-fullscreen`) exist for tests.
- **Comments**: list (newest first, keyset pagination), optimistic posting, replies (one level), delete / report.
  Studio: tabs with counts (all, spam, pending, replies), search, bulk actions, inline creator reply, approve /
  reject / spam / delete, block / unblock commenters ("کاربران هرزنویس").
- **Notifications center**: all / unread filter, mark one / all read, deep links; copy for every `NotificationType`
  (`features/notifications/types.ts`; the type is an exhaustive `Record`, so a new type fails the build until it has copy).

## Data flow: honest views
1. The player counts only time the video really played (`play-time.ts`). After 5 s (25 % for videos < 20 s) it POSTs
   `/api/videos/[id]/view { played, position, referrer }` once.
2. The server (`view-service.ts`) re-checks the threshold, drops bots, and keeps **one `ViewEvent` per viewer + video per
   30 minutes** (advisory lock; the viewer is the HttpOnly `tg_viewer` cookie, only its HMAC is stored, plus the user id
   when signed in). A repeat inside the window returns `{ counted: false, reason: 'duplicate', viewId }`.
3. Every ~15 s of playing time (and via `sendBeacon` on pause / hide / unload) the player POSTs
   `/api/videos/[id]/heartbeat { viewId, delta, position }`. **The delta is never trusted**:
   `min(reported, 20, wall-clock since the previous beat + 1 s slack)`; foreign view ids add nothing.
4. Signed-in viewers get `WatchHistory` upserted (position, watch seconds, completed ≥ 90 %); anonymous resume lives in
   `localStorage` (newest of server / local wins; positions < 5 s or within the last 5 % / 8 s restart from 0; `?t=` wins).
Pure rules + constants: `features/watch/view-rules.ts` (shared by server and client, unit-tested).

## Comment rules (server-side, `features/comments/service.ts`)
- Channel `commentsMode` OPEN / APPROVAL_REQUIRED / DISABLED and `Video.commentsEnabled`; blocked users (`ChannelBlock`)
  and unverified e-mails cannot post; the channel owner is exempt from holds.
- Heuristics (`spam.ts`): > 2 links, contact details or flooding → PENDING; the same text (≥ 12 characters) again within
  10 minutes, scam patterns, repeated-word stuffing → SPAM. Counters (`commentCount`, `replyCount`) change only through
  `applyCommentStatus` (`moderation-core.ts`) or in the same transaction as an APPROVED insert.
- Notifications: `NEW_COMMENT` / `COMMENT_PENDING` to the owner, `COMMENT_REPLY` to the replied-to user,
  `COMMENT_APPROVED` to the author.

## Endpoints
| Endpoint | Purpose |
|---|---|
| `POST /api/videos/[id]/view`, `POST /api/videos/[id]/heartbeat` | view counting (above); 404 for hidden videos |
| `GET /api/videos/[id]/status` | processing progress for owner / moderator |
| `GET /api/videos/[id]/playlists` | the viewer's playlists + membership of this video |
| `GET /api/comments?videoId&cursor&limit`, `GET /api/comments/[id]/replies` | comment pages (viewer-aware: own pending shown) |
| `GET /api/notifications`, `POST /api/notifications/read` | bell + center (existing, extended with keyset pagination) |
Mutations are Server Actions: `postCommentAction`, `deleteCommentAction`, `moderateCommentAction`,
`bulkModerateCommentsAction`, `creatorReplyAction`, `blockCommenterAction` / `unblockCommenterAction`,
`reportVideoAction` / `reportCommentAction`, the playlist actions.

## Limits
Comment ≤ 1 000 characters; pages of 20 comments / 10 replies; studio 20 rows, bulk ≤ 100. Rate limits: comments
12 / 5 min per user, reports 10 / h (shared catalogue); own constants in `features/watch/limits.ts`: view 6 / min per
viewer + video, heartbeat 30 / min per viewer (1 200 / min per IP flood guard), status poll 60 / min.

## Decisions worth knowing
- Pagination is keyset everywhere (Prisma `cursor` + `skip: 1` silently drops rows when the cursor row stops matching).
- Linkify accepts only `http(s)` URLs (`rel="nofollow noopener noreferrer ugc"`); user text is `dir="auto"`; JSON-LD is escaped.
- Persian copy for the player lives in `components/player/labels.ts`, comments / reports / playlists next to their
  components (the shared `labels` and `limits` catalogues were not extended).

## Testing and fixtures
- `scripts/lib/hls-fixture.ts` / `scripts/watch-fixture.ts` create real HLS videos (ffmpeg, 2 renditions, fa + en
  subtitles). **Default codec is VP9 + Opus in fMP4 because the Chromium bundled with Playwright has no H.264 / AAC
  decoder**; `--codec=h264` writes the production-style TS ladder for real browsers. `scripts/watch-demo.ts` seeds demo
  videos, comments, likes and follows (`pnpm exec tsx --conditions=react-server --env-file-if-exists=.env scripts/watch-demo.ts`).
- Unit: view rules, spam heuristics, linkify, player utils, play-time, comment cache, notification copy. Integration (real
  DB): views, comments, studio moderation, reports, playlists, notifications. E2E: `tests/e2e/watch.spec.ts` (desktop + mobile).
- Run unit tests with `APP_URL=http://localhost:3000 pnpm test:unit` when `.env` points elsewhere (a foundation test
  hard-codes that origin).
