import { z } from 'zod';
import '@/lib/zod-fa';
import { HANDLE_REGEX, RESERVED_HANDLES, normalizeUserText } from '@/lib/persian';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'ایمیل را وارد کنید.')
  .max(254, 'ایمیل بیش از حد طولانی است.')
  .pipe(z.email('ایمیل واردشده معتبر نیست.'));

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '11111111', '00000000', 'password', 'password1', 'password123',
  'qwertyui', 'qwerty123', 'iloveyou', 'abc12345', 'admin123', 'letmein1', 'welcome1', '987654321',
  '1q2w3e4r', 'aa123456', 'a1234567', '12341234',
]);

export const passwordSchema = z
  .string()
  .min(8, 'گذرواژه باید حداقل ۸ نویسه باشد.')
  .max(128, 'گذرواژه نباید بیش از ۱۲۸ نویسه باشد.')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'این گذرواژه بسیار رایج است؛ گذرواژه‌ی دیگری انتخاب کنید.')
  .refine((p) => /\p{L}/u.test(p) && /[\d۰-۹٠-٩]/.test(p), 'گذرواژه باید شامل حداقل یک حرف و یک عدد باشد.');

export const displayNameSchema = z
  .string()
  .transform((s) => normalizeUserText(s))
  .pipe(z.string().min(2, 'نام باید حداقل ۲ نویسه باشد.').max(50, 'نام نباید بیش از ۵۰ نویسه باشد.'));

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HANDLE_REGEX, 'شناسه باید ۳ تا ۳۰ نویسه‌ی انگلیسی (حروف کوچک، عدد، _ . -) باشد و با حرف یا عدد شروع و تمام شود.')
  .refine((h) => !/[._-]{2}/.test(h), 'شناسه نباید دو نویسه‌ی خاص پشت سر هم داشته باشد.')
  .refine((h) => !RESERVED_HANDLES.has(h), 'این شناسه رزرو شده است؛ شناسه‌ی دیگری انتخاب کنید.');

export const registerSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.boolean().refine((v) => v === true, 'برای ثبت‌نام باید قوانین و حریم خصوصی را بپذیرید.'),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'گذرواژه را وارد کنید.').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(128),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(128) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'گذرواژه‌ی فعلی را وارد کنید.').max(128),
  newPassword: passwordSchema,
});

export const createChannelSchema = z.object({
  name: z
    .string()
    .transform((s) => normalizeUserText(s))
    .pipe(z.string().min(2, 'نام کانال باید حداقل ۲ نویسه باشد.').max(60, 'نام کانال نباید بیش از ۶۰ نویسه باشد.')),
  handle: handleSchema,
  description: z
    .string()
    .transform((s) => normalizeUserText(s, { multiline: true }))
    .pipe(z.string().max(1000, 'توضیحات نباید بیش از ۱۰۰۰ نویسه باشد.'))
    .default(''),
});
export type CreateChannelInput = z.input<typeof createChannelSchema>;

export const updateAccountSchema = z.object({
  displayName: displayNameSchema,
  digitStyle: z.enum(['FA', 'EN']),
});
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

export const digitStyleSchema = z.object({ digitStyle: z.enum(['FA', 'EN']) });
