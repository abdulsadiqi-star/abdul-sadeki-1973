'use strict';
/* ارسال کد ورود با سرویس کاوه‌نگار (متد verify/lookup).
   اگر کلید API تنظیم نشده باشد، در حالت توسعه کد فقط در کنسول سرور چاپ می‌شود. */

function createSms(cfg) {
  const { apiKey, template } = cfg.kavenegar;
  const enabled = Boolean(apiKey);

  async function sendOtp(phone, code) {
    if (!enabled) {
      if (!cfg.quiet) console.log('[SMS-DEV] کد ورود ' + phone + ': ' + code);
      return;
    }
    const url = 'https://api.kavenegar.com/v1/' + encodeURIComponent(apiKey) + '/verify/lookup.json' +
      '?receptor=' + encodeURIComponent(phone) + '&token=' + encodeURIComponent(code) + '&template=' + encodeURIComponent(template);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.return || body.return.status !== 200) {
      throw new Error('Kavenegar error: ' + (body && body.return ? body.return.status + ' ' + body.return.message : res.status));
    }
  }

  return { enabled, sendOtp };
}

module.exports = { createSms };
