/**
 * Validated environment configuration (server side).
 *
 * - Runtime-agnostic: used by the Next.js app AND the worker. Do not import
 *   `next/*` or `server-only` here.
 * - Parsed lazily on first property access so `next build` can import route
 *   modules without a full environment. Set SKIP_ENV_VALIDATION=1 for builds.
 * - Empty strings are treated as "unset".
 * - Never put secrets in NEXT_PUBLIC_* variables.
 */
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const boolish = (fallback: boolean) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) : v),
    z.boolean(),
  ).default(fallback);

const int = (fallback: number, min = 0) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min)).default(fallback);

const GiB = 1024 ** 3;

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Public base URL of the site, used for absolute links, e-mails and origin checks. */
    APP_URL: z.preprocess(emptyToUndefined, z.url()).default('http://localhost:3000'),
    SERVICE_NAME: z.string().default('web'),

    // --- Database / cache ---------------------------------------------------
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: int(10, 1),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

    // --- Security -----------------------------------------------------------
    /** >= 32 chars. Used for HMACs (IP hashes, viewer keys, signed media tokens). */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_DAYS: int(30, 1),
    SESSION_ABSOLUTE_TTL_DAYS: int(90, 1),
    /** Comma separated extra origins allowed to call mutating endpoints. */
    TRUSTED_ORIGINS: optionalString,
    /** Number of reverse proxies in front of the app (for X-Forwarded-For). */
    TRUSTED_PROXY_HOPS: int(0),

    // --- Object storage -----------------------------------------------------
    STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
    STORAGE_FS_ROOT: z.string().default('.data/storage'),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: boolish(true),
    /** proxy: stream media through the app. redirect: 302 to short-lived presigned URLs (s3 only). */
    MEDIA_DELIVERY: z.enum(['proxy', 'redirect']).default('proxy'),

    // --- Uploads ------------------------------------------------------------
    UPLOAD_MAX_BYTES: int(2 * GiB, 1),
    UPLOAD_DAILY_QUOTA_BYTES: int(10 * GiB, 1),
    UPLOAD_MAX_PER_DAY: int(50, 1),
    UPLOAD_STALE_HOURS: int(48, 1),

    // --- Video processing (worker) -------------------------------------------
    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFPROBE_PATH: z.string().default('ffprobe'),
    WORKER_CONCURRENCY: int(1, 1),
    TRANSCODE_PRESET: z.string().default('veryfast'),
    HLS_SEGMENT_SECONDS: int(6, 2),
    KEEP_ORIGINAL_SOURCE: boolish(true),
    /** Scratch directory for transcoding. Defaults to the OS temp dir. */
    WORKER_TMP_DIR: optionalString,

    // --- E-mail ---------------------------------------------------------------
    MAIL_TRANSPORT: z.enum(['smtp', 'file', 'console']).default('console'),
    MAIL_FROM: z.string().default('تماشاگاه <no-reply@localhost>'),
    MAIL_FILE_DIR: z.string().default('.data/mailbox'),
    SMTP_HOST: optionalString,
    SMTP_PORT: int(587, 1),
    SMTP_SECURE: boolish(false),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,

    // --- Logging / misc -------------------------------------------------------
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Marks development seed data in the UI. Real events are always source=REAL. */
    SHOW_SEED_DATA_NOTICE: boolish(true),
    /**
     * Allow http:// APP_URL while NODE_ENV=production. ONLY for local production-mode
     * testing (e2e, `next start` on localhost). Cookies lose the Secure flag.
     */
    ALLOW_INSECURE_HTTP: boolish(false),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
      }
    }
    if (v.MAIL_TRANSPORT === 'smtp' && !v.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST is required when MAIL_TRANSPORT=smtp' });
    }
    // Production hardening applies at runtime, not while `next build` merely imports modules.
    const building = process.env.NEXT_PHASE === 'phase-production-build';
    if (v.NODE_ENV === 'production' && !building) {
      if (/^(dev-only|changeme|change-me|secret)/i.test(v.SESSION_SECRET)) {
        ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'SESSION_SECRET looks like a placeholder; generate a random value' });
      }
      if (!v.APP_URL.startsWith('https://') && !v.ALLOW_INSECURE_HTTP) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must use https:// in production (ALLOW_INSECURE_HTTP=true only for local testing)' });
      }
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const source = process.env;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    if (source.SKIP_ENV_VALIDATION === '1') {
      // Build-time only: values are not used for real work.
      cached = source as unknown as Env;
      return cached;
    }
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  cached = parsed.data;
  if (cached.NODE_ENV === 'production' && cached.APP_URL.startsWith('https://') && cached.TRUSTED_PROXY_HOPS === 0 && process.env.NEXT_PHASE !== 'phase-production-build') {
    // Behind TLS there is (almost) always a reverse proxy; with 0 trusted hops the client IP is unknown and all visitors share one
    // rate-limit bucket (login/register/reset), which one abuser could exhaust. Say so loudly instead of failing the start-up.
    console.warn('[tamashagah] APP_URL is https but TRUSTED_PROXY_HOPS=0: client IPs are unknown and auth rate limits are shared by everybody. Set TRUSTED_PROXY_HOPS to the number of reverse proxies in front of the app.');
  }
  return cached;
}

/** Lazily validated environment. `env.DATABASE_URL`, `env.APP_URL`, ... */
export const env: Env = new Proxy({} as Env, {
  get: (_target, prop: string) => getEnv()[prop as keyof Env],
  has: (_target, prop: string) => prop in getEnv(),
  ownKeys: () => Reflect.ownKeys(getEnv()),
  getOwnPropertyDescriptor: (_target, prop: string) => ({
    enumerable: true,
    configurable: true,
    value: getEnv()[prop as keyof Env],
  }),
});

export const isProd = () => getEnv().NODE_ENV === 'production';
export const isDev = () => getEnv().NODE_ENV === 'development';
export const isTest = () => getEnv().NODE_ENV === 'test';

/** Test helper: forget the cached parse so a modified process.env is re-read. */
export function resetEnvCache(): void {
  cached = undefined;
}
