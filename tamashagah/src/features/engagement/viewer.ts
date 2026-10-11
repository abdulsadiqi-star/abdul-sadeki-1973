import type { CurrentUser } from '@/lib/auth/session';
import type { Viewer } from './service';

/** The slice of the signed-in user that engagement services need (ownership, role, verification, display name). */
export function toViewer(user: CurrentUser): Viewer {
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    channelId: user.channel?.id ?? null,
    emailVerified: user.emailVerified,
  };
}
