import { imageRoutes } from '@/features/settings/image-routes';

export const dynamic = 'force-dynamic';

/** POST/DELETE /api/studio/account/avatar — the signed-in user's own avatar (400×400 webp). */
const handlers = imageRoutes('userAvatar');
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
