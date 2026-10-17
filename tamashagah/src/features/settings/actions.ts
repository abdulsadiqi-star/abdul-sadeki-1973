'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { requireChannelUser, requireUser } from '@/lib/auth/guards';
import { setDigitsCookie } from '@/lib/auth/session';
import { buildChannelSearchName } from '@/lib/persian';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parse } from '@/lib/validation';
import { accountSettingsSchema, channelSettingsSchema, revokeSessionSchema } from './schemas';
import { settingsLimits } from './limits';

/**
 * Settings mutations. Authorization is re-derived from the session on every call: the user id / channel id are
 * NEVER taken from the input (the schemas contain no id fields), and the session id is only ever deleted together
 * with `userId = <caller>`, so a foreign id answers 404 exactly like an unknown one.
 *
 * Password change, "log out everywhere" and e-mail verification already exist in `features/auth/actions.ts`
 * (`changePasswordAction`, `logoutEverywhereAction`, `resendVerificationAction`) and are used as they are.
 */

/** Display name, numeral style and e-mail notification preference in one save. */
export async function saveAccountSettingsAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parse(accountSettingsSchema, input);
    await enforceRateLimit('settings-write:user', user.id, settingsLimits.write);
    await db.user.update({
      where: { id: user.id },
      data: { displayName: data.displayName, digitStyle: data.digitStyle, notifyByEmail: data.notifyByEmail },
    });
    await setDigitsCookie(data.digitStyle); // the cookie mirrors the stored preference
    revalidatePath('/', 'layout');
  });
}

/** Channel profile: name, description, links, comment policy and the default visibility of new uploads. */
export async function updateChannelAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireChannelUser();
    const data = parse(channelSettingsSchema, input);
    await enforceRateLimit('settings-write:user', user.id, settingsLimits.write);
    await db.channel.update({
      where: { id: user.channel.id },
      data: {
        name: data.name,
        description: data.description,
        links: data.links,
        commentsMode: data.commentsMode,
        defaultVisibility: data.defaultVisibility,
        // keep the search index of the channel in sync with its name (the handle never changes here)
        searchName: buildChannelSearchName(data.name, user.channel.handle),
      },
    });
    revalidatePath('/', 'layout');
    revalidatePath(`/channel/${user.channel.handle}`);
  });
}

/** Sign ONE other device out. The current session is ended from the account menu (or "log out everywhere"). */
export async function revokeSessionAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const { sessionId } = parse(revokeSessionSchema, input);
    await enforceRateLimit('settings-write:user', user.id, settingsLimits.write);
    if (sessionId === user.sessionId) {
      throw Errors.badRequest('برای خروج از این دستگاه از منوی حساب کاربری استفاده کنید.');
    }
    const { count } = await db.session.deleteMany({ where: { id: sessionId, userId: user.id } });
    if (count === 0) throw Errors.notFound('این نشست پیدا نشد.');
  });
}
