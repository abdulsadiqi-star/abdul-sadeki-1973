import '@/lib/zod-fa';
import { z } from 'zod';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { normalizeUserText } from '@/lib/persian';

export const PLAYLIST_TITLE_MAX = 100;
export const PLAYLIST_DESCRIPTION_MAX = 500;
/** A user may own at most this many custom playlists (a guard against scripted abuse). */
export const MAX_PLAYLISTS_PER_USER = 100;

export const videoIdSchema = z.string().regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.');
export const playlistIdSchema = z.string().min(5).max(60).regex(/^[A-Za-z0-9_-]+$/, 'شناسه‌ی لیست نامعتبر است.');

export const visibilitySchema = z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE'], { error: 'وضعیت نمایش نامعتبر است.' });

const title = z
  .string('عنوان لیست را بنویسید.')
  .transform((v) => normalizeUserText(v))
  .pipe(
    z
      .string()
      .min(2, 'عنوان لیست باید دست‌کم ۲ نویسه باشد.')
      .max(PLAYLIST_TITLE_MAX, `عنوان لیست نباید بیشتر از ${PLAYLIST_TITLE_MAX} نویسه باشد.`),
  );

const description = z
  .string()
  .transform((v) => normalizeUserText(v, { multiline: true }))
  .pipe(z.string().max(PLAYLIST_DESCRIPTION_MAX, `توضیح نباید بیشتر از ${PLAYLIST_DESCRIPTION_MAX} نویسه باشد.`))
  .default('');

export const createPlaylistSchema = z.object({ title, description, visibility: visibilitySchema.default('PRIVATE') });
export const updatePlaylistSchema = z.object({ id: playlistIdSchema, title, description, visibility: visibilitySchema });
export const deletePlaylistSchema = z.object({ id: playlistIdSchema });
export const removeFromPlaylistSchema = z.object({ playlistId: playlistIdSchema, videoId: videoIdSchema });
export const removeHistoryItemSchema = z.object({ videoId: videoIdSchema });

export type CreatePlaylistInput = z.input<typeof createPlaylistSchema>;
export type UpdatePlaylistInput = z.input<typeof updatePlaylistSchema>;
