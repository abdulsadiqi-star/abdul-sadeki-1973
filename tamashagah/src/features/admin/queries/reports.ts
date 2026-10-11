import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { truncate } from '@/lib/persian';
import type { Formatter } from '@/lib/format';
import { reportsOnTarget } from '@/features/moderation/reports';
import type { Prisma } from '@/generated/prisma/client';
import type { CommentStatus, ProcessingStatus, PublishStatus, ReportReason, ReportStatus, ReportTarget, UserRole, UserStatus, Visibility } from '@/generated/prisma/enums';
import { OPEN_REPORT_STATUSES } from '../policy';
import type { ReportListParams } from '../schemas';
import { getActionHistory, type ActivityItem } from './activity';
import { paginate, type PageInfo } from './common';

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export type ReportListTarget =
  | { type: 'VIDEO'; id: string; title: string; posterUrl: string | null; durationSeconds: number | null; takenDown: boolean; channelName: string }
  | { type: 'COMMENT'; id: string; excerpt: string; authorName: string; videoId: string; videoTitle: string; status: CommentStatus }
  | { type: 'CHANNEL'; id: string; name: string; handle: string; avatarUrl: string | null; suspended: boolean };

export type ReportListItem = {
  id: string;
  targetType: ReportTarget;
  reason: ReportReason;
  status: ReportStatus;
  details: string | null;
  createdAt: Date;
  reporter: { id: string; name: string } | null;
  /** Open reports about the same target, this one included. */
  openOnTarget: number;
  target: ReportListTarget | null;
};

const listSelect = {
  id: true,
  targetType: true,
  reason: true,
  status: true,
  details: true,
  createdAt: true,
  videoId: true,
  commentId: true,
  channelId: true,
  reporter: { select: { id: true, displayName: true } },
  video: { select: { id: true, title: true, posterKey: true, durationSeconds: true, takedownAt: true, channel: { select: { name: true } } } },
  comment: { select: { id: true, body: true, status: true, videoId: true, author: { select: { displayName: true } }, video: { select: { title: true } } } },
  channel: { select: { id: true, name: true, handle: true, avatarKey: true, suspendedAt: true } },
} satisfies Prisma.ReportSelect;

export function reportListWhere(filters: ReportListParams, now = new Date()): Prisma.ReportWhereInput {
  const where: Prisma.ReportWhereInput = {};
  if (filters.status === 'PENDING') where.status = { in: [...OPEN_REPORT_STATUSES] };
  else if (filters.status !== 'ALL') where.status = filters.status;
  if (filters.target !== 'ALL') where.targetType = filters.target;
  if (filters.reason !== 'ALL') where.reason = filters.reason;
  const day = 86_400_000;
  if (filters.age === 'DAY') where.createdAt = { gte: new Date(now.getTime() - day) };
  else if (filters.age === 'WEEK') where.createdAt = { gte: new Date(now.getTime() - 7 * day) };
  else if (filters.age === 'OLDER') where.createdAt = { lt: new Date(now.getTime() - 7 * day) };
  return where;
}

export async function listReports(filters: ReportListParams): Promise<{ items: ReportListItem[]; pageInfo: PageInfo }> {
  const where = reportListWhere(filters);
  const total = await db.report.count({ where });
  const pageInfo = paginate(total, filters.page);
  const rows = await db.report.findMany({
    where,
    orderBy: filters.sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: listSelect,
  });

  // One grouped query per target kind for the whole page (no N+1).
  const open = { status: { in: [...OPEN_REPORT_STATUSES] } };
  const ids = (pick: (r: (typeof rows)[number]) => string | null) => [...new Set(rows.map(pick).filter((v): v is string => !!v))];
  const [byVideo, byComment, byChannel] = await Promise.all([
    db.report.groupBy({ by: ['videoId'], where: { ...open, videoId: { in: ids((r) => r.videoId) } }, _count: { _all: true } }),
    db.report.groupBy({ by: ['commentId'], where: { ...open, commentId: { in: ids((r) => r.commentId) } }, _count: { _all: true } }),
    db.report.groupBy({ by: ['channelId'], where: { ...open, channelId: { in: ids((r) => r.channelId) } }, _count: { _all: true } }),
  ]);
  const videoCounts = new Map(byVideo.map((g) => [g.videoId, g._count._all]));
  const commentCounts = new Map(byComment.map((g) => [g.commentId, g._count._all]));
  const channelCounts = new Map(byChannel.map((g) => [g.channelId, g._count._all]));

  const items = rows.map((r): ReportListItem => {
    let target: ReportListTarget | null = null;
    let openOnTarget = 0;
    if (r.targetType === 'VIDEO' && r.video) {
      openOnTarget = videoCounts.get(r.videoId) ?? 0;
      target = {
        type: 'VIDEO',
        id: r.video.id,
        title: r.video.title,
        posterUrl: mediaUrl(r.video.posterKey),
        durationSeconds: r.video.durationSeconds,
        takenDown: !!r.video.takedownAt,
        channelName: r.video.channel.name,
      };
    } else if (r.targetType === 'COMMENT' && r.comment) {
      openOnTarget = commentCounts.get(r.commentId) ?? 0;
      target = {
        type: 'COMMENT',
        id: r.comment.id,
        excerpt: truncate(r.comment.body, 140),
        authorName: r.comment.author.displayName,
        videoId: r.comment.videoId,
        videoTitle: r.comment.video.title,
        status: r.comment.status,
      };
    } else if (r.targetType === 'CHANNEL' && r.channel) {
      openOnTarget = channelCounts.get(r.channelId) ?? 0;
      target = { type: 'CHANNEL', id: r.channel.id, name: r.channel.name, handle: r.channel.handle, avatarUrl: mediaUrl(r.channel.avatarKey), suspended: !!r.channel.suspendedAt };
    }
    return {
      id: r.id,
      targetType: r.targetType,
      reason: r.reason,
      status: r.status,
      details: r.details,
      createdAt: r.createdAt,
      reporter: r.reporter ? { id: r.reporter.id, name: r.reporter.displayName } : null,
      openOnTarget,
      target,
    };
  });
  return { items, pageInfo };
}

/** Per-status totals for the filter header (one grouped query). */
export async function getReportStatusCounts(): Promise<Record<ReportStatus | 'PENDING' | 'ALL', number>> {
  const groups = await db.report.groupBy({ by: ['status'], _count: { _all: true } });
  const by = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Partial<Record<ReportStatus, number>>;
  const n = (s: ReportStatus) => by[s] ?? 0;
  return {
    OPEN: n('OPEN'),
    REVIEWING: n('REVIEWING'),
    ACTIONED: n('ACTIONED'),
    DISMISSED: n('DISMISSED'),
    PENDING: n('OPEN') + n('REVIEWING'),
    ALL: n('OPEN') + n('REVIEWING') + n('ACTIONED') + n('DISMISSED'),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type PersonRef = { id: string; name: string; email: string; role: UserRole; status: UserStatus };

export type CommentContextItem = { id: string; body: string; authorName: string; createdAt: Date; status: CommentStatus; isTarget: boolean };

export type ReportTargetDetail =
  | {
      type: 'VIDEO';
      id: string;
      title: string;
      description: string;
      posterUrl: string | null;
      durationSeconds: number | null;
      processingStatus: ProcessingStatus;
      publishStatus: PublishStatus;
      visibility: Visibility;
      takedownAt: Date | null;
      takedownReason: string | null;
      viewCount: number;
      likeCount: number;
      commentCount: number;
      createdAt: Date;
      channel: { id: string; name: string; handle: string; suspended: boolean; isVerified: boolean; avatarUrl: string | null };
    }
  | {
      type: 'COMMENT';
      id: string;
      body: string;
      status: CommentStatus;
      createdAt: Date;
      isReply: boolean;
      moderationNote: string | null;
      /** Removed by its own author: staff cannot restore such a comment. */
      deletedByAuthor: boolean;
      /** Neighbouring comments of the same thread (chronological, target included). */
      context: CommentContextItem[];
      video: { id: string; title: string; posterUrl: string | null };
      channel: { id: string; name: string; handle: string };
      author: PersonRef;
      authorBlockedOnChannel: boolean;
    }
  | {
      type: 'CHANNEL';
      id: string;
      name: string;
      handle: string;
      description: string;
      avatarUrl: string | null;
      isVerified: boolean;
      suspended: boolean;
      followerCount: number;
      videoCount: number;
      createdAt: Date;
    };

export type SiblingReport = {
  id: string;
  reason: ReportReason;
  status: ReportStatus;
  details: string | null;
  createdAt: Date;
  reporterName: string | null;
  handlerName: string | null;
};

export type ReportDetail = {
  report: {
    id: string;
    status: ReportStatus;
    targetType: ReportTarget;
    reason: ReportReason;
    details: string | null;
    createdAt: Date;
    handledAt: Date | null;
    resolution: string | null;
    handler: { id: string; name: string } | null;
    reporter: PersonRef | null;
  };
  /** null when the target no longer exists (cannot normally happen: reports are deleted with their target). */
  target: ReportTargetDetail | null;
  /** The user whose content / account this is about — the party the policy protects. */
  owner: PersonRef | null;
  others: SiblingReport[];
  history: ActivityItem[];
};

const personSelect = { id: true, displayName: true, email: true, role: true, status: true } as const;
const toPerson = (u: { id: string; displayName: string; email: string; role: UserRole; status: UserStatus }): PersonRef => ({
  id: u.id,
  name: u.displayName,
  email: u.email,
  role: u.role,
  status: u.status,
});

export async function getReportDetail(
  id: string,
  viewer: { id: string; role: UserRole },
  f: Pick<Formatter, 'number'>,
): Promise<ReportDetail | null> {
  const report = await db.report.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      targetType: true,
      reason: true,
      details: true,
      createdAt: true,
      handledAt: true,
      resolution: true,
      videoId: true,
      commentId: true,
      channelId: true,
      handler: { select: { id: true, displayName: true } },
      reporter: { select: personSelect },
    },
  });
  if (!report) return null;

  let target: ReportTargetDetail | null = null;
  let owner: PersonRef | null = null;
  let historyWhere: Prisma.ModerationActionWhereInput = { id: '__none__' };

  if (report.targetType === 'VIDEO' && report.videoId) {
    const v = await db.video.findUnique({
      where: { id: report.videoId },
      select: {
        id: true,
        title: true,
        description: true,
        posterKey: true,
        durationSeconds: true,
        processingStatus: true,
        publishStatus: true,
        visibility: true,
        takedownAt: true,
        takedownReason: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        createdAt: true,
        channel: { select: { id: true, name: true, handle: true, suspendedAt: true, isVerified: true, avatarKey: true, owner: { select: personSelect } } },
      },
    });
    if (v) {
      owner = toPerson(v.channel.owner);
      target = {
        type: 'VIDEO',
        id: v.id,
        title: v.title,
        description: v.description,
        posterUrl: mediaUrl(v.posterKey),
        durationSeconds: v.durationSeconds,
        processingStatus: v.processingStatus,
        publishStatus: v.publishStatus,
        visibility: v.visibility,
        takedownAt: v.takedownAt,
        takedownReason: v.takedownReason,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        commentCount: v.commentCount,
        createdAt: v.createdAt,
        channel: { id: v.channel.id, name: v.channel.name, handle: v.channel.handle, suspended: !!v.channel.suspendedAt, isVerified: v.channel.isVerified, avatarUrl: mediaUrl(v.channel.avatarKey) },
      };
      historyWhere = { videoId: v.id };
    }
  } else if (report.targetType === 'COMMENT' && report.commentId) {
    const c = await db.comment.findUnique({
      where: { id: report.commentId },
      select: {
        id: true,
        body: true,
        status: true,
        createdAt: true,
        videoId: true,
        parentId: true,
        rootId: true,
        moderationNote: true,
        moderatedById: true,
        author: { select: personSelect },
        video: { select: { id: true, title: true, posterKey: true, channel: { select: { id: true, name: true, handle: true } } } },
      },
    });
    if (c) {
      owner = toPerson(c.author);
      const threadRoot = c.rootId ?? c.id;
      const inThread: Prisma.CommentWhereInput = { videoId: c.videoId, OR: [{ id: threadRoot }, { rootId: threadRoot }], id: { not: c.id } };
      const ctxSelect = { id: true, body: true, status: true, createdAt: true, author: { select: { displayName: true } } } as const;
      const [before, after, blocked] = await Promise.all([
        db.comment.findMany({ where: { ...inThread, createdAt: { lt: c.createdAt } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2, select: ctxSelect }),
        db.comment.findMany({ where: { ...inThread, createdAt: { gte: c.createdAt } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 2, select: ctxSelect }),
        db.channelBlock.findUnique({ where: { channelId_userId: { channelId: c.video.channel.id, userId: c.author.id } }, select: { userId: true } }),
      ]);
      const toItem = (x: (typeof before)[number], isTarget = false): CommentContextItem => ({
        id: x.id,
        body: x.body,
        authorName: x.author.displayName,
        createdAt: x.createdAt,
        status: x.status,
        isTarget,
      });
      target = {
        type: 'COMMENT',
        id: c.id,
        body: c.body,
        status: c.status,
        createdAt: c.createdAt,
        isReply: !!c.parentId,
        moderationNote: c.moderationNote,
        deletedByAuthor: c.status === 'DELETED' && c.moderatedById === c.author.id,
        context: [...before.reverse().map((x) => toItem(x)), { id: c.id, body: c.body, authorName: c.author.displayName, createdAt: c.createdAt, status: c.status, isTarget: true }, ...after.map((x) => toItem(x))],
        video: { id: c.video.id, title: c.video.title, posterUrl: mediaUrl(c.video.posterKey) },
        channel: c.video.channel,
        author: toPerson(c.author),
        authorBlockedOnChannel: !!blocked,
      };
      historyWhere = { commentId: c.id };
    }
  } else if (report.targetType === 'CHANNEL' && report.channelId) {
    const ch = await db.channel.findUnique({
      where: { id: report.channelId },
      select: {
        id: true,
        name: true,
        handle: true,
        description: true,
        avatarKey: true,
        isVerified: true,
        suspendedAt: true,
        followerCount: true,
        createdAt: true,
        owner: { select: personSelect },
        _count: { select: { videos: true } },
      },
    });
    if (ch) {
      owner = toPerson(ch.owner);
      target = {
        type: 'CHANNEL',
        id: ch.id,
        name: ch.name,
        handle: ch.handle,
        description: ch.description,
        avatarUrl: mediaUrl(ch.avatarKey),
        isVerified: ch.isVerified,
        suspended: !!ch.suspendedAt,
        followerCount: ch.followerCount,
        videoCount: ch._count.videos,
        createdAt: ch.createdAt,
      };
      historyWhere = { channelId: ch.id };
    }
  }

  const ref =
    report.targetType === 'VIDEO' && report.videoId
      ? ({ type: 'VIDEO', id: report.videoId } as const)
      : report.targetType === 'COMMENT' && report.commentId
        ? ({ type: 'COMMENT', id: report.commentId } as const)
        : report.targetType === 'CHANNEL' && report.channelId
          ? ({ type: 'CHANNEL', id: report.channelId } as const)
          : null;

  const [others, history] = await Promise.all([
    ref
      ? db.report.findMany({
          where: { ...reportsOnTarget(ref), id: { not: report.id } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
          select: { id: true, reason: true, status: true, details: true, createdAt: true, reporter: { select: { displayName: true } }, handler: { select: { displayName: true } } },
        })
      : Promise.resolve([]),
    getActionHistory(viewer, historyWhere, f),
  ]);

  return {
    report: {
      id: report.id,
      status: report.status,
      targetType: report.targetType,
      reason: report.reason,
      details: report.details,
      createdAt: report.createdAt,
      handledAt: report.handledAt,
      resolution: report.resolution,
      handler: report.handler ? { id: report.handler.id, name: report.handler.displayName } : null,
      reporter: report.reporter ? toPerson(report.reporter) : null,
    },
    target,
    owner,
    others: others.map((o) => ({ id: o.id, reason: o.reason, status: o.status, details: o.details, createdAt: o.createdAt, reporterName: o.reporter?.displayName ?? null, handlerName: o.handler?.displayName ?? null })),
    history,
  };
}
