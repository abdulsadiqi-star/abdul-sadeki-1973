import 'server-only';
import { db, type Prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { mediaUrl } from '@/lib/media-url';
import { canManageVideo, type Actor } from '@/lib/permissions';
import { toNumber } from '@/lib/utils';
import type { JobStage, JobStatus, ProcessingStatus, PublishStatus, VideoKind, Visibility } from '@/generated/prisma/enums';
import { studioTabs, type StudioTab } from './labels';
import { pageSizeFor, studioVideoOrderBy, studioVideoWhere } from './filters';
import type { StudioListParams } from './schemas';
import type { SubtitleDto } from './service';
import { metadataFromStored, type MetadataFormValues } from './metadata';

// ---------------------------------------------------------------------------
// The list (`/studio/videos`)
// ---------------------------------------------------------------------------

export type StudioJobInfo = { status: JobStatus; stage: JobStage | null; progress: number; attempt: number; maxAttempts: number };

export type StudioVideoItem = {
  id: string;
  title: string;
  kind: VideoKind;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  durationSeconds: number | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  posterUrl: string | null;
  /** ISO strings (Dates do not cross the Server → Client boundary). */
  createdAt: string;
  publishedAt: string | null;
  scheduledFor: string | null;
  failureReason: string | null;
  job: StudioJobInfo | null;
};

const itemSelect = {
  id: true,
  title: true,
  kind: true,
  processingStatus: true,
  publishStatus: true,
  visibility: true,
  durationSeconds: true,
  viewCount: true,
  likeCount: true,
  commentCount: true,
  posterKey: true,
  createdAt: true,
  publishedAt: true,
  scheduledFor: true,
  failureReason: true,
  jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, stage: true, progress: true, attempt: true, maxAttempts: true } },
} satisfies Prisma.VideoSelect;

type ItemRow = Prisma.VideoGetPayload<{ select: typeof itemSelect }>;

export function toStudioItem(row: ItemRow): StudioVideoItem {
  const job = row.jobs[0];
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    processingStatus: row.processingStatus,
    publishStatus: row.publishStatus,
    visibility: row.visibility,
    durationSeconds: row.durationSeconds,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    posterUrl: mediaUrl(row.posterKey),
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    failureReason: row.failureReason,
    job: job ? { status: job.status, stage: job.stage, progress: job.progress, attempt: job.attempt, maxAttempts: job.maxAttempts } : null,
  };
}

export type StudioTabCounts = Record<StudioTab, number>;

/** One query for all tab badges. */
export async function getStudioTabCounts(channelId: string): Promise<StudioTabCounts> {
  const [row] = await db.$queryRaw<
    { total: number; unpublished: number; scheduled: number; processing: number; failed: number; shorts: number }[]
  >`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "publishStatus" = 'DRAFT' AND "processingStatus" = 'READY')::int AS unpublished,
      count(*) FILTER (WHERE "publishStatus" = 'SCHEDULED')::int AS scheduled,
      count(*) FILTER (WHERE "processingStatus" IN ('AWAITING_UPLOAD', 'QUEUED', 'PROCESSING'))::int AS processing,
      count(*) FILTER (WHERE "processingStatus" = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE "kind" = 'SHORT')::int AS shorts
    FROM "Video" WHERE "channelId" = ${channelId}`;
  const counts = row ?? { total: 0, unpublished: 0, scheduled: 0, processing: 0, failed: 0, shorts: 0 };
  return { all: counts.total, unpublished: counts.unpublished, scheduled: counts.scheduled, processing: counts.processing, failed: counts.failed, shorts: counts.shorts };
}

export type StudioVideoPage = {
  items: StudioVideoItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  counts: StudioTabCounts;
};

export async function listStudioVideos(channelId: string, params: StudioListParams): Promise<StudioVideoPage> {
  const pageSize = pageSizeFor(params.view);
  const where = studioVideoWhere(channelId, params);
  const [total, counts] = await Promise.all([db.video.count({ where }), getStudioTabCounts(channelId)]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(params.page, pageCount);
  const rows = await db.video.findMany({
    where,
    orderBy: studioVideoOrderBy(params.sort as 'newest'),
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: itemSelect,
  });
  return { items: rows.map(toStudioItem), total, page, pageCount, pageSize, counts };
}

export const studioTabValues = studioTabs.map((t) => t.value);

// ---------------------------------------------------------------------------
// Upload page
// ---------------------------------------------------------------------------

export type PendingUpload = {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  /** What the creator already saved for it, so a resumed upload continues with the same form. */
  metadata: MetadataFormValues;
};

/** Uploads that were started but not finished (the browser can resume them when the same file is picked again). */
export async function getPendingUploads(channelId: string): Promise<PendingUpload[]> {
  const since = new Date(Date.now() - env.UPLOAD_STALE_HOURS * 3_600_000);
  const rows = await db.video.findMany({
    where: { channelId, processingStatus: 'AWAITING_UPLOAD', createdAt: { gte: since } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: {
      id: true,
      originalFilename: true,
      sourceSizeBytes: true,
      createdAt: true,
      title: true,
      description: true,
      tags: true,
      categoryId: true,
      language: true,
      visibility: true,
      processingStatus: true,
      publishStatus: true,
      publishOnReady: true,
      scheduledFor: true,
      commentsEnabled: true,
      ageRestricted: true,
      assets: { where: { kind: 'SOURCE' }, take: 1, select: { meta: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    filename: r.originalFilename ?? 'ویدیو',
    sizeBytes: toNumber(r.sourceSizeBytes),
    createdAt: r.createdAt.toISOString(),
    metadata: metadataFromStored({
      ...r,
      kindChoice: ((r.assets[0]?.meta ?? {}) as { kindChoice?: 'auto' | 'VIDEO' | 'SHORT' }).kindChoice ?? 'auto',
    }),
  }));
}

export type UploadUsage = { count: number; bytes: number };

/** What the channel has already uploaded in the last 24 hours (the quota window the server enforces). */
export async function getUploadUsage(channelId: string): Promise<UploadUsage> {
  const usage = await db.video.aggregate({
    where: { channelId, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
    _count: { _all: true },
    _sum: { sourceSizeBytes: true },
  });
  return { count: usage._count._all, bytes: toNumber(usage._sum.sourceSizeBytes) };
}

/** Videos still being processed (shown on the upload page so a refresh does not lose track of them). */
export async function getProcessingVideos(channelId: string): Promise<StudioVideoItem[]> {
  const rows = await db.video.findMany({
    where: { channelId, processingStatus: { in: ['QUEUED', 'PROCESSING'] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: itemSelect,
  });
  return rows.map(toStudioItem);
}

// ---------------------------------------------------------------------------
// Status (polled by the browser)
// ---------------------------------------------------------------------------

export type VideoStatusDto = StudioVideoItem & {
  /** True once the HLS outputs exist (watchable, and the poster is final). */
  ready: boolean;
  maxAttempts: number;
};

const statusSelect = { ...itemSelect, channelId: true } satisfies Prisma.VideoSelect;

function toStatus(row: Prisma.VideoGetPayload<{ select: typeof statusSelect }>): VideoStatusDto {
  const item = toStudioItem(row);
  return { ...item, ready: row.processingStatus === 'READY', maxAttempts: item.job?.maxAttempts ?? 3 };
}

/** Status of one video the actor may manage; `null` (→ 404) for everything else. */
export async function loadVideoStatus(actor: Actor, videoId: string): Promise<VideoStatusDto | null> {
  const row = await db.video.findUnique({ where: { id: videoId }, select: statusSelect });
  if (!row || !canManageVideo(actor, { channelId: row.channelId })) return null;
  return toStatus(row);
}

/** Batch variant for the list page (one request for every processing card). Unknown / foreign ids are simply absent. */
export async function loadVideoStatuses(actor: Actor, ids: string[]): Promise<VideoStatusDto[]> {
  if (ids.length === 0) return [];
  const rows = await db.video.findMany({ where: { id: { in: ids } }, select: statusSelect });
  return rows.filter((r) => canManageVideo(actor, { channelId: r.channelId })).map(toStatus);
}

// ---------------------------------------------------------------------------
// Edit page
// ---------------------------------------------------------------------------

export type ThumbnailOption = { index: number; url: string; selected: boolean };

export type StudioEditData = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string | null;
  language: string;
  kind: VideoKind;
  /** What the form starts with: the creator's choice while processing, the current kind once READY. */
  kindChoice: 'auto' | VideoKind;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  publishOnReady: boolean;
  scheduledFor: string | null;
  publishedAt: string | null;
  commentsEnabled: boolean;
  ageRestricted: boolean;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  posterUrl: string | null;
  failureReason: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  originalFilename: string | null;
  sourceSizeBytes: number | null;
  job: StudioJobInfo | null;
  thumbnails: ThumbnailOption[];
  customPoster: boolean;
  subtitles: SubtitleDto[];
  channelHandle: string;
  /** Initial values of the metadata form. */
  metadata: MetadataFormValues;
};

/** Everything the edit page needs; `null` when the video does not exist or the actor may not manage it. */
export async function getStudioEditData(actor: Actor, videoId: string): Promise<StudioEditData | null> {
  const row = await db.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      channelId: true,
      title: true,
      description: true,
      tags: true,
      categoryId: true,
      language: true,
      kind: true,
      processingStatus: true,
      publishStatus: true,
      visibility: true,
      publishOnReady: true,
      scheduledFor: true,
      publishedAt: true,
      commentsEnabled: true,
      ageRestricted: true,
      durationSeconds: true,
      width: true,
      height: true,
      posterKey: true,
      failureReason: true,
      viewCount: true,
      likeCount: true,
      commentCount: true,
      createdAt: true,
      originalFilename: true,
      sourceSizeBytes: true,
      channel: { select: { handle: true } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, stage: true, progress: true, attempt: true, maxAttempts: true } },
      assets: {
        where: { kind: { in: ['THUMBNAIL', 'POSTER', 'SUBTITLE', 'SOURCE'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, kind: true, storageKey: true, label: true, language: true, isDefault: true, meta: true },
      },
    },
  });
  if (!row || !canManageVideo(actor, { channelId: row.channelId })) return null;

  const poster = row.assets.find((a) => a.kind === 'POSTER');
  const posterMeta = (poster?.meta ?? {}) as { source?: string; index?: number };
  const thumbnails = row.assets
    .filter((a) => a.kind === 'THUMBNAIL')
    .sort((a, b) => Number(a.label) - Number(b.label))
    .map((a) => ({
      index: Number(a.label),
      url: mediaUrl(a.storageKey)!,
      selected: posterMeta.source === 'auto' && posterMeta.index === Number(a.label),
    }));
  const sourceMeta = (row.assets.find((a) => a.kind === 'SOURCE')?.meta ?? {}) as { kindChoice?: 'auto' | VideoKind };
  const job = row.jobs[0];

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags: row.tags,
    categoryId: row.categoryId,
    language: row.language,
    kind: row.kind,
    kindChoice: row.processingStatus === 'READY' ? row.kind : (sourceMeta.kindChoice ?? 'auto'),
    processingStatus: row.processingStatus,
    publishStatus: row.publishStatus,
    visibility: row.visibility,
    publishOnReady: row.publishOnReady,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    commentsEnabled: row.commentsEnabled,
    ageRestricted: row.ageRestricted,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    posterUrl: mediaUrl(row.posterKey),
    failureReason: row.failureReason,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    createdAt: row.createdAt.toISOString(),
    originalFilename: row.originalFilename,
    sourceSizeBytes: row.sourceSizeBytes === null ? null : toNumber(row.sourceSizeBytes),
    job: job ? { status: job.status, stage: job.stage, progress: job.progress, attempt: job.attempt, maxAttempts: job.maxAttempts } : null,
    thumbnails,
    customPoster: posterMeta.source === 'custom',
    subtitles: row.assets
      .filter((a) => a.kind === 'SUBTITLE')
      .map((a) => ({
        id: a.id,
        language: a.language ?? '',
        label: a.label ?? a.language ?? '',
        isDefault: a.isDefault,
        cues: ((a.meta ?? {}) as { cues?: number }).cues ?? null,
        url: mediaUrl(a.storageKey)!,
      })),
    channelHandle: row.channel.handle,
    metadata: metadataFromStored({
      title: row.title,
      description: row.description,
      tags: row.tags,
      categoryId: row.categoryId,
      language: row.language,
      visibility: row.visibility,
      processingStatus: row.processingStatus,
      publishStatus: row.publishStatus,
      publishOnReady: row.publishOnReady,
      scheduledFor: row.scheduledFor,
      commentsEnabled: row.commentsEnabled,
      ageRestricted: row.ageRestricted,
      kindChoice: row.processingStatus === 'READY' ? row.kind : (sourceMeta.kindChoice ?? 'auto'),
    }),
  };
}
