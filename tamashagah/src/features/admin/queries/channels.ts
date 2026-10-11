import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { normalizeSearchText } from '@/lib/persian';
import type { Formatter } from '@/lib/format';
import type { Prisma } from '@/generated/prisma/client';
import type { MonetizationStatus, ProcessingStatus, PublishStatus, UserRole, UserStatus, VerificationStatus, Visibility } from '@/generated/prisma/enums';
import { OPEN_REPORT_STATUSES } from '../policy';
import type { ChannelListParams } from '../schemas';
import { getActionHistory, type ActivityItem } from './activity';
import { ciContains, paginate, type PageInfo } from './common';

export type AdminChannelItem = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  isVerified: boolean;
  suspendedAt: Date | null;
  followerCount: number;
  videoCount: number;
  createdAt: Date;
  owner: { id: string; name: string; email: string; role: UserRole };
  openReports: number;
};

export function channelListWhere(f: ChannelListParams): Prisma.ChannelWhereInput {
  const and: Prisma.ChannelWhereInput[] = [];
  if (f.q) {
    const normalized = normalizeSearchText(f.q);
    const or: Prisma.ChannelWhereInput[] = [
      { handle: ciContains(f.q.replace(/^@/, '')) },
      { owner: { is: { OR: [{ email: ciContains(f.q) }, { displayName: ciContains(f.q) }] } } },
    ];
    if (normalized) or.push({ searchName: { contains: normalized } });
    and.push({ OR: or });
  }
  if (f.verified === 'YES') and.push({ isVerified: true });
  if (f.verified === 'NO') and.push({ isVerified: false });
  if (f.suspended === 'YES') and.push({ suspendedAt: { not: null } });
  if (f.suspended === 'NO') and.push({ suspendedAt: null });
  return and.length ? { AND: and } : {};
}

export async function listAdminChannels(filters: ChannelListParams): Promise<{ items: AdminChannelItem[]; pageInfo: PageInfo }> {
  const where = channelListWhere(filters);
  const total = await db.channel.count({ where });
  const pageInfo = paginate(total, filters.page);
  const rows = await db.channel.findMany({
    where,
    orderBy: filters.sort === 'followers' ? [{ followerCount: 'desc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: {
      id: true,
      name: true,
      handle: true,
      avatarKey: true,
      isVerified: true,
      suspendedAt: true,
      followerCount: true,
      createdAt: true,
      owner: { select: { id: true, displayName: true, email: true, role: true } },
      _count: { select: { videos: true } },
    },
  });
  const counts = rows.length
    ? await db.report.groupBy({
        by: ['channelId'],
        where: { channelId: { in: rows.map((r) => r.id) }, status: { in: [...OPEN_REPORT_STATUSES] } },
        _count: { _all: true },
      })
    : [];
  const open = new Map(counts.map((c) => [c.channelId, c._count._all]));
  return {
    items: rows.map((c) => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      avatarUrl: mediaUrl(c.avatarKey),
      isVerified: c.isVerified,
      suspendedAt: c.suspendedAt,
      followerCount: c.followerCount,
      videoCount: c._count.videos,
      createdAt: c.createdAt,
      owner: { id: c.owner.id, name: c.owner.displayName, email: c.owner.email, role: c.owner.role },
      openReports: open.get(c.id) ?? 0,
    })),
    pageInfo,
  };
}

export type AdminChannelDetail = {
  id: string;
  name: string;
  handle: string;
  description: string;
  avatarUrl: string | null;
  isVerified: boolean;
  verifiedAt: Date | null;
  suspendedAt: Date | null;
  /** Reason of the latest suspension (from the audit log). */
  suspensionReason: string | null;
  createdAt: Date;
  owner: { id: string; name: string; email: string; role: UserRole; status: UserStatus };
  stats: {
    followers: number;
    totalVideos: number;
    videosByProcessing: Partial<Record<ProcessingStatus, number>>;
    publicVideos: number;
    takenDownVideos: number;
    totalViews: number;
    approvedComments: number;
    blockedCommenters: number;
  };
  reports: { open: number; total: number };
  monetization: { status: MonetizationStatus; submittedAt: Date | null } | null;
  verification: { status: VerificationStatus; createdAt: Date } | null;
  recentVideos: { id: string; title: string; viewCount: number; takedownAt: Date | null; processingStatus: ProcessingStatus; publishStatus: PublishStatus; visibility: Visibility }[];
  history: ActivityItem[];
};

export async function getAdminChannel(id: string, viewer: { id: string; role: UserRole }, f: Pick<Formatter, 'number'>): Promise<AdminChannelDetail | null> {
  const channel = await db.channel.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      handle: true,
      description: true,
      avatarKey: true,
      isVerified: true,
      verifiedAt: true,
      suspendedAt: true,
      followerCount: true,
      createdAt: true,
      owner: { select: { id: true, displayName: true, email: true, role: true, status: true } },
    },
  });
  if (!channel) return null;

  const [byProcessing, publicVideos, takenDown, views, comments, blocked, openReports, totalReports, application, request, recentVideos, suspension, history] = await Promise.all([
    db.video.groupBy({ by: ['processingStatus'], where: { channelId: id }, _count: { _all: true } }),
    db.video.count({ where: { channelId: id, processingStatus: 'READY', publishStatus: 'PUBLISHED', visibility: 'PUBLIC', takedownAt: null } }),
    db.video.count({ where: { channelId: id, takedownAt: { not: null } } }),
    db.video.aggregate({ where: { channelId: id }, _sum: { viewCount: true } }),
    db.comment.count({ where: { status: 'APPROVED', video: { channelId: id } } }),
    db.channelBlock.count({ where: { channelId: id } }),
    db.report.count({ where: { channelId: id, status: { in: [...OPEN_REPORT_STATUSES] } } }),
    db.report.count({ where: { channelId: id } }),
    db.monetizationApplication.findFirst({ where: { channelId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, submittedAt: true } }),
    db.verificationRequest.findFirst({ where: { channelId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, createdAt: true } }),
    db.video.findMany({ where: { channelId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5, select: { id: true, title: true, viewCount: true, takedownAt: true, processingStatus: true, publishStatus: true, visibility: true } }),
    channel.suspendedAt
      ? db.moderationAction.findFirst({ where: { channelId: id, type: 'CHANNEL_SUSPEND' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { reason: true } })
      : Promise.resolve(null),
    getActionHistory(viewer, { channelId: id }, f, 10),
  ]);

  const videosByProcessing: Partial<Record<ProcessingStatus, number>> = {};
  let totalVideos = 0;
  for (const g of byProcessing) {
    videosByProcessing[g.processingStatus] = g._count._all;
    totalVideos += g._count._all;
  }
  return {
    id: channel.id,
    name: channel.name,
    handle: channel.handle,
    description: channel.description,
    avatarUrl: mediaUrl(channel.avatarKey),
    isVerified: channel.isVerified,
    verifiedAt: channel.verifiedAt,
    suspendedAt: channel.suspendedAt,
    suspensionReason: suspension?.reason ?? null,
    createdAt: channel.createdAt,
    owner: { id: channel.owner.id, name: channel.owner.displayName, email: channel.owner.email, role: channel.owner.role, status: channel.owner.status },
    stats: {
      followers: channel.followerCount,
      totalVideos,
      videosByProcessing,
      publicVideos,
      takenDownVideos: takenDown,
      totalViews: views._sum.viewCount ?? 0,
      approvedComments: comments,
      blockedCommenters: blocked,
    },
    reports: { open: openReports, total: totalReports },
    monetization: application,
    verification: request,
    recentVideos,
    history,
  };
}
