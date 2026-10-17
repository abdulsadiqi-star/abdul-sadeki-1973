import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { truncate } from '@/lib/persian';
import { monetizationRequirements } from '@/config/site';
import { publicVideoWhere } from '@/features/videos/visibility';
import type { Prisma } from '@/generated/prisma/client';
import type { MonetizationStatus, UserRole, UserStatus, VerificationStatus } from '@/generated/prisma/enums';
import { PENDING_MONETIZATION_STATUSES, PENDING_VERIFICATION_STATUSES } from '../policy';
import type { MonetizationListParams, VerificationListParams } from '../schemas';
import { ciContains, paginate, type PageInfo } from './common';

type Owner = { id: string; name: string; email: string; role: UserRole; status: UserStatus };
type ChannelRef = { id: string; name: string; handle: string; avatarUrl: string | null; isVerified: boolean; suspended: boolean };

const channelRefSelect = { id: true, name: true, handle: true, avatarKey: true, isVerified: true, suspendedAt: true } as const;
const toChannelRef = (c: { id: string; name: string; handle: string; avatarKey: string | null; isVerified: boolean; suspendedAt: Date | null }): ChannelRef => ({
  id: c.id,
  name: c.name,
  handle: c.handle,
  avatarUrl: mediaUrl(c.avatarKey),
  isVerified: c.isVerified,
  suspended: !!c.suspendedAt,
});
const ownerSelect = { id: true, displayName: true, email: true, role: true, status: true } as const;
const toOwner = (u: { id: string; displayName: string; email: string; role: UserRole; status: UserStatus }): Owner => ({ id: u.id, name: u.displayName, email: u.email, role: u.role, status: u.status });

// ---------------------------------------------------------------------------
// Monetization
// ---------------------------------------------------------------------------

/** The snapshot the creator submitted with (stored as JSON; every field is validated before use). */
export type StatsSnapshot = { followers: number | null; totalViews: number | null; watchHours: number | null; videoCount: number | null; capturedAt: string | null };

export function parseSnapshot(raw: unknown): StatsSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    followers: n(o.followers),
    totalViews: n(o.totalViews),
    watchHours: n(o.watchHours),
    videoCount: n(o.videoCount),
    capturedAt: typeof o.capturedAt === 'string' ? o.capturedAt : null,
  };
}

export type MonetizationListItem = {
  id: string;
  status: MonetizationStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  channel: ChannelRef;
  snapshot: StatsSnapshot | null;
};

export function monetizationListWhere(f: MonetizationListParams): Prisma.MonetizationApplicationWhereInput {
  const and: Prisma.MonetizationApplicationWhereInput[] = [];
  // Drafts belong to the creator: staff never see them.
  if (f.status === 'PENDING') and.push({ status: { in: [...PENDING_MONETIZATION_STATUSES] } });
  else if (f.status === 'ALL') and.push({ status: { not: 'DRAFT' } });
  else and.push({ status: f.status });
  if (f.q) and.push({ channel: { is: { OR: [{ name: ciContains(f.q) }, { handle: ciContains(f.q.replace(/^@/, '')) }] } } });
  return { AND: and };
}

export async function listMonetization(filters: MonetizationListParams): Promise<{ items: MonetizationListItem[]; pageInfo: PageInfo }> {
  const where = monetizationListWhere(filters);
  const total = await db.monetizationApplication.count({ where });
  const pageInfo = paginate(total, filters.page);
  const rows = await db.monetizationApplication.findMany({
    where,
    // Waiting applications oldest first (fair queue); decided ones newest first.
    orderBy: filters.status === 'PENDING' ? [{ submittedAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: { id: true, status: true, submittedAt: true, reviewedAt: true, statsSnapshot: true, channel: { select: channelRefSelect } },
  });
  return {
    items: rows.map((r) => ({ id: r.id, status: r.status, submittedAt: r.submittedAt, reviewedAt: r.reviewedAt, channel: toChannelRef(r.channel), snapshot: parseSnapshot(r.statsSnapshot) })),
    pageInfo,
  };
}

export type LiveStats = {
  followers: number;
  totalViews: number;
  /** Watch hours inside the requirement window, from persisted view events. */
  watchHours: { real: number; seed: number };
  publicVideos: number;
  totalVideos: number;
  windowDays: number;
};

/** Current numbers of a channel, computed from the tables (never from the snapshot). */
export async function getLiveChannelStats(channelId: string, now = new Date()): Promise<LiveStats> {
  const since = new Date(now.getTime() - monetizationRequirements.windowDays * 86_400_000);
  const [channel, views, watch, publicVideos, totalVideos] = await Promise.all([
    db.channel.findUnique({ where: { id: channelId }, select: { followerCount: true } }),
    db.video.aggregate({ where: { channelId }, _sum: { viewCount: true } }),
    db.viewEvent.groupBy({ by: ['source'], where: { channelId, createdAt: { gte: since } }, _sum: { watchSeconds: true } }),
    db.video.count({ where: { ...publicVideoWhere, channelId } }),
    db.video.count({ where: { channelId } }),
  ]);
  const hours = (source: 'REAL' | 'SEED') => (watch.find((w) => w.source === source)?._sum.watchSeconds ?? 0) / 3600;
  return {
    followers: channel?.followerCount ?? 0,
    totalViews: views._sum.viewCount ?? 0,
    watchHours: { real: hours('REAL'), seed: hours('SEED') },
    publicVideos,
    totalVideos,
    windowDays: monetizationRequirements.windowDays,
  };
}

export type MonetizationDetail = {
  id: string;
  status: MonetizationStatus;
  contactEmail: string | null;
  acceptedTermsAt: Date | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewer: { id: string; name: string } | null;
  decisionNote: string | null;
  snapshot: StatsSnapshot | null;
  channel: ChannelRef & { followerCount: number };
  owner: Owner;
  live: LiveStats;
  requirements: typeof monetizationRequirements;
  previous: { id: string; status: MonetizationStatus; submittedAt: Date | null; decisionNote: string | null }[];
};

export async function getMonetizationDetail(id: string): Promise<MonetizationDetail | null> {
  const app = await db.monetizationApplication.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      contactEmail: true,
      acceptedTermsAt: true,
      submittedAt: true,
      reviewedAt: true,
      decisionNote: true,
      statsSnapshot: true,
      reviewer: { select: { id: true, displayName: true } },
      channel: { select: { ...channelRefSelect, followerCount: true, owner: { select: ownerSelect } } },
    },
  });
  if (!app || app.status === 'DRAFT') return null;
  const [live, previous] = await Promise.all([
    getLiveChannelStats(app.channel.id),
    db.monetizationApplication.findMany({
      where: { channelId: app.channel.id, id: { not: app.id }, status: { not: 'DRAFT' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { id: true, status: true, submittedAt: true, decisionNote: true },
    }),
  ]);
  return {
    id: app.id,
    status: app.status,
    contactEmail: app.contactEmail,
    acceptedTermsAt: app.acceptedTermsAt,
    submittedAt: app.submittedAt,
    reviewedAt: app.reviewedAt,
    reviewer: app.reviewer ? { id: app.reviewer.id, name: app.reviewer.displayName } : null,
    decisionNote: app.decisionNote,
    snapshot: parseSnapshot(app.statsSnapshot),
    channel: { ...toChannelRef(app.channel), followerCount: app.channel.followerCount },
    owner: toOwner(app.channel.owner),
    live,
    requirements: monetizationRequirements,
    previous,
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type EvidenceLink = { title: string; url: string; /** only http(s) URLs become clickable */ safe: boolean };

/** `evidenceLinks` is user-supplied JSON: normalize it and mark which links are safe to render as anchors. */
export function parseEvidenceLinks(raw: unknown): EvidenceLink[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceLink[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim().slice(0, 500) : '';
    if (!url) continue;
    let safe = false;
    try {
      const parsed = new URL(url);
      safe = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      safe = false;
    }
    out.push({ title: typeof o.title === 'string' && o.title.trim() ? truncate(o.title.trim(), 80) : url, url, safe });
  }
  return out;
}

export type VerificationListItem = {
  id: string;
  status: VerificationStatus;
  createdAt: Date;
  reviewedAt: Date | null;
  excerpt: string;
  evidenceCount: number;
  channel: ChannelRef & { followerCount: number };
};

export function verificationListWhere(f: VerificationListParams): Prisma.VerificationRequestWhereInput {
  const and: Prisma.VerificationRequestWhereInput[] = [];
  if (f.status === 'PENDING') and.push({ status: { in: [...PENDING_VERIFICATION_STATUSES] } });
  else if (f.status !== 'ALL') and.push({ status: f.status });
  if (f.q) and.push({ channel: { is: { OR: [{ name: ciContains(f.q) }, { handle: ciContains(f.q.replace(/^@/, '')) }] } } });
  return and.length ? { AND: and } : {};
}

export async function listVerification(filters: VerificationListParams): Promise<{ items: VerificationListItem[]; pageInfo: PageInfo }> {
  const where = verificationListWhere(filters);
  const total = await db.verificationRequest.count({ where });
  const pageInfo = paginate(total, filters.page);
  const rows = await db.verificationRequest.findMany({
    where,
    orderBy: filters.status === 'PENDING' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: { id: true, status: true, createdAt: true, reviewedAt: true, message: true, evidenceLinks: true, channel: { select: { ...channelRefSelect, followerCount: true } } },
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      excerpt: truncate(r.message, 160),
      evidenceCount: parseEvidenceLinks(r.evidenceLinks).length,
      channel: { ...toChannelRef(r.channel), followerCount: r.channel.followerCount },
    })),
    pageInfo,
  };
}

export type VerificationDetail = {
  id: string;
  status: VerificationStatus;
  message: string;
  evidence: EvidenceLink[];
  createdAt: Date;
  reviewedAt: Date | null;
  reviewer: { id: string; name: string } | null;
  decisionNote: string | null;
  channel: ChannelRef & { followerCount: number; videoCount: number; createdAt: Date; description: string };
  owner: Owner;
  previous: { id: string; status: VerificationStatus; createdAt: Date; decisionNote: string | null }[];
};

export async function getVerificationDetail(id: string): Promise<VerificationDetail | null> {
  const r = await db.verificationRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      message: true,
      evidenceLinks: true,
      createdAt: true,
      reviewedAt: true,
      decisionNote: true,
      reviewer: { select: { id: true, displayName: true } },
      channel: { select: { ...channelRefSelect, followerCount: true, createdAt: true, description: true, owner: { select: ownerSelect }, _count: { select: { videos: true } } } },
    },
  });
  if (!r) return null;
  const previous = await db.verificationRequest.findMany({
    where: { channelId: r.channel.id, id: { not: r.id } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 5,
    select: { id: true, status: true, createdAt: true, decisionNote: true },
  });
  return {
    id: r.id,
    status: r.status,
    message: r.message,
    evidence: parseEvidenceLinks(r.evidenceLinks),
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    reviewer: r.reviewer ? { id: r.reviewer.id, name: r.reviewer.displayName } : null,
    decisionNote: r.decisionNote,
    channel: { ...toChannelRef(r.channel), followerCount: r.channel.followerCount, videoCount: r.channel._count.videos, createdAt: r.channel.createdAt, description: r.channel.description },
    owner: toOwner(r.channel.owner),
    previous,
  };
}
