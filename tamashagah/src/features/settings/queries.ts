import 'server-only';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { mediaUrl } from '@/lib/media-url';
import type { CommentsMode, DigitStyle, Visibility } from '@/generated/prisma/enums';
import type { DeviceKind } from '@/lib/request';
import { describeUserAgent, parseUserAgent } from './user-agent';
import { parseStoredLinks, type ChannelLink } from './schemas';

export type AccountSettings = {
  displayName: string;
  email: string;
  emailVerified: boolean;
  digitStyle: DigitStyle;
  notifyByEmail: boolean;
  /** The user's OWN avatar (the header shows the channel avatar first when there is one). */
  avatarUrl: string | null;
};

export async function getAccountSettings(userId: string): Promise<AccountSettings> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true, email: true, emailVerifiedAt: true, digitStyle: true, notifyByEmail: true, avatarKey: true },
  });
  return {
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    digitStyle: user.digitStyle,
    notifyByEmail: user.notifyByEmail,
    avatarUrl: mediaUrl(user.avatarKey),
  };
}

export type ChannelSettingsView = {
  name: string;
  handle: string;
  description: string;
  links: ChannelLink[];
  commentsMode: CommentsMode;
  defaultVisibility: Visibility;
  avatarUrl: string | null;
  bannerUrl: string | null;
};

export async function getChannelSettings(channelId: string): Promise<ChannelSettingsView> {
  const channel = await db.channel.findUniqueOrThrow({
    where: { id: channelId },
    select: { name: true, handle: true, description: true, links: true, commentsMode: true, defaultVisibility: true, avatarKey: true, bannerKey: true },
  });
  return {
    name: channel.name,
    handle: channel.handle,
    description: channel.description,
    links: parseStoredLinks(channel.links),
    commentsMode: channel.commentsMode,
    defaultVisibility: channel.defaultVisibility,
    avatarUrl: mediaUrl(channel.avatarKey),
    bannerUrl: mediaUrl(channel.bannerKey),
  };
}

export type SessionItem = {
  id: string;
  /** "Chrome روی ویندوز" */
  label: string;
  kind: DeviceKind;
  /** ISO strings */
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
};

/**
 * The user's sessions that would still be accepted by `getCurrentUser()` (not revoked, not expired, within the
 * absolute lifetime), most recently used first.
 */
export async function listActiveSessions(userId: string, currentSessionId: string, now: Date = new Date()): Promise<SessionItem[]> {
  const absoluteLimit = new Date(now.getTime() - env.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000);
  const rows = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now }, createdAt: { gt: absoluteLimit } },
    orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    label: describeUserAgent(row.userAgent),
    kind: parseUserAgent(row.userAgent).kind,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    current: row.id === currentSessionId,
  }));
}
