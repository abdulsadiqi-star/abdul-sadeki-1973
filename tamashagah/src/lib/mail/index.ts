/**
 * Outgoing e-mail.
 *
 * MAIL_TRANSPORT=smtp     real delivery (set SMTP_HOST/PORT/USER/PASSWORD)
 * MAIL_TRANSPORT=file     write each message as JSON into MAIL_FILE_DIR (e2e tests, local dev)
 * MAIL_TRANSPORT=console  log the message (development only — links contain secrets)
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';
import { logger } from '../logger';

export type MailMessage = { to: string; subject: string; text: string; html: string };

const globalForMail = globalThis as unknown as { __mailer?: Transporter };

function smtpTransport(): Transporter {
  return (globalForMail.__mailer ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  }));
}

export async function sendMail(message: MailMessage): Promise<void> {
  const record = { from: env.MAIL_FROM, ...message, createdAt: new Date().toISOString() };
  switch (env.MAIL_TRANSPORT) {
    case 'smtp': {
      await smtpTransport().sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      logger.info({ to: message.to, subject: message.subject }, 'mail sent');
      return;
    }
    case 'file': {
      const dir = path.resolve(env.MAIL_FILE_DIR);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${randomBytes(4).toString('hex')}.json`);
      await fs.writeFile(file, JSON.stringify(record, null, 2), 'utf8');
      logger.info({ to: message.to, subject: message.subject, file }, 'mail written to file transport');
      return;
    }
    default:
      logger.info({ mail: record }, 'mail (console transport)');
  }
}

/** Fire-and-forget wrapper: e-mail problems must never break the user's request. */
export function sendMailSafely(message: MailMessage): void {
  sendMail(message).catch((err) => logger.error({ err, to: message.to, subject: message.subject }, 'failed to send mail'));
}
