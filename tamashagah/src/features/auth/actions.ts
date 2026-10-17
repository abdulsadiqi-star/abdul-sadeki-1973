'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { Errors, runAction, type ActionResult } from '@/lib/errors';
import { sha256Hex } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { buildChannelSearchName } from '@/lib/persian';
import { enforceClientRateLimit, enforceRateLimit, limits } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request';
import { parse } from '@/lib/validation';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '@/lib/auth/password';
import { requireUser, requireVerifiedUser } from '@/lib/auth/guards';
import { endSession, getCurrentUser, revokeUserSessions, setDigitsCookie, startSession } from '@/lib/auth/session';
import {
  changePasswordSchema,
  createChannelSchema,
  digitStyleSchema,
  forgotPasswordSchema,
  handleSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateAccountSchema,
  verifyEmailSchema,
} from './schemas';
import { consumeEmailToken, sendPasswordResetEmail, sendVerificationEmail } from './tokens';

const clientIp = async () => getClientIp(await headers());

// ---------------------------------------------------------------------------
// Registration / login / logout
// ---------------------------------------------------------------------------

export async function registerAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const data = parse(registerSchema, input);
    await enforceClientRateLimit('register', await clientIp(), limits.register);

    const exists = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (exists) throw Errors.validation({ email: ['با این ایمیل قبلاً ثبت‌نام شده است. وارد شوید یا گذرواژه را بازیابی کنید.'] });

    const user = await db.user.create({
      data: { email: data.email, displayName: data.displayName, passwordHash: await hashPassword(data.password) },
      select: { id: true, email: true, displayName: true },
    });
    await sendVerificationEmail(user);
    await startSession(user.id);
    logger.info({ userId: user.id }, 'user registered');
  });
}

export async function loginAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const data = parse(loginSchema, input);
    await enforceClientRateLimit('login', await clientIp(), limits.login);
    await enforceRateLimit('login:account', sha256Hex(data.email), limits.loginPerAccount);

    const user = await db.user.findUnique({ where: { email: data.email } });
    if (!user) {
      await verifyAgainstDummy(data.password);
      throw Errors.validation({ _form: ['ایمیل یا گذرواژه نادرست است.'] }, 'ایمیل یا گذرواژه نادرست است.');
    }
    const valid = await verifyPassword(user.passwordHash, data.password);
    if (!valid) throw Errors.validation({ _form: ['ایمیل یا گذرواژه نادرست است.'] }, 'ایمیل یا گذرواژه نادرست است.');
    if (user.status !== 'ACTIVE') throw Errors.blocked('این حساب کاربری مسدود شده است. با پشتیبانی تماس بگیرید.');

    await startSession(user.id);
    await setDigitsCookie(user.digitStyle);
    logger.info({ userId: user.id }, 'user logged in');
  });
}

export async function logoutAction(): Promise<ActionResult> {
  return runAction(async () => {
    await endSession();
    revalidatePath('/', 'layout');
  });
}

/** "Log out everywhere": revoke every session including the current one. */
export async function logoutEverywhereAction(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    await revokeUserSessions(user.id);
    await endSession();
  });
}

// ---------------------------------------------------------------------------
// E-mail verification / password reset
// ---------------------------------------------------------------------------

export async function verifyEmailAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { token } = parse(verifyEmailSchema, input);
    const { userId } = await consumeEmailToken(token, 'VERIFY_EMAIL');
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    revalidatePath('/', 'layout');
  });
}

export async function resendVerificationAction(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    if (user.emailVerified) return;
    await enforceRateLimit('verify-resend:user', user.id, limits.resendVerification);
    await sendVerificationEmail({ id: user.id, email: user.email, displayName: user.displayName });
  });
}

/** Always succeeds (never reveals whether the e-mail is registered). */
export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { email } = parse(forgotPasswordSchema, input);
    await enforceClientRateLimit('reset', await clientIp(), limits.passwordReset);
    await enforceRateLimit('reset:account', sha256Hex(email), limits.passwordReset);
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true, status: true },
    });
    if (user && user.status === 'ACTIVE') await sendPasswordResetEmail(user);
  });
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { token, password } = parse(resetPasswordSchema, input);
    await enforceClientRateLimit('reset-confirm', await clientIp(), limits.passwordReset);
    const { userId } = await consumeEmailToken(token, 'RESET_PASSWORD');
    await db.user.update({
      where: { id: userId },
      // Proving control of the inbox also verifies the address.
      data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
    });
    await revokeUserSessions(userId);
    logger.info({ userId }, 'password reset');
  });
}

export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parse(changePasswordSchema, input);
    await enforceRateLimit('change-password:user', user.id, limits.loginPerAccount);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await verifyPassword(row.passwordHash, data.currentPassword))) {
      throw Errors.validation({ currentPassword: ['گذرواژه‌ی فعلی نادرست است.'] });
    }
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(data.newPassword) } });
    await revokeUserSessions(user.id, user.sessionId);
  });
}

// ---------------------------------------------------------------------------
// Account & channel
// ---------------------------------------------------------------------------

export async function updateAccountAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const data = parse(updateAccountSchema, input);
    await db.user.update({ where: { id: user.id }, data: { displayName: data.displayName, digitStyle: data.digitStyle } });
    await setDigitsCookie(data.digitStyle);
    revalidatePath('/', 'layout');
  });
}

export async function checkHandleAction(input: unknown): Promise<ActionResult<{ available: boolean }>> {
  return runAction(async () => {
    const user = await requireUser();
    await enforceRateLimit('handle-check:user', user.id, limits.generalWrite);
    const parsed = handleSchema.safeParse(input);
    if (!parsed.success) return { available: false };
    const taken = await db.channel.findUnique({ where: { handle: parsed.data }, select: { id: true } });
    return { available: !taken };
  });
}

export async function createChannelAction(input: unknown): Promise<ActionResult<{ handle: string }>> {
  return runAction(async () => {
    const user = await requireVerifiedUser();
    if (user.channel) throw Errors.conflict('شما از قبل یک کانال دارید.');
    const data = parse(createChannelSchema, input);
    await enforceRateLimit('channel-create:user', user.id, limits.generalWrite);

    const taken = await db.channel.findUnique({ where: { handle: data.handle }, select: { id: true } });
    if (taken) throw Errors.validation({ handle: ['این شناسه قبلاً استفاده شده است.'] });

    try {
      await db.$transaction([
        db.channel.create({
          data: {
            ownerId: user.id,
            handle: data.handle,
            name: data.name,
            description: data.description,
            searchName: buildChannelSearchName(data.name, data.handle),
          },
        }),
        // Moderators/admins keep their (higher) role.
        db.user.updateMany({ where: { id: user.id, role: 'USER' }, data: { role: 'CREATOR' } }),
      ]);
    } catch (error) {
      // Lost a race on the unique handle.
      if ((error as { code?: string }).code === 'P2002') {
        throw Errors.validation({ handle: ['این شناسه قبلاً استفاده شده است.'] });
      }
      throw error;
    }
    revalidatePath('/', 'layout');
    return { handle: data.handle };
  });
}

/** Persian (۱۲۳) vs English (123) numerals. Works for visitors (cookie) and users (also stored). */
export async function setDigitStyleAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const { digitStyle } = parse(digitStyleSchema, input);
    await setDigitsCookie(digitStyle);
    const user = await getCurrentUser();
    if (user) await db.user.update({ where: { id: user.id }, data: { digitStyle } });
    revalidatePath('/', 'layout');
  });
}
