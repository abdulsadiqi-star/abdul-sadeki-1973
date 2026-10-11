/**
 * Resumable uploads: a tus server (`@tus/server` v2) mounted in Next Route Handlers (`/api/upload`).
 *
 *  - storage: `@tus/s3-store` when STORAGE_DRIVER=s3 (multipart upload, 8 MiB parts), otherwise `@tus/file-store`
 *  - upload id ⇄ storage key: `uploads/<videoId>` (see keys.ts); clients only see `/api/upload/<videoId>`
 *  - locking: Redis lease locker (works across instances)
 *  - authorization on EVERY request (`onIncomingRequest`): signed-in, e-mail verified, owns a channel; HEAD / PATCH /
 *    DELETE only for the owner of that very upload — anything else is a plain 404 (existence is never revealed)
 *  - on create: size / type / daily quota / rate limit, then `Video(AWAITING_UPLOAD)`
 *  - on finish: video → QUEUED, TranscodeJob, queue job
 *
 * The raw upload is private: GET is not served at all (the processed outputs are served by `/media/*`).
 */
import path from 'node:path';
import { FileStore } from '@tus/file-store';
import { ERRORS, EVENTS, Server, type KvStore, type Upload } from '@tus/server';
import { S3Store, type MetadataValue } from '@tus/s3-store';
import { getCurrentUser, toActor, type CurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { Errors, isAppError, type AppError } from '@/lib/errors';
import { isVideoId, newVideoId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { ownsChannel } from '@/lib/permissions';
import { enforceRateLimit, limits } from '@/lib/rate-limit';
import { createBullConnection, getRedis } from '@/lib/redis';
import { UPLOAD_CHUNK_BYTES, UPLOAD_ENDPOINT, uploadLimits } from './limits';
import { tusIdForVideo, videoIdFromTusId } from './keys';
import { checkDeclaredUpload } from './policy';
import { RedisLocker } from './redis-locker';
import { completeUpload, createAwaitingUpload, discardUpload } from './service';

const log = logger.child({ module: 'tus' });

type TusRequest = Parameters<Server['handleWeb']>[0];

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

/** Signed in + verified e-mail + owns a channel (what creating AND continuing an upload requires). */
export async function requireUploader(): Promise<CurrentUser & { channel: NonNullable<CurrentUser['channel']> }> {
  const user = await getCurrentUser();
  if (!user) throw Errors.unauthenticated();
  if (!user.emailVerified) throw Errors.emailNotVerified('برای بارگذاری ویدیو ابتدا ایمیل خود را تأیید کنید.');
  if (!user.channel) throw Errors.forbidden('برای بارگذاری ویدیو ابتدا باید کانال بسازید.');
  return user as CurrentUser & { channel: NonNullable<CurrentUser['channel']> };
}

/** The user resolved for a request, so `onUploadCreate` does not hit the database again. */
const requestUsers = new WeakMap<object, CurrentUser & { channel: NonNullable<CurrentUser['channel']> }>();

async function authorizeRequest(req: TusRequest, tusId: string): Promise<void> {
  const user = await requireUploader();
  await enforceRateLimit('upload:req', user.id, uploadLimits.tusRequest);
  requestUsers.set(req, user);

  if (req.method === 'POST') {
    // Creating: the id is brand new, so there is nothing to look up. Validation and quota follow in onUploadCreate.
    await enforceRateLimit('upload:create', user.id, limits.uploadCreate);
    return;
  }

  const videoId = videoIdFromTusId(tusId);
  const video = videoId
    ? await db.video.findUnique({ where: { id: videoId }, select: { channelId: true, processingStatus: true } })
    : null;
  // Strictly the owner: moderators may manage a video in the studio, but never write into somebody's upload.
  // 404 (not 403) so upload ids cannot be probed.
  if (!video || !ownsChannel(toActor(user), video.channelId)) throw Errors.notFound('این بارگذاری پیدا نشد.');

  if (req.method !== 'HEAD' && video.processingStatus !== 'AWAITING_UPLOAD') {
    throw Errors.conflict('بارگذاری این ویدیو پیش‌تر تکمیل شده است. برای حذف آن از «ویدیوهای من» استفاده کنید.');
  }
}

// ---------------------------------------------------------------------------
// Datastore
// ---------------------------------------------------------------------------

/** Small LRU for the S3 store's `.info` cache: abandoned uploads must not pile up in memory forever. */
class BoundedKvStore<T> implements KvStore<T> {
  private readonly map = new Map<string, T>();
  constructor(private readonly max = 2_000) {}
  async get(key: string): Promise<T | undefined> {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  async set(key: string, value: T): Promise<void> {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function createDatastore() {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Store({
      partSize: UPLOAD_CHUNK_BYTES,
      cache: new BoundedKvStore<MetadataValue>(),
      s3ClientConfig: {
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
        // S3-compatible servers (MinIO, Ceph, ...) do not all support the SDK's default flexible checksums.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      },
    });
  }
  return new FileStore({ directory: path.resolve(env.STORAGE_FS_ROOT) });
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * - AppErrors thrown by our hooks become JSON bodies the browser client can show (Persian message + code).
 * - "could not get the lock in time" becomes 423 Locked, the status tus clients RETRY on. Plain 5xx on HEAD makes
 *   tus-js-client start a brand-new upload instead, which would orphan the old one.
 */
export function mapTusError(_req: TusRequest, err: Error | { status_code: number; body: string }) {
  if ('status_code' in err && err.status_code === ERRORS.ERR_LOCK_TIMEOUT.status_code && err.body === ERRORS.ERR_LOCK_TIMEOUT.body) {
    return { status_code: 423, body: JSON.stringify({ error: { code: 'LOCKED', message: 'این بارگذاری در حال استفاده است؛ کمی بعد دوباره تلاش می‌شود.' } }) };
  }
  if (isAppError(err)) {
    const e: AppError = err;
    return {
      status_code: e.status,
      body: JSON.stringify({
        error: { code: e.code, message: e.message, fieldErrors: e.fieldErrors, retryAfterSeconds: e.retryAfterSeconds },
      }),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const globalForTus = globalThis as unknown as { __tusServer?: Server; __tusLocker?: RedisLocker };

export function getTusServer(): Server {
  if (globalForTus.__tusServer) return globalForTus.__tusServer;

  const locker = (globalForTus.__tusLocker = new RedisLocker({
    redis: getRedis,
    createSubscriber: createBullConnection,
  }));

  const server = new Server({
    path: UPLOAD_ENDPOINT,
    datastore: createDatastore(),
    locker,
    maxSize: env.UPLOAD_MAX_BYTES,
    // Same-origin only. (Requests without an Origin header, like HEAD, are not subject to CORS anyway.)
    allowedOrigins: [new URL(env.APP_URL).origin],
    respectForwardedHeaders: false,
    lockDrainTimeout: 3_000,
    // A finished upload belongs to the pipeline now: deleting the video is the studio's job, not tus'.
    disableTerminationForFinishedUploads: true,

    namingFunction: () => tusIdForVideo(newVideoId()),
    getFileIdFromRequest: (_req, lastPath) => (lastPath && isVideoId(lastPath) ? tusIdForVideo(lastPath) : undefined),
    // Relative URL: correct behind any reverse proxy / scheme.
    generateUrl: (_req, { path: base, id }) => `${base}/${encodeURIComponent(videoIdFromTusId(id) ?? id)}`,

    onIncomingRequest: async (req, uploadId) => authorizeRequest(req, uploadId),

    onUploadCreate: async (req, upload: Upload) => {
      const user = requestUsers.get(req) ?? (await requireUploader());
      const videoId = videoIdFromTusId(upload.id);
      if (!videoId) throw Errors.badRequest();
      if (upload.sizeIsDeferred) throw Errors.badRequest('اندازه‌ی فایل باید از ابتدا مشخص باشد.');

      const meta = upload.metadata ?? {};
      const check = checkDeclaredUpload(
        { filename: meta.filename, filetype: meta.filetype, size: upload.size },
        { maxBytes: env.UPLOAD_MAX_BYTES },
      );
      if (!check.ok) {
        throw check.code === 'QUOTA_EXCEEDED'
          ? Errors.quotaExceeded(check.message)
          : Errors.validation({ file: [check.message] }, check.message);
      }

      const channel = await db.channel.findUnique({
        where: { id: user.channel.id },
        select: { id: true, name: true, defaultVisibility: true, suspendedAt: true },
      });
      if (!channel || channel.suspendedAt) throw Errors.blocked('کانال شما معلق است و امکان بارگذاری ویدیو ندارد.');

      await createAwaitingUpload({
        videoId,
        channelId: channel.id,
        channelName: channel.name,
        defaultVisibility: channel.defaultVisibility,
        filename: check.filename,
        mime: check.mime,
        size: upload.size!,
      });
      // The sanitized values replace what the client sent; `contentType` becomes the object's Content-Type on S3.
      return { metadata: { filename: check.filename, filetype: check.mime, contentType: check.mime, videoId } };
    },

    onUploadFinish: async (_req, upload: Upload) => {
      const videoId = videoIdFromTusId(upload.id);
      if (!videoId) throw Errors.badRequest();
      const result = await completeUpload(videoId);
      if (result === 'incomplete' || result === 'missing') {
        log.error({ videoId, result }, 'upload finished but the stored object does not match');
        throw Errors.internal('ذخیره‌ی فایل کامل نشد. دوباره تلاش کنید.');
      }
      return {};
    },

    onResponseError: mapTusError,
  });

  // DELETE (cancel) succeeded: drop the video row and sweep leftovers (S3 `.part` objects, ...).
  server.on(EVENTS.POST_TERMINATE, (_req, _res, id: string) => {
    const videoId = videoIdFromTusId(id);
    if (!videoId) return;
    void discardUpload(videoId).catch((err) => log.error({ err, videoId }, 'discarding the cancelled upload failed'));
  });

  globalForTus.__tusServer = server;
  return server;
}

/** Stop the Redis subscriber (tests, graceful shutdown). */
export async function closeTusServer(): Promise<void> {
  await globalForTus.__tusLocker?.close();
  globalForTus.__tusServer = undefined;
  globalForTus.__tusLocker = undefined;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Entry point of the route handlers. */
export async function handleTusRequest(req: Request): Promise<Response> {
  // The raw upload is private; tus' GET handler would stream it back, so GET never reaches it.
  if (req.method === 'GET') {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'مورد درخواستی پیدا نشد.' } }, { status: 404, headers: NO_STORE });
  }
  const response = await getTusServer().handleWeb(req as TusRequest);
  for (const [name, value] of Object.entries(NO_STORE)) response.headers.set(name, value);
  return response;
}
