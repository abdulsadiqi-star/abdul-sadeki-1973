import type { Prisma } from '@/generated/prisma/client';
import type { VideoKind } from '@/generated/prisma/enums';
import { mediaUrl } from '@/lib/media-url';

/**
 * The one shape every video list uses (home, search, channel, related, studio
 * previews, ...). Rows are mapped to plain serializable data so they can be
 * passed from Server Components to Client Components.
 *
 *   const rows = await db.video.findMany({ where: publicVideoWhere, select: videoCardSelect, ... });
 *   const cards = rows.map(toVideoCard);
 */
export const videoCardSelect = {
  id: true,
  title: true,
  kind: true,
  durationSeconds: true,
  viewCount: true,
  publishedAt: true,
  createdAt: true,
  posterKey: true,
  channel: { select: { id: true, handle: true, name: true, avatarKey: true, isVerified: true } },
} satisfies Prisma.VideoSelect;

export type VideoCardRow = Prisma.VideoGetPayload<{ select: typeof videoCardSelect }>;

export type ChannelMini = {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  isVerified: boolean;
};

export type VideoCardData = {
  id: string;
  title: string;
  kind: VideoKind;
  durationSeconds: number | null;
  viewCount: number;
  /** ISO string (publishedAt, falling back to createdAt). */
  publishedAt: string;
  posterUrl: string | null;
  channel: ChannelMini;
};

export function toChannelMini(channel: VideoCardRow['channel']): ChannelMini {
  return {
    id: channel.id,
    handle: channel.handle,
    name: channel.name,
    avatarUrl: mediaUrl(channel.avatarKey),
    isVerified: channel.isVerified,
  };
}

export function toVideoCard(row: VideoCardRow): VideoCardData {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    durationSeconds: row.durationSeconds,
    viewCount: row.viewCount,
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    posterUrl: mediaUrl(row.posterKey),
    channel: toChannelMini(row.channel),
  };
}

/** Preserve the order of `ids` when hydrating cards fetched with `id: { in: ids }`. */
export function sortByIds<T extends { id: string }>(rows: T[], ids: readonly string[]): T[] {
  const order = new Map(ids.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
