import { apiHandler } from '@/lib/api';
import { requireChannelUser } from '@/lib/auth/guards';
import { toActor } from '@/lib/auth/session';
import { Errors } from '@/lib/errors';
import { MAX_IMAGE_BYTES } from '@/lib/images';
import { mediaUrl } from '@/lib/media-url';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { readFormDataLimited } from '@/features/videos-studio/http';
import { studioLimits } from '@/features/videos-studio/limits';
import { videoIdSchema } from '@/features/videos-studio/schemas';
import { setCustomThumbnail } from '@/features/videos-studio/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/studio/videos/[id]/thumbnail  (multipart: `file`)
 * Custom poster. A Route Handler rather than a Server Action because Server Actions are capped at 2 MB, which phone
 * photos exceed. The image is decoded and re-encoded server-side (`lib/images`), never stored as sent.
 */
export const POST = apiHandler<{ id: string }>(async (req, { params }) => {
  const user = await requireChannelUser();
  const id = parse(videoIdSchema, params.id);
  await enforceRateLimit('studio:media', user.id, studioLimits.media);

  const form = await readFormDataLimited(req, MAX_IMAGE_BYTES + 64 * 1024, 'حجم تصویر نباید بیشتر از ۸ مگابایت باشد.');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw Errors.validation({ file: ['تصویر را انتخاب کنید.'] }, 'تصویر را انتخاب کنید.');

  const { posterKey } = await setCustomThumbnail(toActor(user), id, Buffer.from(await file.arrayBuffer()));
  return { posterUrl: mediaUrl(posterKey) };
});
