import { revalidatePath } from 'next/cache';
import { apiHandler } from '@/lib/api';
import { requireChannelUser, requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/rate-limit';
import { removeImage, replaceImage, type ImageSlot } from './images';
import { settingsLimits } from './limits';
import { readImageUpload } from './upload';

/**
 * The Route Handlers of the three image slots share one implementation:
 *
 *   POST   multipart/form-data, field `file`  → `{ url }` of the new image
 *   DELETE                                    → removes the image (initials are shown again)
 *
 * Every request: Origin check (apiHandler) → session → rate limit → bounded body read → magic-byte validation and
 * re-encoding → storage + DB swap with cleanup of the replaced file. The owner is ALWAYS the signed-in user (or their
 * channel); there is no id in the request.
 */
export function imageRoutes(slot: ImageSlot) {
  const authenticate = async () => {
    if (slot === 'userAvatar') {
      const user = await requireUser();
      return { userId: user.id, ownerId: user.id };
    }
    const user = await requireChannelUser();
    return { userId: user.id, ownerId: user.channel.id };
  };

  const POST = apiHandler(async (req) => {
    const { userId, ownerId } = await authenticate();
    await enforceRateLimit('image-upload:user', userId, settingsLimits.imageUpload);
    const upload = await readImageUpload(req);
    const { url } = await replaceImage(slot, ownerId, upload);
    revalidatePath('/', 'layout');
    return { url };
  });

  const DELETE = apiHandler(async () => {
    const { userId, ownerId } = await authenticate();
    await enforceRateLimit('settings-write:user', userId, settingsLimits.write);
    await removeImage(slot, ownerId);
    revalidatePath('/', 'layout');
    return { url: null };
  });

  return { POST, DELETE };
}
