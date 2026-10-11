# Implementation status

Legend: ✅ done & verified · 🟡 in progress · ⬜ not started · 🧩 placeholder (`ComingSoon`) — must be replaced.

## Foundation (Phase 1 + auth part of Phase 3)

| Area | State | Verified by |
| --- | --- | --- |
| Prisma schema (all domain models, FTS generated column, trigram indexes) + migration | ✅ | `migrate diff` = no drift, integration tests |
| Env validation, db/redis/logger/errors/rate-limit/origin/api wrapper | ✅ | unit + integration tests |
| Persian text normalization, Jalali calendar, numeral/date/size formatters | ✅ | 79 unit tests |
| Storage drivers (fs, S3), media delivery route (Range/ETag/visibility) | ✅ (S3 path verified in the media phase) | unit tests for keys/range; route smoke |
| Design tokens (light/dark), Vazirmatn, 30 RTL-hardened UI primitives | ✅ | screenshots, e2e |
| App shell: header, collapsible right sidebar, mobile nav, studio shell, notifications bell, user menu | ✅ | screenshots desktop/mobile, e2e |
| Auth: register/login/logout, e-mail verification, reset, change password, sessions, roles, channel creation | ✅ | 37 integration tests + 16 e2e (desktop+mobile) |
| Proxy gate for /studio and /admin (deep-link `next=`) | ✅ | e2e |
| Core engagement (like/follow/watch-later services, actions, buttons) | ✅ | 15 integration tests |
| Image sanitizing (`lib/images`), Jalali date/time picker, ConfirmDialog | ✅ | unit + component tests |
| Recommendations: public-only related/trending (foundation version) | ✅ | integration test |

## Routes

| Route | State | Owner |
| --- | --- | --- |
| `/` | 🟡 foundation version (latest + most viewed) | discovery |
| `/login` `/register` `/forgot-password` `/reset-password` `/verify-email` | ✅ | foundation |
| `/studio` (onboarding: create channel) | ✅ onboarding · 🧩 dashboard | insights |
| `/search`, `/category/[slug]`, `/channel/[handle]`, `/shorts`, `/library`, `/library/[tab]` | 🧩 | discovery |
| `/watch/[id]` | 🧩 | watch |
| `/studio/upload`, `/studio/videos`, `/studio/videos/[id]/edit` | 🧩 | media |
| `/studio/comments`, `/studio/notifications` | 🧩 | watch (engagement) |
| `/studio/analytics`, `/studio/settings`, `/studio/monetization`, `/admin` | 🧩 | insights |
| `/about` `/help` `/help/tickets` `/apps` `/verification` `/copyright` `/terms` `/privacy` | 🧩 | discovery (info) |
| `/media/[...key]` | ✅ | foundation (media refines) |
| `/api/notifications`, `/api/notifications/read` | ✅ | foundation |
| upload (tus), worker, HLS | ⬜ | media |

## Known gaps to close before release

See `known-limitations.md` (created in the final phase). Every `ComingSoon` usage must be gone.
