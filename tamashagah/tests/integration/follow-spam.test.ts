import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setFollow, type Viewer } from '@/features/engagement/service';
import { createUser } from '../helpers/factories';

describe('follow/unfollow cycling', () => {
  it('notifies the creator once per follower per day', async () => {
    const owner = await createUser({ withChannel: true });
    const fan = await createUser();
    const viewer: Viewer = { id: fan.id, displayName: fan.displayName, role: fan.role, channelId: null, emailVerified: true };
    for (let i = 0; i < 4; i++) {
      await setFollow(viewer, owner.channel!.id, true);
      await setFollow(viewer, owner.channel!.id, false);
    }
    expect(await db.notification.count({ where: { userId: owner.id, type: 'NEW_FOLLOWER' } })).toBe(1);
  });
});
