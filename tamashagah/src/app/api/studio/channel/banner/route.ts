import { imageRoutes } from '@/features/settings/image-routes';

export const dynamic = 'force-dynamic';

/** POST/DELETE /api/studio/channel/banner — the banner of the signed-in user's channel (1920×480 webp). */
const handlers = imageRoutes('channelBanner');
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
