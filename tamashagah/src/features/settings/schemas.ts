import { z } from 'zod';
import '@/lib/zod-fa';
import { normalizeUserText } from '@/lib/persian';
import { displayNameSchema } from '@/features/auth/schemas';

export const MAX_CHANNEL_LINKS = 5;

/** Profile + preferences of the signed-in user (e-mail is read-only here). */
export const accountSettingsSchema = z.object({
  displayName: displayNameSchema,
  digitStyle: z.enum(['FA', 'EN']),
  notifyByEmail: z.boolean(),
});
export type AccountSettingsInput = z.input<typeof accountSettingsSchema>;

/** An https URL without credentials, normalized (`new URL(...).href`). */
export const httpsUrlSchema = z
  .string()
  .trim()
  .min(1, 'نشانی را وارد کنید.')
  .max(300, 'نشانی نباید بیش از ۳۰۰ نویسه باشد.')
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'نشانی معتبر نیست؛ آن را با https:// وارد کنید.' });
      return z.NEVER;
    }
    if (url.protocol !== 'https:') {
      ctx.addIssue({ code: 'custom', message: 'فقط نشانی‌های امن (https://) پذیرفته می‌شود.' });
      return z.NEVER;
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: 'custom', message: 'نشانی نباید شامل نام کاربری یا گذرواژه باشد.' });
      return z.NEVER;
    }
    if (!url.hostname.includes('.')) {
      ctx.addIssue({ code: 'custom', message: 'نشانی معتبر نیست.' });
      return z.NEVER;
    }
    return url.href;
  });

export const channelLinkSchema = z.object({
  title: z
    .string()
    .transform((s) => normalizeUserText(s))
    .pipe(z.string().min(1, 'عنوان پیوند را وارد کنید.').max(40, 'عنوان پیوند نباید بیش از ۴۰ نویسه باشد.')),
  url: httpsUrlSchema,
});
export type ChannelLink = z.output<typeof channelLinkSchema>;

export const channelSettingsSchema = z.object({
  name: z
    .string()
    .transform((s) => normalizeUserText(s))
    .pipe(z.string().min(2, 'نام کانال باید حداقل ۲ نویسه باشد.').max(60, 'نام کانال نباید بیش از ۶۰ نویسه باشد.')),
  description: z
    .string()
    .transform((s) => normalizeUserText(s, { multiline: true }))
    .pipe(z.string().max(1000, 'توضیحات نباید بیش از ۱۰۰۰ نویسه باشد.')),
  links: z
    .array(channelLinkSchema)
    .max(MAX_CHANNEL_LINKS, `حداکثر ${MAX_CHANNEL_LINKS} پیوند مجاز است.`)
    .transform((links) => links.filter((link, i) => links.findIndex((other) => other.url === link.url) === i)),
  commentsMode: z.enum(['OPEN', 'APPROVAL_REQUIRED', 'DISABLED']),
  defaultVisibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']),
});
export type ChannelSettingsInput = z.input<typeof channelSettingsSchema>;
export type ChannelSettings = z.output<typeof channelSettingsSchema>;

export const revokeSessionSchema = z.object({ sessionId: z.string().min(10).max(40) }).strict();

/** Defensive reader for `Channel.links` (a Json column other code may also write). */
export function parseStoredLinks(value: unknown): ChannelLink[] {
  if (!Array.isArray(value)) return [];
  const out: ChannelLink[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { title, url } = entry as { title?: unknown; url?: unknown };
    if (typeof title !== 'string' || typeof url !== 'string') continue;
    out.push({ title, url });
    if (out.length >= MAX_CHANNEL_LINKS) break;
  }
  return out;
}
