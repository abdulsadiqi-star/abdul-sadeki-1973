import 'server-only';
import { db } from '@/lib/db';
import { truncate } from '@/lib/persian';
import type { Prisma } from '@/generated/prisma/client';
import type { TicketCategory, TicketStatus, UserRole, UserStatus } from '@/generated/prisma/enums';
import type { SupportListParams } from '../schemas';
import { ciContains, paginate, type PageInfo } from './common';

export type SupportListItem = {
  id: string;
  number: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string } | null;
  messageCount: number;
  lastMessage: { excerpt: string; isStaff: boolean } | null;
};

export function supportListWhere(f: SupportListParams): Prisma.SupportTicketWhereInput {
  const and: Prisma.SupportTicketWhereInput[] = [];
  if (f.status === 'ACTIVE') and.push({ status: { in: ['OPEN', 'ANSWERED'] } });
  else if (f.status !== 'ALL') and.push({ status: f.status });
  if (f.category !== 'ALL') and.push({ category: f.category });
  if (f.q) {
    const digits = /^\d{1,9}$/.test(f.q.trim()) ? Number(f.q.trim()) : null;
    const or: Prisma.SupportTicketWhereInput[] = [{ subject: ciContains(f.q) }, { email: ciContains(f.q) }, { user: { is: { displayName: ciContains(f.q) } } }];
    if (digits !== null) or.push({ number: digits });
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}

export async function listSupportTickets(filters: SupportListParams): Promise<{ items: SupportListItem[]; pageInfo: PageInfo }> {
  const where = supportListWhere(filters);
  const total = await db.supportTicket.count({ where });
  const pageInfo = paginate(total, filters.page);
  // Waiting tickets first (OPEN < ANSWERED in the enum), the longest-waiting on top; archives newest first.
  const orderBy: Prisma.SupportTicketOrderByWithRelationInput[] =
    filters.status === 'ACTIVE'
      ? [{ status: 'asc' }, { updatedAt: 'asc' }, { id: 'asc' }]
      : filters.status === 'OPEN'
        ? [{ updatedAt: 'asc' }, { id: 'asc' }]
        : [{ updatedAt: 'desc' }, { id: 'desc' }];
  const rows = await db.supportTicket.findMany({
    where,
    orderBy,
    skip: pageInfo.skip,
    take: pageInfo.pageSize,
    select: {
      id: true,
      number: true,
      subject: true,
      category: true,
      status: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, displayName: true } },
      _count: { select: { messages: true } },
      messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { body: true, isStaff: true } },
    },
  });
  return {
    items: rows.map((t) => ({
      id: t.id,
      number: t.number,
      subject: t.subject,
      category: t.category,
      status: t.status,
      email: t.email,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      user: t.user ? { id: t.user.id, name: t.user.displayName } : null,
      messageCount: t._count.messages,
      lastMessage: t.messages[0] ? { excerpt: truncate(t.messages[0].body, 120), isStaff: t.messages[0].isStaff } : null,
    })),
    pageInfo,
  };
}

export type TicketDetail = {
  id: string;
  number: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string; email: string; role: UserRole; status: UserStatus } | null;
  messages: { id: string; body: string; isStaff: boolean; createdAt: Date; authorName: string | null }[];
};

export async function getTicketDetail(id: string): Promise<TicketDetail | null> {
  const t = await db.supportTicket.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      subject: true,
      category: true,
      status: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, displayName: true, email: true, role: true, status: true } },
      messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200, select: { id: true, body: true, isStaff: true, createdAt: true, author: { select: { displayName: true } } } },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    status: t.status,
    email: t.email,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    user: t.user ? { id: t.user.id, name: t.user.displayName, email: t.user.email, role: t.user.role, status: t.user.status } : null,
    messages: t.messages.map((m) => ({ id: m.id, body: m.body, isStaff: m.isStaff, createdAt: m.createdAt, authorName: m.author?.displayName ?? null })),
  };
}
