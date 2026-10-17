'use strict';
/* درگاه پرداخت زرین‌پال (API نسخه ۴).
   حالت‌ها:
   - live:    مرچنت کد تنظیم شده، پرداخت واقعی
   - sandbox: مرچنت کد + ZARINPAL_SANDBOX=true، درگاه آزمایشی زرین‌پال
   - fake:    بدون مرچنت کد، فقط در حالت توسعه روی localhost؛ صفحه پرداخت شبیه‌سازی‌شده
   - off:     بدون مرچنت کد روی سرور واقعی؛ فقط پرداخت در محل فعال است */
const crypto = require('node:crypto');

function createPayment(cfg) {
  const z = cfg.zarinpal;
  const mode = z.merchantId ? (z.sandbox ? 'sandbox' : 'live') : (cfg.devMode ? 'fake' : 'off');
  const base = z.sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    return res.json().catch(() => null);
  }

  /** مبلغ به تومان داده می‌شود و به ریال برای زرین‌پال ارسال می‌شود */
  async function request({ amountToman, description, callbackUrl, mobile, orderCode }) {
    if (mode === 'off') throw new Error('payment disabled');
    if (mode === 'fake') {
      const authority = 'FAKE' + crypto.randomBytes(12).toString('hex');
      return { authority, url: '/api/pay/fake?Authority=' + authority };
    }
    const r = await post(base + '/pg/v4/payment/request.json', {
      merchant_id: z.merchantId,
      amount: amountToman * 10,
      callback_url: callbackUrl,
      description,
      metadata: { mobile, order_id: orderCode }
    });
    if (!r || !r.data || r.data.code !== 100) throw new Error('ZarinPal request failed: ' + JSON.stringify(r && r.errors));
    return { authority: r.data.authority, url: base + '/pg/StartPay/' + r.data.authority };
  }

  async function verify({ amountToman, authority }) {
    if (mode === 'fake') return { ok: authority.startsWith('FAKE'), refId: String(crypto.randomInt(100000000, 999999999)) };
    const r = await post(base + '/pg/v4/payment/verify.json', { merchant_id: z.merchantId, amount: amountToman * 10, authority });
    const code = r && r.data ? r.data.code : null;
    // ۱۰۰ = پرداخت موفق، ۱۰۱ = قبلاً تأیید شده
    return { ok: code === 100 || code === 101, refId: r && r.data && r.data.ref_id ? String(r.data.ref_id) : null, code };
  }

  return { mode, enabled: mode !== 'off', request, verify };
}

module.exports = { createPayment };
