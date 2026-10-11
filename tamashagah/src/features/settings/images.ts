import { db, type Prisma } from '@/lib/db';
import { processImage } from '@/lib/images';
import { randomToken } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { mediaUrl } from '@/lib/media-url';
import { assertSafeKey, getStorage, keys } from '@/lib/storage';

/**
 * Avatar and banner replacement. The flow is the same for the three image slots:
 *
 *   1. decode + re-encode the upload (`processImage`: magic bytes, pixel cap, metadata stripped, webp);
 *   2. write the NEW object under a fresh random key (so URLs are immutable and cache-safe);
 *   3. in one transaction lock the row (`FOR UPDATE`), remember the OLD key and point the row at the new one;
 *   4. only after the commit delete the old object — a failure anywhere earlier removes the new object again,
 *      so storage never keeps files nothing references and a replaced image never lingers.
 *
 * The old key is deleted only when it really lives inside this owner's folder (`isOwnedImageKey`), because the
 * column could hold anything written by other code.
 */

type Slot = {
  kind: 'avatars' | 'banners';
  width: number;
  height: number;
  quality: number;
  makeKey: (ownerFolder: string, token: string) => string;
};

const SLOTS = {
  userAvatar: { kind: 'avatars', width: 400, height: 400, quality: 82, makeKey: (id, t) => keys.avatar(id, t) },
  channelAvatar: { kind: 'avatars', width: 400, height: 400, quality: 82, makeKey: (id, t) => keys.avatar(id, t) },
  channelBanner: { kind: 'banners', width: 1920, height: 480, quality: 80, makeKey: (id, t) => keys.banner(id, t) },
} as const satisfies Record<string, Slot>;

export type ImageSlot = keyof typeof SLOTS;

type Tx = Prisma.TransactionClient;

/** Row access per slot: lock + read the current key, write the new one. */
const ROWS: Record<ImageSlot, { lock: (tx: Tx, id: string) => Promise<string | null | undefined>; write: (tx: Tx, id: string, key: string | null) => Promise<unknown> }> = {
  userAvatar: {
    lock: async (tx, id) => (await tx.$queryRaw<{ currentKey: string | null }[]>`SELECT "avatarKey" AS "currentKey" FROM "User" WHERE "id" = ${id} FOR UPDATE`)[0]?.currentKey,
    write: (tx, id, key) => tx.user.update({ where: { id }, data: { avatarKey: key } }),
  },
  channelAvatar: {
    lock: async (tx, id) => (await tx.$queryRaw<{ currentKey: string | null }[]>`SELECT "avatarKey" AS "currentKey" FROM "Channel" WHERE "id" = ${id} FOR UPDATE`)[0]?.currentKey,
    write: (tx, id, key) => tx.channel.update({ where: { id }, data: { avatarKey: key } }),
  },
  channelBanner: {
    lock: async (tx, id) => (await tx.$queryRaw<{ currentKey: string | null }[]>`SELECT "bannerKey" AS "currentKey" FROM "Channel" WHERE "id" = ${id} FOR UPDATE`)[0]?.currentKey,
    write: (tx, id, key) => tx.channel.update({ where: { id }, data: { bannerKey: key } }),
  },
};

/** True only for `images/<kind>/<ownerId>/<token>.<ext>` keys inside this owner's folder. */
export function isOwnedImageKey(key: string, kind: 'avatars' | 'banners', ownerId: string): boolean {
  try {
    assertSafeKey(key);
  } catch {
    return false;
  }
  const prefix = `images/${kind}/${ownerId}/`;
  return key.startsWith(prefix) && /^[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/.test(key.slice(prefix.length));
}

async function swap(slot: ImageSlot, ownerId: string, newKey: string | null): Promise<void> {
  const { kind } = SLOTS[slot];
  const rows = ROWS[slot];
  let previous: string | null | undefined;
  try {
    previous = await db.$transaction(async (tx) => {
      const current = await rows.lock(tx, ownerId);
      await rows.write(tx, ownerId, newKey);
      return current;
    });
  } catch (error) {
    if (newKey) await getStorage().delete(newKey).catch(() => undefined);
    throw error;
  }
  if (previous && previous !== newKey && isOwnedImageKey(previous, kind, ownerId)) {
    await getStorage()
      .delete(previous)
      .catch((err: unknown) => logger.warn({ err, key: previous }, 'could not delete the replaced image'));
  }
}

/** Replace the image of `slot` for `ownerId` (a user id for `userAvatar`, a channel id otherwise). Returns its public URL. */
export async function replaceImage(slot: ImageSlot, ownerId: string, upload: Buffer): Promise<{ url: string }> {
  const config = SLOTS[slot];
  const processed = await processImage(upload, { width: config.width, height: config.height, fit: 'cover', format: 'webp', quality: config.quality });
  const key = config.makeKey(ownerId, randomToken(9));
  await getStorage().put(key, processed.data, { contentType: processed.contentType, cacheControl: 'public, max-age=31536000, immutable' });
  await swap(slot, ownerId, key);
  return { url: mediaUrl(key)! };
}

/** Remove the image of `slot` (the row falls back to initials) and delete its file. */
export async function removeImage(slot: ImageSlot, ownerId: string): Promise<void> {
  await swap(slot, ownerId, null);
}
