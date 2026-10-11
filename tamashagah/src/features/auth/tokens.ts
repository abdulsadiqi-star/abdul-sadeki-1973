import 'server-only';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { Errors } from '@/lib/errors';
import { randomToken, sha256Hex } from '@/lib/ids';
import { sendMailSafely } from '@/lib/mail';
import { passwordResetEmail, verificationEmail } from '@/lib/mail/templates';
import type { EmailTokenType } from '@/generated/prisma/enums';

const TTL_MS: Record<EmailTokenType, number> = {
  VERIFY_EMAIL: 24 * 3_600_000,
  RESET_PASSWORD: 3_600_000,
};

/** Create a single-use token (older unused tokens of the same type are invalidated). Returns the RAW token. */
export async function issueEmailToken(userId: string, type: EmailTokenType): Promise<string> {
  const token = randomToken(32);
  await db.$transaction([
    db.emailToken.deleteMany({ where: { userId, type, usedAt: null } }),
    db.emailToken.create({
      data: { userId, type, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + TTL_MS[type]) },
    }),
  ]);
  return token;
}

/** Validate and burn a token atomically. Throws a generic error for any invalid state. */
export async function consumeEmailToken(rawToken: string, type: EmailTokenType): Promise<{ userId: string }> {
  const invalid = () => Errors.badRequest('این پیوند نامعتبر است یا منقضی شده است. دوباره درخواست دهید.');
  const row = await db.emailToken.findUnique({ where: { tokenHash: sha256Hex(rawToken) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt.getTime() < Date.now()) throw invalid();
  const { count } = await db.emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) throw invalid();
  return { userId: row.userId };
}

export async function sendVerificationEmail(user: { id: string; email: string; displayName: string }): Promise<void> {
  const token = await issueEmailToken(user.id, 'VERIFY_EMAIL');
  const url = `${env.APP_URL.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
  sendMailSafely(verificationEmail({ to: user.email, name: user.displayName, url }));
}

export async function sendPasswordResetEmail(user: { id: string; email: string; displayName: string }): Promise<void> {
  const token = await issueEmailToken(user.id, 'RESET_PASSWORD');
  const url = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  sendMailSafely(passwordResetEmail({ to: user.email, name: user.displayName, url }));
}
