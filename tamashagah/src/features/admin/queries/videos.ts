import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { normalizeSearchText } from '@/lib/persian';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import type { Prisma } from '@/generated/prisma/client';
import type { ProcessingStatus, PublishStatus, UserRole, Visibility } from '@/generated/prisma/enums';
import { OPEN_REPORT_STATUSES } from '../policy';
import type { VideoListParams } from '../schemas';
import { ciContains, paginate, type PageInfo } from './common';

export type AdminVideoItem = {
  id: string;
  title: string;
  posterUrl: string | null;
  durationSeconds: number | null;
  processingStatus: ProcessingStatus;
  publishStatus: PublishStatus;
  visibility: Visibility;
  takedownAt: Date | null;
  takedownReason: string | null;
  failureReason: string | null;
  viewCount: number;
  createdAt: Date;
  channel: { id: string; name: string; handle: string; suspended: boolean };
  owner: { id: string; role: UserRole };
  openReports: number;
};

export function videoListWhere(f: VideoListParams): Prisma.VideoWhereInput {
  const and: Prisma.VideoWhereInput[] = [];
  if (f.q) {
    const normalized = normalizeSearchText(f.q);
    const or: Prisma.VideoWhereInput[] = [];
    if (normalized) or.push({ searchTitle: { contains: normalized } });
    if (VIDEO_ID_REGEX.test(f.q.trim())) or.push({ id: f.q.trim() });
    if (or.length) and.push({ OR: or });
  }
  if (f.processing === 'PENDING') and.push({ processingStatus: { in: ['QUEUED', 'PROCESSING'] } });
  else if (f.processing !== 'ALL') and.push({ processingStatus: f.processing });
  if (f.publish !== 'ALL') and.push({ publishStatus: f.publish });
  if (f.visibility !== 'ALL') and.push({ visibility: f.visibility });
  if (f.takedown === 'YES') and.push({ takedownAt: { not: null } });
  if (f.takedown === 'NO') and.push({ takedownAt: null });
  if (f.channel) {
    const c = f.channel.trim();
    and.push({ channel: { is: { OR: [{ handle: ciContains(c.replace(/^@/, '')) }, { name: ciContains(c) }] } } });
  }
  return and.length ? { AND: and } : {};
}

export async function listAdminVideos(filters: VideoListParams): Promise<{ items: AdminVideoItem[]; pageInfo: PageInfo }> {
  const where = videoListWhere(filters);
  const total = await db.video.count({ where });
  const pageInfo = paginate(total, filters.page);
  const rows = await db.video.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: {
      id: true,
      title: true,
      posterKey: true,
      durationSeconds: true,
      processingStatus: true,
      publishStatus: true,
      visibility: true,
      takedownAt: true,
      takedownReason: true,
      failureReason: true,
      viewCount: true,
      createdAt: true,
      channel: { select: { id: true, name: true, handle: true, suspendedAt: true, owner: { select: { id: true, role: true } } } },
    },
  });
  const counts = rows.length
    ? await db.report.groupBy({
        by: ['videoId'],
        where: { videoId: { in: rows.map((r) => r.id) }, status: { in: [...OPEN_REPORT_STATUSES] } },
        _count: { _all: true },
      })
    : [];
  const open = new Map(counts.map((c) => [c.videoId, c._count._all]));
  return {
    items: rows.map((v) => ({
      id: v.id,
      title: v.title,
      posterUrl: mediaUrl(v.posterKey),
      durationSeconds: v.durationSeconds,
      processingStatus: v.processingStatus,
      publishStatus: v.publishStatus,
      visibility: v.visibility,
      takedownAt: v.takedownAt,
      takedownReason: v.takedownReason,
      failureReason: v.failureReason,
      viewCount: v.viewCount,
      createdAt: v.createdAt,
      channel: { id: v.channel.id, name: v.channel.name, handle: v.channel.handle, suspended: !!v.channel.suspendedAt },
      owner: v.channel.owner,
      openReports: open.get(v.id) ?? 0,
    })),
    pageInfo,
  };
}
