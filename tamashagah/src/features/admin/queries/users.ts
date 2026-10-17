import 'server-only';
import { db } from '@/lib/db';
import type { Formatter } from '@/lib/format';
import type { Prisma } from '@/generated/prisma/client';
import type { ReportReason, ReportStatus, ReportTarget, UserRole, UserStatus } from '@/generated/prisma/enums';
import { OPEN_REPORT_STATUSES } from '../policy';
import type { UserListParams } from '../schemas';
import { getActionHistory, type ActivityItem } from './activity';
import { ciContains, paginate, type PageInfo } from './common';

export type AdminUserItem = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
  emailVerified: boolean;
  channel: { id: string; name: string; handle: string } | null;
};

export function userListWhere(f: UserListParams): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  if (f.q) and.push({ OR: [{ email: ciContains(f.q) }, { displayName: ciContains(f.q) }, { channel: { is: { handle: ciContains(f.q.replace(/^@/, '')) } } }] });
  if (f.role !== 'ALL') and.push({ role: f.role });
  if (f.status !== 'ALL') and.push({ status: f.status });
  return and.length ? { AND: and } : {};
}

export async function listAdminUsers(filters: UserListParams): Promise<{ items: AdminUserItem[]; pageInfo: PageInfo }> {
  const where = userListWhere(filters);
  const total = await db.user.count({ where });
  const pageInfo = paginate(total, filters.page);
  const rows = await db.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: {
      id: true,
      displayName: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      emailVerifiedAt: true,
      channel: { select: { id: true, name: true, handle: true } },
    },
  });
  return {
    items: rows.map((u) => ({
      id: u.id,
      name: u.displayName,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      emailVerified: !!u.emailVerifiedAt,
      channel: u.channel,
    })),
    pageInfo,
  };
}

export type ReportAgainstUser = {
  id: string;
  targetType: ReportTarget;
  reason: ReportReason;
  status: ReportStatus;
  createdAt: Date;
  /** Title / excerpt / channel name of what was reported. */
  targetLabel: string;
};

export type AdminUserDetail = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
  emailVerified: boolean;
  activeSessions: number;
  channel: { id: string; name: string; handle: string; isVerified: boolean; suspendedAt: Date | null; followerCount: number; videoCount: number } | null;
  /** True when this is the only active administrator (role/suspension are locked). */
  isLastAdmin: boolean;
  reportsAgainst: { open: number; total: number; recent: ReportAgainstUser[] };
  reportsFiled: number;
  blockedOn: { channelId: string; channelName: string }[];
  history: ActivityItem[];
};

export async function getAdminUser(id: string, viewer: { id: string; role: UserRole }, f: Pick<Formatter, 'number'>): Promise<AdminUserDetail | null> {
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      emailVerifiedAt: true,
      channel: { select: { id: true, name: true, handle: true, isVerified: true, suspendedAt: true, followerCount: true, _count: { select: { videos: true } } } },
    },
  });
  if (!user) return null;

  // Reports whose subject belongs to this user: their channel, videos of their channel, comments they wrote.
  const against: Prisma.ReportWhereInput = { OR: [{ channel: { is: { ownerId: id } } }, { video: { is: { channel: { is: { ownerId: id } } } } }, { comment: { is: { authorId: id } } }] };
  const [sessions, openAgainst, totalAgainst, recent, filed, blocks, otherAdmins, history] = await Promise.all([
    db.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    db.report.count({ where: { AND: [against, { status: { in: [...OPEN_REPORT_STATUSES] } }] } }),
    db.report.count({ where: against }),
    db.report.findMany({
      where: against,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        targetType: true,
        reason: true,
        status: true,
        createdAt: true,
        video: { select: { title: true } },
        comment: { select: { body: true } },
        channel: { select: { name: true } },
      },
    }),
    db.report.count({ where: { reporterId: id } }),
    db.channelBlock.findMany({ where: { userId: id }, take: 10, select: { channelId: true, channel: { select: { name: true } } } }),
    user.role === 'ADMIN' && user.status === 'ACTIVE' ? db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: id } } }) : Promise.resolve(1),
    getActionHistory(viewer, { targetUserId: id }, f, 12),
  ]);

  return {
    id: user.id,
    name: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    emailVerified: !!user.emailVerifiedAt,
    activeSessions: sessions,
    channel: user.channel
      ? {
          id: user.channel.id,
          name: user.channel.name,
          handle: user.channel.handle,
          isVerified: user.channel.isVerified,
          suspendedAt: user.channel.suspendedAt,
          followerCount: user.channel.followerCount,
          videoCount: user.channel._count.videos,
        }
      : null,
    isLastAdmin: user.role === 'ADMIN' && user.status === 'ACTIVE' && otherAdmins === 0,
    reportsAgainst: {
      open: openAgainst,
      total: totalAgainst,
      recent: recent.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        targetLabel: r.video?.title ?? r.comment?.body.slice(0, 80) ?? r.channel?.name ?? '—',
      })),
    },
    reportsFiled: filed,
    blockedOn: blocks.map((b) => ({ channelId: b.channelId, channelName: b.channel.name })),
    history,
  };
}
