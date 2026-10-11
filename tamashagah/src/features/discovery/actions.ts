'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/session';
import { runAction, type ActionResult } from '@/lib/errors';
import { enforceClientRateLimit, enforceRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request';
import { parse } from '@/lib/validation';
import { discoveryLimits } from './limits';
import { getShortsPage, type ShortsPage } from './shorts';

const cursorSchema = z.object({ cursor: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/) });

/** Next page of the shorts feed (anonymous visitors may load it too; limits apply per user or per client). */
export async function loadShortsPageAction(input: unknown): Promise<ActionResult<ShortsPage>> {
  return runAction(async () => {
    const { cursor } = parse(cursorSchema, input);
    const user = await getCurrentUser();
    if (user) await enforceRateLimit('shorts:page:user', user.id, discoveryLimits.shortsPage);
    else await enforceClientRateLimit('shorts:page', getClientIp(await headers()), discoveryLimits.shortsPage);
    return getShortsPage({ userId: user?.id ?? null, channelId: user?.channel?.id ?? null, cursor });
  });
}
