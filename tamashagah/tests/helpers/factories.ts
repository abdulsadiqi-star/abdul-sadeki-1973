/**
 * Data factories for integration tests. Everything is created through Prisma
 * (no HTTP), with realistic Persian defaults.
 *
 *   const owner = await createUser({ withChannel: true });
 *   const video = await createVideo(owner.channel!.id, { state: 'public' });
 */
import { db } from '@/lib/db';
import { newVideoId, randomToken } from '@/lib/ids';
import { buildChannelSearchName, buildVideoSearchFields } from '@/lib/persian';
import type { Prisma } from '@/generated/prisma/client';
import type { UserRole, Visibility } from '@/generated/prisma/enums';

let counter = 0;
const next = () => ++counter;

export async function createUser(
  opts: { email?: string; role?: UserRole; displayName?: string; verified?: boolean; withChannel?: boolean; handle?: string } = {},
) {
  const n = next();
  const user = await db.user.create({
    data: {
      email: opts.email ?? `user${n}-${randomToken(4).toLowerCase()}@example.test`,
      displayName: opts.displayName ?? `کاربر ${n}`,
      role: opts.role ?? (opts.withChannel ? 'CREATOR' : 'USER'),
      passwordHash: 'not-a-real-hash',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
  const channel = opts.withChannel
    ? await createChannel(user.id, { handle: opts.handle, name: `کانال ${n}` })
    : null;
  return { ...user, channel };
}

export async function createChannel(ownerId: string, opts: { handle?: string; name?: string } = {}) {
  const n = next();
  const handle = opts.handle ?? `channel-${n}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  const name = opts.name ?? `کانال ${n}`;
  return db.channel.create({
    data: { ownerId, handle, name, searchName: buildChannelSearchName(name, handle) },
  });
}

export type VideoState = 'public' | 'unlisted' | 'private' | 'draft' | 'processing' | 'failed' | 'scheduled' | 'takedown';

/** Create a video in a well-defined lifecycle state. */
export async function createVideo(
  channelId: string,
  opts: { state?: VideoState; title?: string; description?: string; tags?: string[]; categoryId?: string; viewCount?: number; durationSeconds?: number; kind?: 'VIDEO' | 'SHORT'; publishedAt?: Date } = {},
) {
  const state = opts.state ?? 'public';
  const title = opts.title ?? `ویدیوی نمونه ${next()}`;
  const channel = await db.channel.findUniqueOrThrow({ where: { id: channelId }, select: { name: true } });
  const search = buildVideoSearchFields({ title, description: opts.description, tags: opts.tags, channelName: channel.name });

  const data: Prisma.VideoUncheckedCreateInput = {
    id: newVideoId(),
    channelId,
    title,
    description: opts.description ?? '',
    tags: opts.tags ?? [],
    categoryId: opts.categoryId,
    kind: opts.kind ?? 'VIDEO',
    viewCount: opts.viewCount ?? 0,
    durationSeconds: opts.durationSeconds ?? 120,
    width: 1280,
    height: 720,
    processingStatus: 'READY',
    publishStatus: 'PUBLISHED',
    visibility: 'PUBLIC' satisfies Visibility,
    publishedAt: opts.publishedAt ?? new Date(),
    posterKey: null,
    hlsMasterKey: null,
    ...search,
  };

  switch (state) {
    case 'unlisted':
      data.visibility = 'UNLISTED';
      break;
    case 'private':
      data.visibility = 'PRIVATE';
      break;
    case 'draft':
      data.publishStatus = 'DRAFT';
      data.publishedAt = null;
      break;
    case 'processing':
      data.processingStatus = 'PROCESSING';
      data.publishStatus = 'DRAFT';
      data.publishedAt = null;
      data.durationSeconds = null;
      break;
    case 'failed':
      data.processingStatus = 'FAILED';
      data.publishStatus = 'DRAFT';
      data.publishedAt = null;
      data.failureReason = 'test failure';
      break;
    case 'scheduled':
      data.publishStatus = 'SCHEDULED';
      data.publishedAt = null;
      data.scheduledFor = new Date(Date.now() + 86_400_000);
      break;
    case 'takedown':
      data.takedownAt = new Date();
      data.takedownReason = 'test takedown';
      break;
  }
  return db.video.create({ data });
}

export async function createCategory(slug: string, nameFa = slug) {
  return db.category.create({ data: { slug, nameFa } });
}
