# Discovery: home, search, categories, channels, shorts, library, information pages, SEO/PWA

Code: `src/features/{recommendations,search,discovery,channels,library,support,info}`, routes under `src/app/(site)/…`, components in
`src/components/{channel,search,shorts}` and `src/components/layout/search-box.tsx`. Demo data: `scripts/seed-discovery.ts`.

## Recommendations (rule-based, no machine learning)
Pure scoring in `recommendations/scoring.ts` (weights are exported constants; unit-tested, deterministic for a given `now`).
Score = Σ weight × signal (each in 0..1) − penalty. Signals: log-popularity (1 M views = 1), recent activity (views + 5 × likes in the window,
log scale), recency (half-life decay), engagement (smoothed like rate), tag overlap (Jaccard after search folding), category / channel / follow.

| List | Weights |
|---|---|
| Related (`getRelatedVideos`) | tags .25, category .20, popularity .12, trending .10, recency .10 (21 d), same channel .10, engagement .08, followed .05, **watched −.40** |
| Trending (`getTrendingVideos/Ids`) | recent activity .55 (window 7 d, 14 d for categories), recency .20 (4 d), popularity .15, engagement .10 |
| For you (`getPersonalizedFeed`) | category .22, tag .20, followed .15, channel .10, trending .10, recency .10 (14 d), popularity .08, engagement .05, **watched −.40** |

At most 3 videos per channel per list (back-filled only if the list would be short). Hidden videos never appear: every query uses
`publicVideoWhere` / `PUBLIC_VIDEO_SQL`; cached rankings hold **ids only** and cards are hydrated fresh (`hydrateCards`), so a video that
becomes hidden disappears at once. Candidate pool for "hot": the 300 most-viewed + 200 newest public videos of the kind/category, window
activity counted with one `ViewEvent(videoId, createdAt)` probe per candidate (≈ 7 ms vs ≈ 280 ms for a whole-window `GROUP BY` on 1.5 M events).
Known limit: a long-tail video outside both pools cannot trend. Caches (`unstable_cache`, 60 s, tag `videos`): home ids, trending ids, category
pages (ids per category/tab/page + total), sitemap files (1 h), about numbers (5 min). Without `now`, `getTrendingVideos` uses the cache.

## Search (`/search`, `/api/search/suggest`)
PostgreSQL FTS (`simple` config, weighted generated `searchVector`) + `pg_trgm`. Query and text are folded identically (`normalizeSearchText`: Arabic
ي/ك → ی/ک, ZWNJ → space, diacritics removed, Persian/Arabic digits → ASCII). Ladder: AND with prefix match → OR (≥ 2 words) → typo-tolerant
(`word_similarity` ≥ 0.5, min 3 letters) when fewer than 5 results. Rank = .55 ts_rank_cd (title weighted highest) + .20 title similarity + .15
popularity + .10 recency (90 d half-life). Filters: type, date, duration (short < 4 min, medium 4–20, long > 20), category; sorts relevance /
newest / views; pages of 20 (count capped at 1000). Only `PUBLIC_VIDEO_SQL` rows. Suggestions: ≥ 2 letters, ≤ 8 items, rate-limited (60 / min / IP).
Header box is an ARIA 1.2 combobox (↑ ↓ Enter Esc, `aria-activedescendant`, live count); highlighting returns text segments, never HTML.

## Pages and contracts
- Home: chips, continue watching (needs ≥ 5 s progress), followed channels, for you, trending, latest, shorts, three busiest category rows.
- Category: tabs new / views / hot (96 videos max), 24 per page, shorts rail on page 1. Channel: tabs videos / shorts / playlists / about.
- Shorts: keyset feed (`publishedAt, id`), one active player at a time, preload of the next, deep link `?v=<id>`; needs `hlsMasterKey`.
- Library `/library/*` (login required) and playlists `/playlist/[id]`: a playlist shows only videos the viewer may open (the owner also sees their own
  private ones); the rest are only counted as "unavailable". A private playlist of someone else is a plain 404.
- Support: `SupportTicket`/`TicketMessage` (user reply re-opens; staff reply = `isStaff`, status ANSWERED), copyright notice = ticket + `Report(COPYRIGHT)`
  in one transaction, `VerificationRequest` (one open request per channel under a row lock; requirements: verified e-mail, avatar + 20-char
  description, channel ≥ 30 days, ≥ 3 public videos). The admin panel processes the same rows. Limits: tickets 5 / h (`limits.ticket`), replies 20 / h,
  copyright 5 / day, verification 3 / day (`features/discovery/limits.ts`).
- Information pages: about (numbers counted in the DB; demo-data notice when `ViewEvent.source = SEED` exists), help (34 questions built from the real
  limits, Persian-aware filter, FAQPage JSON-LD), apps (real install button via `beforeinstallprompt`, store apps shown as "به‌زودی" labels),
  terms / privacy / copyright (**templates; the operator must review them with a lawyer** — each page says so and lists what to fill in).
- SEO/PWA: `/sitemap.xml` index → `/sitemap/<n>.xml` (static+categories, channels, videos, 5000 URLs per file), `robots.txt`, `manifest.webmanifest`
  (icons from `scripts/make-icons.mjs`), `public/sw.js` (offline page only, caches nothing else), canonical + OG/Twitter on category / channel / search,
  JSON-LD (WebSite, BreadcrumbList, Organization, FAQPage, VideoObject via `features/discovery/video-object.ts` for the watch page to reuse).

## Demo data and verification
`pnpm exec tsx --env-file=.env scripts/seed-discovery.ts` (idempotent; `--regenerate-media`; `SEED_HLS_CODEC=vp9` for Chromium without H.264). Every video has a real
HLS clip (6–8 s, 360p + 240p; shorts 5 s portrait) rendered from its poster artwork; stored duration/size are the real values, so demo durations are short
and the search duration filter's medium/long buckets are empty in demo data. Full run ≈ 33 s on 4 cores (re-run ≈ 5 s).
Tests: `tests/unit/{recommendation-scoring,search,faq,support-rules,video-object}`, `tests/integration/{recommendations,search,search-api,library,support,discovery-pages}`,
`tests/components/discovery-components`, `tests/e2e/discovery.spec.ts` (needs the seed; `E2E_BASE_URL=… pnpm exec playwright test tests/e2e/discovery.spec.ts`).

## Known gaps
No server-side "load more" on category pages (numbered pagination instead); watch-page related list and VideoObject JSON-LD are the watch owner's; the shell
(layout) weighs ≈ 130 KB of HTML + flight data on every page; install prompt and service worker are verified in headless Chromium only.
