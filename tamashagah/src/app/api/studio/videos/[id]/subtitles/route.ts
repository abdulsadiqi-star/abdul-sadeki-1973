import { apiHandler } from '@/lib/api';
import { requireChannelUser } from '@/lib/auth/guards';
import { toActor } from '@/lib/auth/session';
import { Errors } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { readFormDataLimited } from '@/features/videos-studio/http';
import { studioLimits } from '@/features/videos-studio/limits';
import { subtitleUploadSchema, videoIdSchema } from '@/features/videos-studio/schemas';
import { addSubtitle } from '@/features/videos-studio/service';
import { MAX_SUBTITLE_BYTES } from '@/features/videos-studio/subtitles';

export const dynamic = 'force-dynamic';

/**
 * POST /api/studio/videos/[id]/subtitles  (multipart: `file` = .srt / .vtt, `language`, `label`)
 * SRT is converted to WebVTT on the server; one subtitle per language (uploading the same language replaces it).
 */
export const POST = apiHandler<{ id: string }>(async (req, { params }) => {
  const user = await requireChannelUser();
  const id = parse(videoIdSchema, params.id);
  await enforceRateLimit('studio:media', user.id, studioLimits.media);

  const form = await readFormDataLimited(req, MAX_SUBTITLE_BYTES + 64 * 1024, 'حجم فایل زیرنویس نباید بیشتر از ۱ مگابایت باشد.');
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw Errors.validation({ file: ['فایل زیرنویس را انتخاب کنید.'] }, 'فایل زیرنویس را انتخاب کنید.');
  const meta = parse(subtitleUploadSchema, { language: form.get('language'), label: form.get('label') });

  const result = await addSubtitle(toActor(user), id, { ...meta, bytes: new Uint8Array(await file.arrayBuffer()) });
  return result;
});
