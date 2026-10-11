import 'server-only';
import { db } from '@/lib/db';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { truncate } from '@/lib/persian';
import type { Formatter } from '@/lib/format';
import { describeModerationAction } from '@/features/moderation/describe';
import type { Prisma } from '@/generated/prisma/client';
import type { ModerationActionType, UserRole } from '@/generated/prisma/enums';
import { ADMIN_ONLY_ACTION_TYPES, auditScopeFor, type AuditScope } from '../policy';
import { tehranDayEnd, tehranDayStart, type ActivityListParams } from '../schemas';
import { ciContains, paginate, type PageInfo } from './common';

export type ActivityLink = { kind: 'video' | 'channel' | 'user' | 'report' | 'comment'; label: string; href: string };

export type ActivityItem = {
  id: string;
  type: ModerationActionType;
  /** ISO string */
  createdAt: string;
  actor: { id: string; name: string; role: UserRole } | null;
  /** Persian sentence parts: `<actor> <predicate>` */
  sentence: { actor: string; predicate: string; text: string };
  reason: string | null;
  /** Excerpt of the affected comment, when there is one. */
  commentExcerpt: string | null;
  links: ActivityLink[];
};

const activitySelect = {
  id: true,
  type: true,
  reason: true,
  meta: true,
  createdAt: true,
  reportId: true,
  actor: { select: { id: true, displayName: true, role: true } },
  targetUser: { select: { id: true, displayName: true } },
  video: { select: { id: true, title: true } },
  channel: { select: { id: true, name: true, handle: true } },
  comment: { select: { id: true, body: true } },
} satisfies Prisma.ModerationActionSelect;

type Row = Prisma.ModerationActionGetPayload<{ select: typeof activitySelect }>;

export function toActivityItem(row: Row, f: Pick<Formatter, 'number'>): ActivityItem {
  const description = describeModerationAction(
    {
      type: row.type,
      actor: row.actor ? { name: row.actor.displayName } : null,
      targetUser: row.targetUser ? { name: row.targetUser.displayName } : null,
      videoTitle: row.video?.title ?? null,
      channelName: row.channel?.name ?? null,
      meta: row.meta,
    },
    f,
  );
  const links: ActivityLink[] = [];
  if (row.video) links.push({ kind: 'video', label: truncate(row.video.title, 40), href: `/watch/${row.video.id}` });
  if (row.channel) links.push({ kind: 'channel', label: row.channel.name, href: `/admin/channels/${row.channel.id}` });
  if (row.targetUser) links.push({ kind: 'user', label: row.targetUser.displayName, href: `/admin/users/${row.targetUser.id}` });
  if (row.reportId) links.push({ kind: 'report', label: 'گزارش مرتبط', href: `/admin/reports/${row.reportId}` });
  return {
    id: row.id,
    type: row.type,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor ? { id: row.actor.id, name: row.actor.displayName, role: row.actor.role } : null,
    sentence: { actor: description.actor, predicate: description.predicate, text: description.sentence },
    reason: row.reason,
    commentExcerpt: row.comment ? truncate(row.comment.body, 120) : null,
    links,
  };
}

/** What a viewer may see: administrators everything, moderators their own rows + content moderation. */
export function scopeWhere(scope: AuditScope): Prisma.ModerationActionWhereInput {
  if (scope.kind === 'all') return {};
  return { OR: [{ actorId: scope.actorId }, { type: { notIn: [...ADMIN_ONLY_ACTION_TYPES] } }] };
}

const LOOKS_LIKE_ID = /^[a-z0-9]{20,40}$/;

/** "Target" is free text: an id of a video / comment / channel / user / report, a channel handle, an e-mail or part of a name or title. */
function targetWhere(raw: string): Prisma.ModerationActionWhereInput {
  const text = raw.trim();
  const or: Prisma.ModerationActionWhereInput[] = [
    { targetUser: { is: { OR: [{ email: ciContains(text) }, { displayName: ciContains(text) }] } } },
    { channel: { is: { OR: [{ handle: ciContains(text) }, { name: ciContains(text) }] } } },
    { video: { is: { title: ciContains(text) } } },
  ];
  if (VIDEO_ID_REGEX.test(text)) or.push({ videoId: text });
  if (LOOKS_LIKE_ID.test(text)) or.push({ commentId: text }, { channelId: text }, { targetUserId: text }, { reportId: text });
  return { OR: or };
}

export function activityWhere(viewer: { id: string; role: UserRole }, filters: Partial<ActivityListParams>): Prisma.ModerationActionWhereInput | null {
  const scope = auditScopeFor(viewer);
  if (!scope) return null;
  const and: Prisma.ModerationActionWhereInput[] = [scopeWhere(scope)];
  if (filters.type && filters.type !== 'ALL') and.push({ type: filters.type });
  if (filters.actor) and.push({ actor: { is: { OR: [{ displayName: ciContains(filters.actor) }, { email: ciContains(filters.actor) }] } } });
  if (filters.target) and.push(targetWhere(filters.target));
  if (filters.from) and.push({ createdAt: { gte: tehranDayStart(filters.from) } });
  if (filters.to) and.push({ createdAt: { lt: tehranDayEnd(filters.to) } });
  return { AND: and };
}

export async function listActivity(
  viewer: { id: string; role: UserRole },
  filters: ActivityListParams,
  f: Pick<Formatter, 'number'>,
): Promise<{ items: ActivityItem[]; pageInfo: PageInfo }> {
  const where = activityWhere(viewer, filters);
  if (!where) return { items: [], pageInfo: paginate(0, 1) };
  const total = await db.moderationAction.count({ where });
  const pageInfo = paginate(total, filters.page);
  const rows = await db.moderationAction.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: activitySelect,
  });
  return { items: rows.map((r) => toActivityItem(r, f)), pageInfo };
}

/** Latest rows for the overview page (same visibility rules as the full log). */
export async function getRecentActivity(viewer: { id: string; role: UserRole }, f: Pick<Formatter, 'number'>, take = 8): Promise<ActivityItem[]> {
  const where = activityWhere(viewer, {});
  if (!where) return [];
  const rows = await db.moderationAction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: activitySelect });
  return rows.map((r) => toActivityItem(r, f));
}

/** History of earlier decisions about one target (report / user / channel detail) — filtered by what the viewer may see. */
export async function getActionHistory(
  viewer: { id: string; role: UserRole },
  where: Prisma.ModerationActionWhereInput,
  f: Pick<Formatter, 'number'>,
  take = 12,
): Promise<ActivityItem[]> {
  const scope = auditScopeFor(viewer);
  if (!scope) return [];
  const rows = await db.moderationAction.findMany({
    where: { AND: [scopeWhere(scope), where] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: activitySelect,
  });
  return rows.map((r) => toActivityItem(r, f));
}
