import { siteConfig } from '@/config/site';
import type { MailMessage } from './index';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(title: string, bodyHtml: string, actionLabel: string, actionUrl: string, footer: string): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<body style="margin:0;background:#f4f3f8;font-family:Tahoma,'Vazirmatn',Arial,sans-serif;color:#1c1b22;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;text-align:right;direction:rtl;">
        <tr><td style="font-size:22px;font-weight:bold;color:#5b21b6;padding-bottom:16px;">${escapeHtml(siteConfig.name)}</td></tr>
        <tr><td style="font-size:18px;font-weight:bold;padding-bottom:12px;">${escapeHtml(title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.9;color:#3b3946;padding-bottom:24px;">${bodyHtml}</td></tr>
        <tr><td style="padding-bottom:24px;">
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:bold;">${escapeHtml(actionLabel)}</a>
        </td></tr>
        <tr><td style="font-size:12px;line-height:1.8;color:#77748a;border-top:1px solid #ececf3;padding-top:16px;">
          اگر دکمه کار نکرد، این نشانی را در مرورگر خود باز کنید:<br>
          <span dir="ltr" style="word-break:break-all;color:#5b21b6;">${escapeHtml(actionUrl)}</span><br><br>
          ${escapeHtml(footer)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function verificationEmail(input: { to: string; name: string; url: string }): MailMessage {
  const subject = `تأیید ایمیل در ${siteConfig.name}`;
  const text = `سلام ${input.name}،\n\nبرای تأیید ایمیل خود در ${siteConfig.name} این پیوند را باز کنید:\n${input.url}\n\nاین پیوند تا ۲۴ ساعت معتبر است. اگر شما حساب کاربری نساخته‌اید، این پیام را نادیده بگیرید.`;
  const html = layout(
    'ایمیل خود را تأیید کنید',
    `سلام ${escapeHtml(input.name)}،<br>برای فعال‌سازی کامل حساب خود (بارگذاری ویدیو و ثبت دیدگاه)، روی دکمه‌ی زیر بزنید. این پیوند تا ۲۴ ساعت معتبر است.`,
    'تأیید ایمیل',
    input.url,
    'اگر شما حساب کاربری نساخته‌اید، این پیام را نادیده بگیرید.',
  );
  return { to: input.to, subject, text, html };
}

export function passwordResetEmail(input: { to: string; name: string; url: string }): MailMessage {
  const subject = `بازیابی گذرواژه در ${siteConfig.name}`;
  const text = `سلام ${input.name}،\n\nبرای تعیین گذرواژه‌ی جدید این پیوند را باز کنید:\n${input.url}\n\nاین پیوند تا یک ساعت معتبر است. اگر شما درخواست بازیابی نداده‌اید، این پیام را نادیده بگیرید؛ گذرواژه‌ی شما تغییری نمی‌کند.`;
  const html = layout(
    'بازیابی گذرواژه',
    `سلام ${escapeHtml(input.name)}،<br>برای تعیین گذرواژه‌ی جدید روی دکمه‌ی زیر بزنید. این پیوند تا یک ساعت معتبر است.`,
    'تعیین گذرواژه‌ی جدید',
    input.url,
    'اگر شما درخواست بازیابی نداده‌اید، این پیام را نادیده بگیرید؛ گذرواژه‌ی شما تغییری نمی‌کند.',
  );
  return { to: input.to, subject, text, html };
}
