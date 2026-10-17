import 'server-only';
import { db } from '@/lib/db';
import { mediaUrl } from '@/lib/media-url';
import { publicVideoWhere } from '@/features/videos/visibility';
import type { TicketCategory, TicketStatus, VerificationStatus } from '@/generated/prisma/enums';
import { OPEN_VERIFICATION_STATUSES, evaluateVerificationRequirements, type RequirementState } from './rules';

export const TICKETS_PAGE_SIZE = 20;

export type TicketListItem = {
  id: string;
  number: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** The last word was the support team's — the user has something to read. */
  awaitingUser: boolean;
};

/** Tickets of ONE user, most recently active first. */
export async function listMyTickets(userId: string, page: number) {
  const where = { userId };
  const [total, rows] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * TICKETS_PAGE_SIZE,
      take: TICKETS_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        subject: true,
        category: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { isStaff: true } },
      },
    }),
  ]);
  const tickets: TicketListItem[] = rows.map((t) => ({
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    messageCount: t._count.messages,
    awaitingUser: t.status === 'ANSWERED' && t.messages[0]?.isStaff === true,
  }));
  return { tickets, total, pageCount: Math.max(1, Math.ceil(total / TICKETS_PAGE_SIZE)) };
}

export type TicketMessageView = { id: string; body: string; isStaff: boolean; createdAt: string };

export type TicketThread = {
  id: string;
  number: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: string;
  messages: TicketMessageView[];
};

/**
 * One ticket, only if it belongs to `userId` (anything else is `null` → 404). Staff identities are never selected:
 * the user only sees "support team".
 */
export async function getMyTicket(userId: string, id: string): Promise<TicketThread | null> {
  const ticket = await db.supportTicket.findFirst({
    where: { id, userId },
    select: {
      id: true,
      number: true,
      subject: true,
      category: true,
      status: true,
      createdAt: true,
      messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 300, select: { id: true, body: true, isStaff: true, createdAt: true } },
    },
  });
  if (!ticket) return null;
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    messages: ticket.messages.map((m) => ({ id: m.id, body: m.body, isStaff: m.isStaff, createdAt: m.createdAt.toISOString() })),
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerificationRequestView = {
  id: string;
  status: VerificationStatus;
  message: string;
  decisionNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type VerificationOverview = {
  channel: { id: string; name: string; handle: string; avatarUrl: string | null; isVerified: boolean; suspended: boolean };
  requirements: { items: RequirementState[]; allMet: boolean };
  /** A request the team has not decided yet (blocks a new one). */
  open: VerificationRequestView | null;
  /** The most recent decided request (approved/rejected), for the decision note. */
  lastDecided: VerificationRequestView | null;
};

const toRequestView = (r: {
  id: string;
  status: VerificationStatus;
  message: string;
  decisionNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}): VerificationRequestView => ({
  id: r.id,
  status: r.status,
  message: r.message,
  decisionNote: r.decisionNote,
  createdAt: r.createdAt.toISOString(),
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
});

export async function getVerificationOverview(user: { channelId: string; emailVerified: boolean }): Promise<VerificationOverview | null> {
  const channel = await db.channel.findUnique({
    where: { id: user.channelId },
    select: { id: true, name: true, handle: true, avatarKey: true, description: true, isVerified: true, suspendedAt: true, createdAt: true },
  });
  if (!channel) return null;
  const [publicVideoCount, open, lastDecided] = await Promise.all([
    db.video.count({ where: { ...publicVideoWhere, channelId: channel.id } }),
    db.verificationRequest.findFirst({
      where: { channelId: channel.id, status: { in: [...OPEN_VERIFICATION_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, message: true, decisionNote: true, createdAt: true, reviewedAt: true },
    }),
    db.verificationRequest.findFirst({
      where: { channelId: channel.id, status: { in: ['APPROVED', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, message: true, decisionNote: true, createdAt: true, reviewedAt: true },
    }),
  ]);
  return {
    channel: {
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      avatarUrl: mediaUrl(channel.avatarKey),
      isVerified: channel.isVerified,
      suspended: channel.suspendedAt !== null,
    },
    requirements: evaluateVerificationRequirements({
      emailVerified: user.emailVerified,
      hasAvatar: !!channel.avatarKey,
      descriptionLength: channel.description.trim().length,
      channelCreatedAt: channel.createdAt,
      publicVideoCount,
      now: new Date(),
    }),
    open: open ? toRequestView(open) : null,
    lastDecided: lastDecided ? toRequestView(lastDecided) : null,
  };
}
