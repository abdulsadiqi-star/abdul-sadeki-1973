import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import { isVideoId } from '@/lib/ids';
import { listPlaylistsForVideo } from '@/features/engagement/playlists';

/**
 * GET /api/videos/[id]/playlists → { playlists: [{ id, title, visibility, itemCount, contains }] }
 * The signed-in user's custom playlists for the watch page's "save to playlist" menu.
 */
export const GET = apiHandler<{ id: string }>(async (_req, { params }) => {
  if (!isVideoId(params.id)) throw Errors.notFound('ویدیو پیدا نشد.');
  const user = await requireUser();
  const playlists = await listPlaylistsForVideo(user.id, params.id);
  return Response.json({ playlists }, { headers: { 'Cache-Control': 'private, no-store' } });
});
