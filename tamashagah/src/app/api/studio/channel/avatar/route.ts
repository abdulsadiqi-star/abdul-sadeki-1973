import { imageRoutes } from '@/features/settings/image-routes';

export const dynamic = 'force-dynamic';

/** POST/DELETE /api/studio/channel/avatar — the avatar of the signed-in user's channel (400×400 webp). */
const handlers = imageRoutes('channelAvatar');
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
