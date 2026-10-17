# تماشاگاه — پلتفرم اشتراک‌گذاری ویدیوی فارسی

یک پلتفرم واقعی (نه ماکت) برای بارگذاری، پردازش، پخش و مدیریت ویدیو؛ کاملاً فارسی و راست‌به‌چپ، با تاریخ شمسی، حالت روشن/تیره،
ریسپانسیو و دسترس‌پذیر. برند و لوگو اورجینال است (الهام از ساختار پلتفرم‌های ویدیویی، بدون کپی‌کردن برند یا محتوای کسی).

## امکانات

* **بیننده:** صفحه‌ی اصلی (داغ‌ترین‌ها، جدیدترین‌ها، شورتس، دسته‌ها)، جست‌وجوی تمام‌متن فارسی با پیشنهاد، دسته‌بندی، کانال، شورتس، کتابخانه (تاریخچه، لایک‌شده‌ها، بعداً می‌بینم، لیست‌های پخش)، پخش‌کننده‌ی HLS با کیفیت/سرعت/زیرنویس/میان‌بر/ادامه‌ی پخش، لایک، دنبال‌کردن، دیدگاه و پاسخ، گزارش، اشتراک‌گذاری.
* **سازنده (استودیو):** داشبورد، بارگذاری resumable (tus) با پیشرفت و pause/resume، پردازش FFmpeg (نردبان کیفیت HLS، پوستر)، مدیریت ویدیوها (شبکه‌ی ۶ ستونه، تب‌ها، عملیات گروهی)، ویرایش (زمان‌بندی شمسی، پوستر، زیرنویس)، مدیریت دیدگاه‌ها، اعلان‌ها، آمار از رویدادهای ذخیره‌شده (نمودار، CSV)، تنظیمات حساب و کانال، درآمدزایی (فقط معماری؛ هیچ پولی ساخته نمی‌شود).
* **پنل مدیریت (`/admin`):** گزارش‌ها، takedown، کانال‌ها و کاربران، نقش‌ها، درخواست‌های درآمدزایی و تیک تأیید، پشتیبانی، گزارش فعالیت‌ها؛ همه با اجرای سروری ماتریس دسترسی و ثبت audit تراکنشی.
* **صفحه‌های اطلاعاتی:** درباره، راهنما و تیکت پشتیبانی، اپ‌ها (PWA)، تیک تأیید، کپی‌رایت، قوانین، حریم خصوصی؛ `robots.txt`، `sitemap.xml`، `manifest`.
* **زیرساخت:** Docker Compose، CI، آزمون‌های واحد/یکپارچگی/e2e/دسترس‌پذیری، ممیزی امنیتی ایستا، Caddy برای HTTPS.

## فناوری

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 + Radix · TanStack Query · React Hook Form + Zod · Recharts · hls.js ·
PostgreSQL 16 (FTS + `pg_trgm`) + Prisma 7 · Redis + BullMQ · S3 سازگار (RustFS برای توسعه) · FFmpeg/FFprobe · tus · Vitest · Playwright + axe.

## راه‌اندازی سریع (همه‌چیز در Docker)

```bash
cd tamashagah
node scripts/init-env.mjs                    # .env با رمزهای تصادفی
docker compose --profile app up -d --build   # postgres, redis, S3, mailpit, migrate, web, worker
```

سایت: <http://localhost:3000> · صندوق ایمیل آزمایشی: <http://localhost:8025> ·
سلامت: `curl localhost:3000/api/health?deep=1`.

اولین مدیر (ابتدا در سایت ثبت‌نام و ایمیل را تأیید کنید):

```bash
docker compose exec worker node dist/scripts/promote-user.mjs you@example.com admin
```

داده‌ی نمونه (فقط توسعه): `pnpm seed:demo` روی هاست (بخش بعد). جزئیات استقرار تولید با دامنه و HTTPS: [`docs/deployment.md`](docs/deployment.md).

## توسعه‌ی محلی

پیش‌نیاز: Node 22، pnpm 10 (`corepack enable`)، Docker (برای زیرساخت)، ffmpeg روی ماشین.

```bash
pnpm install
pnpm setup:env                 # .env + رمزهای تصادفی
docker compose up -d           # فقط زیرساخت: postgres, redis, S3, mailpit
pnpm db:deploy                 # مهاجرت‌ها (+ دسته‌بندی‌ها)
pnpm seed:demo                 # حساب‌ها، ۵۰+ ویدیوی قابل‌پخش، رویدادهای نمونه (source=SEED)
pnpm dev                       # http://localhost:3000
pnpm dev:worker                # در ترمینال دوم: پردازش ویدیو
```

حساب‌های نمونه (`admin@`، `moderator@`، `sara@`، `arman@`، `nika@`، `viewer@tamashagah.test`): رمز با `SEED_PASSWORD=… pnpm db:seed` تعیین می‌شود
وگرنه تصادفی در `.data/seed-credentials.json` (در git نیست). ایمیل‌ها در حالت توسعه در `.data/mailbox` یا Mailpit هستند.

## دستورها

| دستور | کار |
| --- | --- |
| `pnpm lint` · `pnpm typecheck` | ESLint · TypeScript |
| `pnpm test:unit` · `pnpm test:components` | بدون سرویس |
| `pnpm test:integration` | PostgreSQL + Redis + ffmpeg لازم است (`DATABASE_URL_TEST`) |
| `pnpm build && PORT=3100 pnpm start` سپس `E2E_BASE_URL=http://localhost:3100 pnpm test:e2e` | e2e + axe (دسکتاپ و موبایل؛ worker هم باید بالا باشد) |
| `pnpm audit:security` | ممیزی ایستای امنیتی |
| `pnpm check:storage` | آزمون کامل پشتیبان ذخیره‌ساز (S3/fs) |
| `pnpm user:promote <email> admin\|moderator` | ساخت مدیر/ناظر |
| `pnpm seed:bulk` | داده‌ی حجیم برای سنجش کارایی |

## ساختار

```
src/app          صفحه‌ها (site، studio، admin)، API، media
src/features     منطق هر حوزه (auth, uploads, watch, comments, analytics, admin, moderation, ...)
src/lib          زیرساخت مشترک (env, db, redis, storage, rate-limit, auth, jalali, persian, ...)
src/components   UI (ui/ = primitives راست‌به‌چپ)
worker/          پردازش ویدیو و کارهای نگهداری (BullMQ)
prisma/          schema، مهاجرت‌ها، seed
tests/           unit, component, integration, e2e
docs/            معماری، قراردادها، امنیت، استقرار، مستندات هر ویژگی (docs/features)
```

## مستندات

[`docs/deployment.md`](docs/deployment.md) استقرار · [`docs/security.md`](docs/security.md) امنیت · [`docs/known-limitations.md`](docs/known-limitations.md) محدودیت‌ها و موارد نیازمند زیرساخت بیرونی ·
[`docs/architecture.md`](docs/architecture.md) · [`docs/conventions.md`](docs/conventions.md) · [`docs/testing.md`](docs/testing.md) · [`docs/status.md`](docs/status.md) · [`docs/features/`](docs/features) ·
[`docs/monetization-architecture.md`](docs/monetization-architecture.md).

## مجوز

فایل مجوزی در مخزن نیست؛ انتخاب آن با مالک پروژه است. فونت Vazirmatn با مجوز SIL OFL همراه است (`src/assets/fonts/OFL.txt`).
