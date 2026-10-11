'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/lib/errors';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit, limits } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { setFollow, setFollowNotifications, setLike, setWatchLater, type Viewer } from './service';

const videoId = z.string().regex(VIDEO_ID_REGEX, 'شناسه‌ی ویدیو نامعتبر است.');
const cuid = z.string().min(10).max(40);

async function viewer(): Promise<Viewer> {
  const user = await requireUser();
  return { id: user.id, displayName: user.displayName, role: user.role, channelId: user.channel?.id ?? null, emailVerified: user.emailVerified };
}

export async function toggleLikeAction(input: unknown): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  return runAction(async () => {
    const v = await viewer();
    const { videoId: id, liked } = parse(z.object({ videoId, liked: z.boolean() }), input);
    await enforceRateLimit('like:user', v.id, limits.like);
    return setLike(v, id, liked);
  });
}

export async function toggleFollowAction(input: unknown): Promise<ActionResult<{ following: boolean; followerCount: number }>> {
  return runAction(async () => {
    const v = await viewer();
    const { channelId, follow } = parse(z.object({ channelId: cuid, follow: z.boolean() }), input);
    await enforceRateLimit('follow:user', v.id, limits.follow);
    const result = await setFollow(v, channelId, follow);
    revalidatePath('/library/following');
    return result;
  });
}

export async function setFollowNotificationsAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = await viewer();
    const { channelId, enabled } = parse(z.object({ channelId: cuid, enabled: z.boolean() }), input);
    await enforceRateLimit('follow:user', v.id, limits.follow);
    await setFollowNotifications(v.id, channelId, enabled);
  });
}

export async function toggleWatchLaterAction(input: unknown): Promise<ActionResult<{ saved: boolean }>> {
  return runAction(async () => {
    const v = await viewer();
    const { videoId: id, saved } = parse(z.object({ videoId, saved: z.boolean() }), input);
    await enforceRateLimit('follow:user', v.id, limits.follow);
    const result = await setWatchLater(v, id, saved);
    revalidatePath('/library/watch-later');
    return result;
  });
}
