# استقرار تماشاگاه (Deployment)

این سند دو مسیر را پوشش می‌دهد: **اجرای آزمایشی** روی یک ماشین (بدون دامنه) و **استقرار تولید** روی یک سرور با دامنه و HTTPS.
همه‌ی دستورها در همین مخزن اجرا و راستی‌آزمایی شده‌اند (جزئیات در بخش «چه چیزی تست شده»).

## ۱. اجزای سامانه

| جزء | نقش | تصویر / فرایند |
| --- | --- | --- |
| `web` | برنامه‌ی Next.js (رابط کاربری، Server Actions، API، پخش رسانه) | هدف `web` در `Dockerfile` |
| `worker` | صف BullMQ، FFmpeg/FFprobe: پردازش ویدیو، HLS، تصویر بندانگشتی، پاکسازی، هم‌ترازی شمارنده‌ها | هدف `worker` |
| `migrate` | اجرای یک‌باره‌ی `prisma migrate deploy` (فقط CLI پریزما) | هدف `migrate` |
| `postgres` | پایگاه داده‌ی اصلی (PostgreSQL 16، جست‌وجوی تمام‌متن + `pg_trgm`) | `postgres:16-alpine` |
| `redis` | محدودسازی نرخ + صف‌ها | `redis:7-alpine` |
| `objectstore` | ذخیره‌ساز سازگار با S3 برای ویدیو/تصویر (فقط برای توسعه و تک‌سرور) | `rustfs/rustfs` |
| `mailpit` | صندوق ایمیل آزمایشی (فقط برای توسعه) | `axllent/mailpit` |
| `caddy` | پروکسی معکوس + گواهی خودکار TLS (اختیاری، فایل `docker-compose.proxy.yml`) | `caddy:2` |

در تولید می‌توانید `postgres`، `redis` و `objectstore` را با سرویس‌های مدیریت‌شده جایگزین کنید (بخش ۶ و ۷).

## ۲. پیش‌نیازها

* Docker Engine 24+ و Docker Compose **2.24 یا بالاتر** (`docker compose version`).
* حداقل ۲ هسته و ۴ گیگ RAM برای وب؛ برای تبدیل ویدیو هر هسته‌ی اضافه، سرعت پردازش را تقریباً خطی بالا می‌برد
  (`WORKER_CONCURRENCY` تعداد تبدیل هم‌زمان در هر worker است؛ هر تبدیل می‌تواند چند هسته را اشغال کند).
* فضای دیسک: ویدیوی اصلی (اگر `KEEP_ORIGINAL_SOURCE=true`) + نسخه‌های HLS (تقریباً ۱ تا ۲ برابر حجم اصلی).
* برای تولید: یک دامنه که DNS آن به سرور اشاره کند و باز بودن پورت‌های ۸۰ و ۴۴۳.
* یک سرویس SMTP برای ایمیل واقعی (تأیید ایمیل و بازیابی گذرواژه). بدون آن کاربران نمی‌توانند ایمیل خود را تأیید کنند.

## ۳. اجرای آزمایشی (یک ماشین، بدون دامنه)

```bash
cd tamashagah
node scripts/init-env.mjs                    # یا: pnpm setup:env  — فایل .env با رمزهای تصادفی می‌سازد
docker compose --profile app up -d --build   # postgres, redis, objectstore, mailpit, migrate, web, worker
```

* سایت: <http://localhost:3000> — ایمیل‌های آزمایشی (لینک تأیید): <http://localhost:8025>
* سلامت: `curl http://localhost:3000/api/health?deep=1` ← `{"status":"ok","checks":{"database":true,"redis":true,"storage":true}}`
* اگر پورتی اشغال است، در `.env` یکی از این‌ها را بگذارید: `WEB_PORT`، `POSTGRES_PORT`، `REDIS_PORT`، `S3_PORT`،
  `S3_CONSOLE_PORT`، `MAILPIT_SMTP_PORT`، `MAILPIT_UI_PORT` (و `APP_URL` را با `WEB_PORT` هماهنگ کنید).

> این حالت از HTTP ساده استفاده می‌کند (`ALLOW_INSECURE_HTTP=true` به‌صورت پیش‌فرض در Compose). فقط برای آزمایش محلی است.

## ۴. استقرار تولید با دامنه و HTTPS

1. مخزن را روی سرور بگیرید و `.env` را بسازید: `node scripts/init-env.mjs`.
2. در `.env` دامنه را بگذارید و مقدارهای زیر را بررسی کنید:

   ```dotenv
   SITE_ADDRESS=tamashagah.example.com    # دامنه‌ای که DNS آن به این سرور اشاره می‌کند
   MAIL_FROM="تماشاگاه <no-reply@example.com>"
   LOG_LEVEL=info
   ```

3. ایمیل واقعی و تنظیمات اضافه را در `.env.docker` بگذارید (الگو: `docker/env.docker.example`):

   ```bash
   cp docker/env.docker.example .env.docker && chmod 600 .env.docker
   # سپس MAIL_TRANSPORT=smtp و SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD را باز و پر کنید
   ```

4. بالا بیاورید (Caddy گواهی Let's Encrypt را خودکار می‌گیرد و تمدید می‌کند):

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.proxy.yml --profile app up -d --build
   ```

   این overlay فقط پورت‌های ۸۰/۴۴۳ را باز می‌کند و برنامه را روی `APP_URL=https://$SITE_ADDRESS`، کوکی امن `__Host-`،
   `ALLOW_INSECURE_HTTP=false` و `TRUSTED_PROXY_HOPS=1` (خواندن IP واقعی کاربر از Caddy برای محدودسازی نرخ) تنظیم می‌کند.
   پورت‌های Postgres/Redis/ذخیره‌ساز روی `127.0.0.1` منتشر می‌شوند و از بیرون در دسترس نیستند؛ در تولید می‌توانید
   `ports:` آن‌ها را با یک override حذف کنید.
5. **اولین مدیر** را بسازید (بخش ۵) و `https://دامنه-شما/api/health?deep=1` را بررسی کنید.

> اگر پشت یک پروکسی/CDN دیگر هستید (Nginx، Cloudflare، ArvanCloud)، `docker-compose.proxy.yml` را نخواهید و خودتان
> `APP_URL=https://…`، `ALLOW_INSECURE_HTTP=false` و `TRUSTED_PROXY_HOPS=<تعداد پروکسی‌های مورد اعتماد>` را تنظیم کنید.
> مقدار نادرست `TRUSTED_PROXY_HOPS` یا IP همه‌ی کاربران را یکی می‌کند (قفل شدن محدودسازی نرخ) یا اجازه‌ی جعل IP می‌دهد.
> نمونه‌ی پروکسی برای اپلود بزرگ: بدنه‌ی درخواست تا ۴ گیگ و timeout ده‌دقیقه‌ای (`docker/Caddyfile`).

## ۵. ساخت اولین مدیر (و ناظر)

ابتدا همان شخص باید از فرم ثبت‌نام سایت حساب بسازد و ایمیلش را تأیید کند؛ سپس:

```bash
docker compose exec worker node dist/scripts/promote-user.mjs you@example.com admin       # مدیر
docker compose exec worker node dist/scripts/promote-user.mjs ali@example.com moderator   # ناظر محتوا
docker compose exec worker node dist/scripts/promote-user.mjs --list                      # فهرست کارکنان
docker compose exec worker node dist/scripts/promote-user.mjs ali@example.com --demote    # گرفتن نقش
```

بدون Docker (توسعه): `pnpm user:promote you@example.com admin`. تغییر نقش بلافاصله و بدون ورود دوباره اعمال می‌شود، در
گزارش فعالیت‌ها ثبت می‌شود و حذف آخرین مدیر فعال بدون `--force` رد می‌شود. بعد از آن، مدیران از پنل `/admin` نقش دیگران را تغییر می‌دهند.

## ۶. ذخیره‌ساز S3 خارجی (پیشنهادی در تولید)

`objectstore` (RustFS) برای توسعه و تک‌سرور است. برای تولید از یک سرویس S3 (AWS، آروان، لیارا، Ceph …) استفاده کنید:

```dotenv
# .env  (کلیدها)
S3_BUCKET=tamashagah
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

```dotenv
# .env.docker
S3_ENDPOINT=https://s3.example.com
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true      # برای AWS S3: false
MEDIA_DELIVERY=redirect       # اختیاری: ۳۰۲ به نشانی‌های امضاشده‌ی کوتاه‌مدت به‌جای عبور بایت‌ها از برنامه
```

سطل (bucket) باید **خصوصی** باشد؛ برنامه خودش دسترسی عمومی به `uploads/…` را نمی‌دهد و کلیدهای مجاز را کنترل می‌کند.
پیش از ورود به تولید، سازگاری سرویس را با خودِ برنامه بسنجید:

```bash
docker compose exec worker node dist/scripts/check-storage.mjs     # یا بدون Docker: pnpm check:storage
```

این آزمون put/get/range/multipart/abort/presign/list/delete را روی سرویس واقعی اجرا می‌کند و در اولین ناسازگاری با کد ۱ خارج می‌شود.
(با RustFS و ذخیره‌ساز فایل‌سیستمی گذرانده شده است.) سپس سرویس‌های `objectstore` و `objectstore-init` را از Compose حذف کنید.

## ۷. PostgreSQL / Redis مدیریت‌شده

* **Redis خارجی**: `REDIS_URL=redis://…` را در `.env.docker` بگذارید (باید `maxmemory-policy noeviction` داشته باشد؛ صف‌ها و محدودسازی نرخ).
* **PostgreSQL خارجی**: `DATABASE_URL` مستقیماً در `docker-compose.yml` تعریف شده و از `.env.docker` بازنویسی نمی‌شود. یک فایل
  `docker-compose.override.yml` (خودکار خوانده می‌شود) بسازید:

  ```yaml
  services:
    web:     { environment: { DATABASE_URL: "postgresql://USER:PASS@db.example.com:5432/tamashagah?sslmode=require" } }
    worker:  { environment: { DATABASE_URL: "postgresql://USER:PASS@db.example.com:5432/tamashagah?sslmode=require" } }
    migrate: { environment: { DATABASE_URL: "postgresql://USER:PASS@db.example.com:5432/tamashagah?sslmode=require" } }
  ```

  تست‌شده با PostgreSQL 16؛ مهاجرت اول افزونه‌ی `pg_trgm` را می‌سازد (کاربر باید اجازه‌ی `CREATE EXTENSION` داشته باشد یا
  افزونه از قبل فعال شده باشد). فایل override را در git نگذارید (حاوی رمز است).

## ۸. پشتیبان‌گیری و بازیابی

```bash
# پایگاه داده (فرمت custom، فشرده)
docker compose exec -T postgres pg_dump -U tamashagah -Fc tamashagah > backup-$(date +%F).dump
# بازیابی (روی پایگاه خالی یا همان پایگاه)
docker compose exec -T postgres pg_restore -U tamashagah -d tamashagah --clean --if-exists < backup-2026-10-11.dump

# ذخیره‌ساز اشیا (ویدیوها و تصویرها) به یک پوشه‌ی محلی
set -a; . ./.env; set +a
docker run --rm --network tamashagah_default \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" -e AWS_DEFAULT_REGION=us-east-1 \
  -v "$PWD/s3-backup:/backup" amazon/aws-cli --endpoint-url http://objectstore:9000 s3 sync s3://tamashagah /backup
```

* **Redis** حالت دائمی (`appendonly yes`) دارد، اما داده‌ی ماندگار نیست؛ شمارنده‌های محدودسازی و صف را می‌توان از دست داد.
  ویدیوهایی که در صف مانده‌اند با دستور بازپردازش/لغو در استودیو یا بازرسی worker پیگیری می‌شوند.
* اصل پشتیبان‌گیری: پایگاه داده روزانه، ذخیره‌ساز اشیا با سیاست نسخه‌گذاری/تکرار سرویس S3، و **یک بار بازیابی آزمایشی** پیش از ورود به تولید.

## ۹. به‌روزرسانی

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.proxy.yml --profile app up -d --build
```

سرویس `migrate` در هر بار بالا آمدن اجرا می‌شود و فقط مهاجرت‌های جدید را اعمال می‌کند؛ `web` و `worker` پس از موفقیت آن شروع می‌شوند.
مهاجرت‌ها افزایشی‌اند. پیش از به‌روزرسانی‌های بزرگ از پایگاه داده پشتیبان بگیرید.

## ۱۰. مقیاس‌پذیری

* **Worker**: `docker compose --profile app up -d --scale worker=3` — BullMQ کارها را بین نمونه‌ها پخش می‌کند؛ با `WORKER_CONCURRENCY` هم می‌توان
  هم‌زمانی هر نمونه را بالا برد. فضای موقت تبدیل یک volume روی دیسک است (`worker-tmp` ← `WORKER_TMP_DIR=/var/tmp/tamashagah`)، نه RAM؛ آن را روی دیسک سریع و
  با فضای کافی (چند برابر بزرگ‌ترین ویدیوی ورودی) بگذارید.
* **Web**: بی‌حالت است (نشست‌ها در PostgreSQL، محدودسازی در Redis)؛ چند نمونه پشت یک load balancer کافی است.
  برای پخش ویدیو در مقیاس بالا، `MEDIA_DELIVERY=redirect` و یک CDN جلوی سطل S3 بگذارید.

## ۱۱. پایش و عیب‌یابی

* لاگ ساختاری JSON (pino): `docker compose logs -f web worker`. کوکی، گذرواژه و توکن‌ها در لاگ حذف (redact) می‌شوند.
* `GET /api/health` (زنده بودن) و `GET /api/health?deep=1` (PostgreSQL + Redis + ذخیره‌ساز؛ در نقص `503`) — برای load balancer و پایشگر.
* `docker compose ps -a` را ببینید: `migrate` و `objectstore-init` باید با کد ۰ تمام شده باشند.

| نشانه | علت محتمل | راه‌حل |
| --- | --- | --- |
| `required variable … is missing` هنگام `docker compose` | `.env` ساخته نشده | `node scripts/init-env.mjs` |
| `Invalid environment configuration` در لاگ web | متغیر اجباری یا نامعتبر (مثلاً `APP_URL` بدون https در تولید) | پیام فهرست‌شده را اصلاح کنید؛ `.env.example` را ببینید |
| ایمیل تأیید نمی‌رسد | SMTP تنظیم نشده یا مسدود است | `.env.docker` را بررسی کنید؛ در حالت آزمایشی صندوق Mailpit روی پورت ۸۰۲۵ |
| همه‌ی کاربران `429` می‌گیرند / محدودسازی عمل نمی‌کند | `TRUSTED_PROXY_HOPS` با تعداد پروکسی‌ها نمی‌خواند | مقدار درست را بگذارید (بخش ۴) |
| ویدیو در حالت «در صف» می‌ماند | worker بالا نیست یا به Redis/S3 دسترسی ندارد | `docker compose logs worker`؛ `check-storage.mjs` |
| پورت اشغال است | سرویس محلی دیگر | متغیرهای `*_PORT` در `.env` |

## ۱۲. چک‌لیست پیش از انتشار

- [ ] `APP_URL` با `https://` و `ALLOW_INSECURE_HTTP=false` (یا overlay پروکسی) — کوکی نشست باید `__Host-tg_session` با `Secure` باشد.
- [ ] `SESSION_SECRET` تصادفی و ≥ ۳۲ نویسه؛ هیچ رمز پیش‌فرضی باقی نمانده؛ `.env`/`.env.docker` با دسترسی `600` و خارج از git.
- [ ] SMTP واقعی تنظیم و یک ایمیل تأیید واقعاً دریافت شده است.
- [ ] سطل S3 خصوصی است و `check-storage` موفق است؛ پشتیبان‌گیری و یک بازیابی آزمایشی انجام شده.
- [ ] اولین مدیر ساخته شد و حساب‌های seed (`*@tamashagah.test`) در این پایگاه **وجود ندارند** (seed فقط برای توسعه است).
- [ ] `TRUSTED_PROXY_HOPS` درست است؛ پورت‌های Postgres/Redis/ذخیره‌ساز از بیرون بسته است (فایروال).
- [ ] `/api/health?deep=1` سبز است و پایشگر روی آن تنظیم شده؛ لاگ‌ها جمع‌آوری می‌شوند.
- [ ] صفحات قانونی (`/terms`، `/privacy`، `/copyright`) را با متن حقوقی کسب‌وکار خود جایگزین کرده‌اید؛ مدل درآمدزایی فقط معماری است (به `docs/known-limitations.md` نگاه کنید).

## ۱۳. چه چیزی تست شده

در محیط توسعه‌ی این پروژه (بدون دسترسی به سرور واقعی) این موارد **اجرا و تأیید** شدند:

* ساخت هر سه تصویر Docker (`web`، `worker`، `migrate`) و بالا آمدن کل Compose؛ مهاجرت روی PostgreSQL 16 تازه؛ سلامت عمیق سبز.
* ثبت‌نام ← ایمیل تأیید از طریق SMTP واقعی (Mailpit) ← تأیید ← ارتقا به مدیر با `promote-user` ← دسترسی به `/admin`، هم روی HTTP و هم **پشت Caddy با HTTPS**
  (کوکی `__Host-` امن، HSTS، CSP، ریدایرکت ۳۰۸ از HTTP).
* آزمون ذخیره‌ساز (multipart، range، presign…) روی RustFS و از درون کانتینر worker.
* پشتیبان‌گیری/بازیابی PostgreSQL و همگام‌سازی ذخیره‌ساز.

**تست‌نشده در این محیط:** صدور گواهی واقعی Let's Encrypt (نیاز به دامنه‌ی عمومی)، ارسال ایمیل با ارائه‌دهنده‌ی SMTP واقعی، سرویس‌های S3 تجاری، و
نصب `ffmpeg` از مخزن Debian داخل تصویر worker (در این sandbox مخزن Debian مسدود است؛ دستور `apt-get install ffmpeg` استاندارد است و در CI
GitHub Actions ساخته می‌شود — کار `compose-smoke`).
