import { describe, expect, it } from 'vitest';
import { loadManagedVideo } from '@/features/videos-studio/service';
import { canModerateComments, ownsChannel } from '@/lib/permissions';
import { createUser, createVideo } from '../helpers/factories';

const actorOf = (u: Awaited<ReturnType<typeof createUser>>) => ({ id: u.id, role: u.role, channelId: u.channel?.id ?? null, status: 'ACTIVE' as const, emailVerified: true });

describe('studio mutations are owner-only (moderators go through the audited staff panel)', () => {
  it('a moderator who owns a channel cannot manage someone else’s video or comments', async () => {
    const admin = await createUser({ role: 'ADMIN', withChannel: true });
    const moderator = await createUser({ role: 'MODERATOR', withChannel: true });
    const video = await createVideo(admin.channel!.id, { state: 'public' });
    await expect(loadManagedVideo(actorOf(moderator) as never, video.id)).rejects.toMatchObject({ status: 404 });
    expect(canModerateComments(actorOf(moderator) as never, { channelId: admin.channel!.id })).toBe(false);
    expect(ownsChannel(actorOf(admin) as never, admin.channel!.id)).toBe(true);
    await expect(loadManagedVideo(actorOf(admin) as never, video.id)).resolves.toMatchObject({ id: video.id });
  });
});
