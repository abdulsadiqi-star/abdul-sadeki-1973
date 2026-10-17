'use strict';
/* سرور فروشگاه: API عمومی، ورود با کد پیامکی، سفارش و پرداخت، API پنل مدیریت و سرو فایل‌های سایت */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb, transaction } = require('./db');
const { createSms } = require('./sms');
const { createPayment } = require('./payment');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const PHONE_RE = /^09\d{9}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const PAID = ['processing', 'shipped', 'delivered'];
const STATUSES = ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled', 'payment_failed'];
const DAY = 86400000;

const toEn = (s) => String(s == null ? '' : s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const finalPrice = (p) => (p.off ? Math.round(p.price * (1 - p.off / 100) / 1000) * 1000 : p.price);
const safeEqual = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function str(v, max, min, field) {
  v = typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim());
  if (v.length < (min || 0)) throw new HttpError(400, '«' + field + '» را ' + (min > 1 ? 'کامل‌تر ' : '') + 'وارد کنید.');
  if (v.length > max) throw new HttpError(400, '«' + field + '» بیش از حد طولانی است (حداکثر ' + max + ' حرف).');
  return v;
}
function int(v, min, max, field) {
  const n = Number(toEn(v));
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'مقدار «' + field + '» معتبر نیست.');
  return n;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'self'";

function createApp(cfg) {
  const db = openDb(cfg);
  const sms = createSms(cfg);
  const pay = createPayment(cfg);
  const routes = [];
  const hits = new Map();
  const log = (...a) => { if (!cfg.quiet) console.log(...a); };
  const hmac = (s) => crypto.createHmac('sha256', cfg.secret).update(s).digest('hex');
  const tx = (fn) => transaction(db, fn);

  function route(method, pattern, handler, opts) {
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    routes.push({ method, re, handler, opts: opts || {} });
  }

  /** محدودیت تعداد درخواست ساده در حافظه */
  function limit(key, max, windowMs) {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now > h.reset) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n++;
    return h.n <= max;
  }

  /* ---------- داده‌ها ---------- */
  const DEFAULTS = { storeName: 'فروشگاه', phone: '', brandColor: '#f2613f', accentColor: '#ffc83d', freeShip: 1000000, shipNormal: 49000, shipExpress: 89000, maxPerItem: 5 };
  function getSettings() {
    const s = Object.assign({}, DEFAULTS);
    for (const r of db.prepare('SELECT key, value FROM settings').all()) s[r.key] = JSON.parse(r.value);
    return s;
  }
  function integrations() {
    return { onlinePayment: pay.enabled, paymentMode: pay.mode, sms: sms.enabled, devLogin: !sms.enabled && cfg.devMode };
  }
  function productOut(p) {
    return {
      id: p.id, title: p.title, cat: p.cat, brand: p.brand, price: p.price, off: p.off, rating: Math.round(p.rating * 10) / 10,
      reviews: p.reviews, stock: p.stock, emoji: p.emoji, sold: p.sold, age: Math.max(0, Math.floor((Date.now() - p.created_at) / DAY)),
      colors: JSON.parse(p.colors), specs: JSON.parse(p.specs), img: p.img, description: p.description, active: Boolean(p.active)
    };
  }
  function categoryOut(c) { return { id: c.id, name: c.name, icon: c.icon, hue: c.hue, subs: JSON.parse(c.subs) }; }
  function orderOut(o) {
    const items = JSON.parse(o.items);
    return {
      code: o.code, status: o.status, payMethod: o.pay_method, ship: o.ship_method, items,
      count: items.reduce((a, i) => a + i.qty, 0), listTotal: o.list_total, payable: o.payable, coupon: o.coupon,
      couponDisc: o.coupon_disc, shipCost: o.ship_cost, total: o.total, address: JSON.parse(o.address),
      refId: o.ref_id, createdAt: o.created_at, paidAt: o.paid_at
    };
  }
  const userOut = (u) => ({ id: u.id, phone: u.phone, name: u.name });

  /** برگرداندن موجودی کالاهای یک سفارش لغوشده یا پرداخت‌نشده */
  function releaseStock(order) {
    const st = db.prepare('UPDATE products SET stock = stock + ?, sold = MAX(0, sold - ?) WHERE id = ?');
    for (const it of JSON.parse(order.items)) st.run(it.qty, it.qty, it.id);
  }
  function failOrder(orderId, newStatus) {
    return tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!o || o.status !== 'pending_payment') return false;
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(newStatus, orderId);
      releaseStock(o);
      return true;
    });
  }

  /* ---------- نشست‌ها ---------- */
  function createSession(userId, isAdmin, ttlMs) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, is_admin, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha(token), userId == null ? null : userId, isAdmin ? 1 : 0, Date.now() + ttlMs);
    return token;
  }
  function session(ctx) {
    if (ctx.session !== undefined) return ctx.session;
    const m = (ctx.req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    ctx.session = m ? db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(sha(m[1]), Date.now()) || null : null;
    return ctx.session;
  }
  function requireUser(ctx) {
    const s = session(ctx);
    const u = s && s.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id) : null;
    if (!u) throw new HttpError(401, 'ابتدا وارد حساب کاربری شوید.');
    return u;
  }
  function requireAdmin(ctx) {
    const s = session(ctx);
    if (!s || !s.is_admin) throw new HttpError(401, 'برای دسترسی به پنل مدیریت وارد شوید.');
  }

  function cleanup() {
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM otps WHERE expires_at < ?').run(now - DAY);
    // سفارش‌هایی که ۳۰ دقیقه در انتظار پرداخت مانده‌اند لغو و موجودی‌شان آزاد می‌شود
    for (const o of db.prepare("SELECT id FROM orders WHERE status = 'pending_payment' AND created_at < ?").all(now - 30 * 60000)) failOrder(o.id, 'payment_failed');
    for (const [k, h] of hits) if (now > h.reset) hits.delete(k);
  }
  cleanup();
  const timer = setInterval(cleanup, 5 * 60000);
  timer.unref();

  /* =====================================================================
     API عمومی
     ===================================================================== */
  route('GET', '/api/settings', () => Object.assign(getSettings(), { features: integrations() }));

  route('GET', '/api/catalog', () => ({
    categories: db.prepare('SELECT * FROM categories ORDER BY sort, name').all().map(categoryOut),
    products: db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id').all().map(productOut)
  }));

  route('GET', '/api/products/:id/reviews', (ctx) => {
    const id = int(ctx.params.id, 1, 1e12, 'کالا');
    const rows = db.prepare('SELECT name, rate, text, buyer, created_at FROM reviews WHERE product_id = ? AND approved = 1 ORDER BY created_at DESC LIMIT 100').all(id);
    return { reviews: rows.map((r) => ({ name: r.name, rate: r.rate, text: r.text, buyer: Boolean(r.buyer), createdAt: r.created_at })) };
  });

  route('POST', '/api/products/:id/reviews', (ctx) => {
    const u = requireUser(ctx);
    const id = int(ctx.params.id, 1, 1e12, 'کالا');
    const p = db.prepare('SELECT id, rating, reviews FROM products WHERE id = ? AND active = 1').get(id);
    if (!p) throw new HttpError(404, 'این کالا پیدا نشد.');
    if (!limit('review:' + u.id, 5, 3600000)) throw new HttpError(429, 'در یک ساعت حداکثر ۵ دیدگاه می‌توانید ثبت کنید.');
    const rate = int(ctx.body.rate, 1, 5, 'امتیاز');
    const name = str(ctx.body.name || u.name, 40, 2, 'نام');
    const text = str(ctx.body.text, 1000, 10, 'متن دیدگاه');
    const buyer = db.prepare('SELECT items FROM orders WHERE user_id = ? AND status IN (\'processing\', \'shipped\', \'delivered\')').all(u.id)
      .some((o) => JSON.parse(o.items).some((i) => i.id === id));
    tx(() => {
      db.prepare('INSERT INTO reviews (product_id, user_id, name, rate, text, buyer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, u.id, name, rate, text, buyer ? 1 : 0, Date.now());
      db.prepare('UPDATE products SET rating = (rating * reviews + ?) / (reviews + 1), reviews = reviews + 1 WHERE id = ?').run(rate, id);
    });
    return { ok: true };
  });

  route('POST', '/api/coupons/check', (ctx) => {
    if (!limit('coupon:' + ctx.ip, 30, 600000)) throw new HttpError(429, 'تعداد تلاش‌ها زیاد است. کمی بعد دوباره امتحان کنید.');
    const code = str(ctx.body.code, 30, 1, 'کد تخفیف').toUpperCase();
    const c = db.prepare('SELECT code, pct, cap FROM coupons WHERE code = ? AND active = 1').get(code);
    if (!c) throw new HttpError(404, 'این کد تخفیف معتبر نیست.');
    return { code: c.code, pct: c.pct, cap: c.cap };
  });

  /* ---------- ورود با کد یکبار مصرف ---------- */
  route('POST', '/api/auth/request', async (ctx) => {
    const phone = toEn(ctx.body.phone).trim();
    if (!PHONE_RE.test(phone)) throw new HttpError(400, 'شماره موبایل باید ۱۱ رقم باشد و با ۰۹ شروع شود.');
    if (!limit('otp-ip:' + ctx.ip, 10, 600000)) throw new HttpError(429, 'تعداد درخواست‌ها زیاد است. چند دقیقه دیگر دوباره تلاش کنید.');
    if (!sms.enabled && !cfg.devMode) throw new HttpError(503, 'سرویس پیامک هنوز تنظیم نشده است.');
    const now = Date.now();
    const row = db.prepare('SELECT last_sent FROM otps WHERE phone = ?').get(phone);
    if (row && now - row.last_sent < 60000) {
      const wait = Math.ceil((60000 - (now - row.last_sent)) / 1000);
      throw new HttpError(429, 'برای ارسال دوباره کد ' + wait + ' ثانیه صبر کنید.', { retryAfter: wait });
    }
    const code = String(crypto.randomInt(10000, 100000));
    db.prepare(`INSERT INTO otps (phone, code_hash, expires_at, attempts, last_sent) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, last_sent = excluded.last_sent`)
      .run(phone, hmac(phone + ':' + code), now + 120000, now);
    try {
      await sms.sendOtp(phone, code);
    } catch (e) {
      console.error(e);
      db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
      throw new HttpError(502, 'ارسال پیامک ناموفق بود. چند لحظه بعد دوباره تلاش کنید.');
    }
    const out = { ok: true, ttl: 120 };
    if (!sms.enabled && cfg.devMode) out.devCode = code;
    return out;
  });

  route('POST', '/api/auth/verify', (ctx) => {
    const phone = toEn(ctx.body.phone).trim();
    const code = toEn(ctx.body.code).trim();
    if (!PHONE_RE.test(phone)) throw new HttpError(400, 'شماره موبایل معتبر نیست.');
    const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'کد منقضی شده است. دوباره درخواست کد بدهید.');
    if (row.attempts >= 5) throw new HttpError(429, 'تعداد تلاش‌های اشتباه زیاد بود. کد جدید بگیرید.');
    if (!safeEqual(row.code_hash, hmac(phone + ':' + code))) {
      db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
      throw new HttpError(400, 'کد واردشده درست نیست.');
    }
    const name = str(ctx.body.name || '', 40, 0, 'نام');
    const user = tx(() => {
      db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
      db.prepare('INSERT INTO users (phone, name, created_at) VALUES (?, ?, ?) ON CONFLICT(phone) DO NOTHING').run(phone, name, Date.now());
      if (name) db.prepare('UPDATE users SET name = ? WHERE phone = ?').run(name, phone);
      return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    });
    return { token: createSession(user.id, false, 30 * DAY), user: userOut(user) };
  });

  route('GET', '/api/me', (ctx) => ({ user: userOut(requireUser(ctx)) }));

  route('POST', '/api/auth/logout', (ctx) => {
    const s = session(ctx);
    if (s) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash);
    return { ok: true };
  });

  /* ---------- سفارش ---------- */
  route('POST', '/api/orders', async (ctx) => {
    const u = requireUser(ctx);
    const S = getSettings();
    const b = ctx.body;
    if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'سبد خرید خالی است.');
    if (b.items.length > 50) throw new HttpError(400, 'تعداد ردیف‌های سبد خرید بیش از حد مجاز است.');
    const ship = b.ship === 'express' ? 'express' : 'normal';
    const payMethod = b.pay === 'online' ? 'online' : 'cod';
    if (payMethod === 'online' && !pay.enabled) throw new HttpError(400, 'پرداخت اینترنتی فعلاً فعال نیست. پرداخت در محل را انتخاب کنید.');

    const a = b.address || {};
    const address = {
      name: str(a.name, 60, 3, 'نام تحویل‌گیرنده'), phone: toEn(a.phone).trim(), province: str(a.province, 40, 2, 'استان'),
      city: str(a.city, 40, 2, 'شهر'), address: str(a.address, 300, 10, 'نشانی'), postal: toEn(a.postal).trim()
    };
    if (!PHONE_RE.test(address.phone)) throw new HttpError(400, 'شماره موبایل تحویل‌گیرنده معتبر نیست.');
    if (!/^\d{10}$/.test(address.postal)) throw new HttpError(400, 'کد پستی باید ۱۰ رقم باشد.');

    const lines = new Map();
    for (const it of b.items) {
      const id = int(it && it.id, 1, 1e12, 'کالا');
      const color = int(it && it.color != null ? it.color : 0, 0, 50, 'رنگ');
      const qty = int(it && it.qty, 1, S.maxPerItem, 'تعداد');
      const key = id + '|' + color;
      lines.set(key, { id, color, qty: (lines.get(key) ? lines.get(key).qty : 0) + qty });
    }

    // قیمت‌ها همیشه از پایگاه داده خوانده می‌شوند؛ قیمتی که مرورگر بفرستد نادیده گرفته می‌شود
    const order = tx(() => {
      const items = []; const perProduct = new Map();
      let listTotal = 0; let payable = 0;
      for (const l of lines.values()) {
        const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(l.id);
        if (!p) throw new HttpError(409, 'یکی از کالاهای سبد شما دیگر فروخته نمی‌شود. سبد را بررسی کنید.');
        const total = (perProduct.get(p.id) || 0) + l.qty;
        if (total > p.stock) throw new HttpError(409, 'موجودی «' + p.title + '» کافی نیست' + (p.stock ? ' (فقط ' + p.stock + ' عدد موجود است).' : '.'));
        if (total > S.maxPerItem) throw new HttpError(409, 'از هر کالا حداکثر ' + S.maxPerItem + ' عدد می‌توانید سفارش دهید.');
        perProduct.set(p.id, total);
        const colors = JSON.parse(p.colors);
        if (colors.length && !colors[l.color]) throw new HttpError(400, 'رنگ انتخاب‌شده برای «' + p.title + '» معتبر نیست.');
        const price = finalPrice(p);
        items.push({ id: p.id, title: p.title, emoji: p.emoji, img: p.img, color: colors[l.color] || null, qty: l.qty, price, listPrice: p.price });
        listTotal += p.price * l.qty;
        payable += price * l.qty;
      }
      const dec = db.prepare('UPDATE products SET stock = stock - ?, sold = sold + ? WHERE id = ?');
      for (const [id, q] of perProduct) dec.run(q, q, id);

      let coupon = null; let couponDisc = 0;
      if (b.coupon) {
        const c = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(String(b.coupon).trim().toUpperCase());
        if (!c) throw new HttpError(400, 'کد تخفیف معتبر نیست یا منقضی شده است.');
        coupon = c.code;
        couponDisc = Math.min(Math.round(payable * c.pct / 100 / 1000) * 1000, c.cap);
        db.prepare('UPDATE coupons SET uses = uses + 1 WHERE code = ?').run(c.code);
      }
      const shipCost = ship === 'express' ? S.shipExpress : (payable >= S.freeShip ? 0 : S.shipNormal);
      const totalPay = payable - couponDisc + shipCost;
      let code;
      do { code = 'KL-' + crypto.randomInt(10000000, 99999999); } while (db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code));
      const r = db.prepare(`INSERT INTO orders (code, user_id, status, pay_method, ship_method, items, list_total, payable, coupon, coupon_disc, ship_cost, total, address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(code, u.id, payMethod === 'online' ? 'pending_payment' : 'processing', payMethod, ship, JSON.stringify(items),
          listTotal, payable, coupon, couponDisc, shipCost, totalPay, JSON.stringify(address), Date.now());
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(r.lastInsertRowid);
    });

    if (payMethod === 'cod') return { order: orderOut(order) };
    try {
      const r = await pay.request({
        amountToman: order.total, description: 'سفارش ' + order.code + ' از ' + S.storeName,
        callbackUrl: cfg.publicUrl + '/api/pay/callback', mobile: u.phone, orderCode: order.code
      });
      db.prepare('UPDATE orders SET authority = ? WHERE id = ?').run(r.authority, order.id);
      return { order: orderOut(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)), payUrl: r.url };
    } catch (e) {
      console.error(e);
      failOrder(order.id, 'payment_failed');
      throw new HttpError(502, 'اتصال به درگاه پرداخت برقرار نشد. دوباره تلاش کنید یا پرداخت در محل را انتخاب کنید.');
    }
  });

  route('GET', '/api/orders', (ctx) => {
    const u = requireUser(ctx);
    return { orders: db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(u.id).map(orderOut) };
  });

  route('GET', '/api/orders/:code', (ctx) => {
    const u = requireUser(ctx);
    const o = db.prepare('SELECT * FROM orders WHERE code = ? AND user_id = ?').get(ctx.params.code, u.id);
    if (!o) throw new HttpError(404, 'سفارشی با این کد پیدا نشد.');
    return orderOut(o);
  });

  /* ---------- بازگشت از درگاه ---------- */
  route('GET', '/api/pay/callback', async (ctx) => {
    const authority = String(ctx.query.Authority || '');
    const o = authority ? db.prepare('SELECT * FROM orders WHERE authority = ?').get(authority) : null;
    if (!o) return redirect(ctx.res, '/#/');
    const dest = '/#/done/' + o.code;
    if (o.status !== 'pending_payment') return redirect(ctx.res, dest);
    if (ctx.query.Status !== 'OK') { failOrder(o.id, 'payment_failed'); return redirect(ctx.res, dest); }
    let v;
    try { v = await pay.verify({ amountToman: o.total, authority }); } catch (e) { console.error(e); v = { ok: false }; }
    if (v.ok) {
      db.prepare("UPDATE orders SET status = 'processing', ref_id = ?, paid_at = ? WHERE id = ? AND status = 'pending_payment'").run(v.refId, Date.now(), o.id);
    } else {
      failOrder(o.id, 'payment_failed');
    }
    return redirect(ctx.res, dest);
  });

  /** صفحه پرداخت شبیه‌سازی‌شده؛ فقط در حالت توسعه وقتی مرچنت کد تنظیم نشده */
  route('GET', '/api/pay/fake', (ctx) => {
    if (pay.mode !== 'fake') throw new HttpError(404, 'پیدا نشد');
    const authority = String(ctx.query.Authority || '');
    const o = db.prepare('SELECT code, total FROM orders WHERE authority = ?').get(authority);
    if (!o) throw new HttpError(404, 'تراکنش پیدا نشد');
    const q = '/api/pay/callback?Authority=' + encodeURIComponent(authority);
    const html = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>درگاه پرداخت آزمایشی</title>' +
      '<style>body{font-family:Tahoma,sans-serif;background:#f4f6fb;color:#1d2433;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}' +
      '.box{background:#fff;border-radius:16px;padding:28px;max-width:380px;width:100%;box-shadow:0 8px 30px rgb(0 0 0/8%);text-align:center}' +
      '.amt{font-size:26px;font-weight:700;margin:14px 0}a{display:block;padding:12px;border-radius:10px;margin-top:10px;text-decoration:none;font-weight:700}' +
      '.ok{background:#12936f;color:#fff}.no{background:#eef0f5;color:#1d2433}small{color:#6b7385}</style></head><body><div class="box">' +
      '<b>درگاه پرداخت آزمایشی</b><div><small>سفارش ' + o.code + '</small></div><div class="amt">' + o.total.toLocaleString('fa-IR') + ' تومان</div>' +
      '<small>این صفحه فقط در حالت توسعه نمایش داده می‌شود. برای پرداخت واقعی، مرچنت کد زرین‌پال را در فایل .env وارد کنید.</small>' +
      '<a class="ok" href="' + q + '&amp;Status=OK">پرداخت موفق</a><a class="no" href="' + q + '&amp;Status=NOK">انصراف از پرداخت</a></div></body></html>';
    ctx.res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    ctx.res.end(html);
  });

  /* =====================================================================
     API پنل مدیریت
     ===================================================================== */
  route('POST', '/api/admin/login', (ctx) => {
    if (!limit('admin:' + ctx.ip, 8, 15 * 60000)) throw new HttpError(429, 'تعداد تلاش‌ها زیاد بود. ۱۵ دقیقه دیگر دوباره امتحان کنید.');
    const pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!safeEqual(sha(pw), sha(cfg.adminPassword))) throw new HttpError(401, 'رمز عبور اشتباه است.');
    return { token: createSession(null, true, 12 * 3600000), devPassword: cfg.devAdminPassword };
  });

  route('GET', '/api/admin/me', (ctx) => { requireAdmin(ctx); return { ok: true, integrations: integrations(), devPassword: cfg.devAdminPassword }; });

  route('POST', '/api/admin/logout', (ctx) => {
    const s = session(ctx);
    if (s) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash);
    return { ok: true };
  });

  route('GET', '/api/admin/stats', (ctx) => {
    requireAdmin(ctx);
    const paidIn = "status IN ('processing', 'shipped', 'delivered')";
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from = today.getTime() - 13 * DAY;
    const daily = [];
    for (let i = 0; i < 14; i++) daily.push({ day: from + i * DAY, total: 0, count: 0 });
    for (const o of db.prepare('SELECT created_at, total FROM orders WHERE created_at >= ? AND ' + paidIn).all(from)) {
      const d = new Date(o.created_at); d.setHours(0, 0, 0, 0);
      const slot = daily.find((x) => x.day === d.getTime());
      if (slot) { slot.total += o.total; slot.count++; }
    }
    return {
      revenue: db.prepare('SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE ' + paidIn).get().v,
      ordersToday: db.prepare("SELECT COUNT(*) AS v FROM orders WHERE created_at >= ? AND status != 'payment_failed'").get(today.getTime()).v,
      toShip: db.prepare("SELECT COUNT(*) AS v FROM orders WHERE status = 'processing'").get().v,
      customers: db.prepare('SELECT COUNT(*) AS v FROM users').get().v,
      products: db.prepare('SELECT COUNT(*) AS v FROM products WHERE active = 1').get().v,
      lowStock: db.prepare('SELECT id, title, emoji, stock FROM products WHERE active = 1 AND stock <= 3 ORDER BY stock, id LIMIT 8').all().map((p) => Object.assign({}, p)),
      latest: db.prepare('SELECT o.*, u.phone AS user_phone FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 6').all()
        .map((o) => Object.assign(orderOut(o), { userPhone: o.user_phone })),
      daily
    };
  });

  /* ---------- محصولات ---------- */
  function productIn(b, existing) {
    const cat = str(b.cat, 40, 1, 'دسته‌بندی');
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cat)) throw new HttpError(400, 'دسته‌بندی انتخاب‌شده وجود ندارد.');
    const colors = Array.isArray(b.colors) ? b.colors : [];
    if (colors.length > 12) throw new HttpError(400, 'حداکثر ۱۲ رنگ می‌توانید تعریف کنید.');
    const specsIn = Array.isArray(b.specs) ? b.specs : Object.entries(b.specs || {});
    if (specsIn.length > 30) throw new HttpError(400, 'حداکثر ۳۰ ردیف مشخصات مجاز است.');
    const specs = {};
    for (const pair of specsIn) {
      const k = str(pair && pair[0], 40, 1, 'عنوان مشخصه');
      specs[k] = str(pair && pair[1], 200, 1, 'مقدار مشخصه');
    }
    let img = b.img ? String(b.img).trim() : null;
    if (img && !/^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp)$/.test(img) && !/^https:\/\/[^\s"'<>]{4,500}$/.test(img)) throw new HttpError(400, 'آدرس عکس معتبر نیست.');
    return {
      title: str(b.title, 200, 3, 'نام کالا'), cat, brand: str(b.brand, 60, 1, 'برند'),
      price: int(b.price, 1000, 10000000000, 'قیمت'), off: int(b.off || 0, 0, 90, 'درصد تخفیف'),
      stock: int(b.stock || 0, 0, 1000000, 'موجودی'), emoji: str(b.emoji || '📦', 16, 1, 'ایموجی'),
      colors: JSON.stringify(colors.map((c) => {
        const hex = String(c && c.hex || '');
        if (!HEX_RE.test(hex)) throw new HttpError(400, 'کد رنگ معتبر نیست.');
        return { name: str(c.name, 20, 1, 'نام رنگ'), hex: hex.toLowerCase() };
      })),
      specs: JSON.stringify(specs), img, description: str(b.description || '', 3000, 0, 'توضیحات'),
      active: b.active === false ? 0 : 1, existing
    };
  }

  route('GET', '/api/admin/products', (ctx) => {
    requireAdmin(ctx);
    return { products: db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(productOut) };
  });
  route('POST', '/api/admin/products', (ctx) => {
    requireAdmin(ctx);
    const p = productIn(ctx.body);
    const r = db.prepare(`INSERT INTO products (title, cat, brand, price, off, stock, emoji, colors, specs, img, description, active, created_at, rating, reviews, sold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`)
      .run(p.title, p.cat, p.brand, p.price, p.off, p.stock, p.emoji, p.colors, p.specs, p.img, p.description, p.active, Date.now());
    return { product: productOut(db.prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid)) };
  });
  route('PUT', '/api/admin/products/:id', (ctx) => {
    requireAdmin(ctx);
    const id = int(ctx.params.id, 1, 1e12, 'کالا');
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'کالا پیدا نشد.');
    const p = productIn(ctx.body);
    db.prepare('UPDATE products SET title = ?, cat = ?, brand = ?, price = ?, off = ?, stock = ?, emoji = ?, colors = ?, specs = ?, img = ?, description = ?, active = ? WHERE id = ?')
      .run(p.title, p.cat, p.brand, p.price, p.off, p.stock, p.emoji, p.colors, p.specs, p.img, p.description, p.active, id);
    return { product: productOut(db.prepare('SELECT * FROM products WHERE id = ?').get(id)) };
  });
  route('DELETE', '/api/admin/products/:id', (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare('DELETE FROM products WHERE id = ?').run(int(ctx.params.id, 1, 1e12, 'کالا'));
    if (!r.changes) throw new HttpError(404, 'کالا پیدا نشد.');
    return { ok: true };
  });

  route('POST', '/api/admin/upload', (ctx) => {
    requireAdmin(ctx);
    const raw = String(ctx.body.data || '').replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) throw new HttpError(400, 'فایلی دریافت نشد.');
    if (buf.length > 3 * 1024 * 1024) throw new HttpError(413, 'حجم عکس باید کمتر از ۳ مگابایت باشد.');
    let ext = null;
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
    else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
    else if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') ext = 'webp';
    if (!ext) throw new HttpError(400, 'فقط عکس با فرمت JPG، PNG یا WebP قابل بارگذاری است.');
    const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(cfg.dataDir, 'uploads', name), buf);
    return { url: '/uploads/' + name };
  }, { limit: 5 * 1024 * 1024 });

  /* ---------- دسته‌بندی‌ها ---------- */
  function categoryIn(b) {
    const subs = Array.isArray(b.subs) ? b.subs : String(b.subs || '').split(/[،,]/);
    return {
      name: str(b.name, 40, 2, 'نام دسته'), icon: str(b.icon || '📦', 16, 1, 'آیکون'), hue: int(b.hue == null ? 20 : b.hue, 0, 360, 'رنگ'),
      subs: JSON.stringify(subs.map((s) => String(s).trim()).filter(Boolean).slice(0, 20).map((s) => str(s, 40, 1, 'زیردسته')))
    };
  }
  route('GET', '/api/admin/categories', (ctx) => {
    requireAdmin(ctx);
    return {
      categories: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.cat = c.id) AS n FROM categories c ORDER BY sort, name').all()
        .map((c) => Object.assign(categoryOut(c), { products: c.n }))
    };
  });
  route('POST', '/api/admin/categories', (ctx) => {
    requireAdmin(ctx);
    const id = String(ctx.body.id || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{2,30}$/.test(id)) throw new HttpError(400, 'شناسه دسته باید ۲ تا ۳۰ حرف انگلیسی کوچک، عدد یا خط تیره باشد.');
    if (db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) throw new HttpError(409, 'دسته‌ای با این شناسه وجود دارد.');
    const c = categoryIn(ctx.body);
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories').get().s;
    db.prepare('INSERT INTO categories (id, name, icon, hue, subs, sort) VALUES (?, ?, ?, ?, ?, ?)').run(id, c.name, c.icon, c.hue, c.subs, sort);
    return { ok: true };
  });
  route('PUT', '/api/admin/categories/:id', (ctx) => {
    requireAdmin(ctx);
    const c = categoryIn(ctx.body);
    const r = db.prepare('UPDATE categories SET name = ?, icon = ?, hue = ?, subs = ? WHERE id = ?').run(c.name, c.icon, c.hue, c.subs, ctx.params.id);
    if (!r.changes) throw new HttpError(404, 'دسته پیدا نشد.');
    return { ok: true };
  });
  route('DELETE', '/api/admin/categories/:id', (ctx) => {
    requireAdmin(ctx);
    if (db.prepare('SELECT 1 FROM products WHERE cat = ?').get(ctx.params.id)) throw new HttpError(409, 'این دسته کالا دارد. ابتدا کالاها را به دسته دیگری منتقل یا حذف کنید.');
    const r = db.prepare('DELETE FROM categories WHERE id = ?').run(ctx.params.id);
    if (!r.changes) throw new HttpError(404, 'دسته پیدا نشد.');
    return { ok: true };
  });

  /* ---------- سفارش‌ها ---------- */
  route('GET', '/api/admin/orders', (ctx) => {
    requireAdmin(ctx);
    const where = []; const args = [];
    if (STATUSES.includes(ctx.query.status)) { where.push('o.status = ?'); args.push(ctx.query.status); }
    const q = toEn(ctx.query.q || '').trim();
    if (q) { where.push('(o.code LIKE ? OR u.phone LIKE ?)'); args.push('%' + q + '%', '%' + q + '%'); }
    const rows = db.prepare('SELECT o.*, u.phone AS user_phone, u.name AS user_name FROM orders o JOIN users u ON u.id = o.user_id' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY o.id DESC LIMIT 300').all(...args);
    return { orders: rows.map((o) => Object.assign(orderOut(o), { userPhone: o.user_phone, userName: o.user_name })) };
  });
  route('PUT', '/api/admin/orders/:code', (ctx) => {
    requireAdmin(ctx);
    const status = String(ctx.body.status || '');
    if (!['processing', 'shipped', 'delivered', 'cancelled'].includes(status)) throw new HttpError(400, 'وضعیت انتخاب‌شده معتبر نیست.');
    return tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(ctx.params.code);
      if (!o) throw new HttpError(404, 'سفارش پیدا نشد.');
      if (o.status === 'cancelled' || o.status === 'payment_failed') throw new HttpError(400, 'وضعیت سفارش لغوشده یا پرداخت‌نشده قابل تغییر نیست.');
      if (o.status === 'pending_payment' && status !== 'cancelled') throw new HttpError(400, 'این سفارش هنوز پرداخت نشده است.');
      if (status === 'cancelled') releaseStock(o);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, o.id);
      return { order: orderOut(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)) };
    });
  });

  /* ---------- دیدگاه‌ها ---------- */
  route('GET', '/api/admin/reviews', (ctx) => {
    requireAdmin(ctx);
    return {
      reviews: db.prepare('SELECT r.*, p.title AS product_title, p.emoji FROM reviews r JOIN products p ON p.id = r.product_id ORDER BY r.id DESC LIMIT 300').all()
        .map((r) => ({ id: r.id, productId: r.product_id, product: r.product_title, emoji: r.emoji, name: r.name, rate: r.rate, text: r.text, buyer: Boolean(r.buyer), approved: Boolean(r.approved), createdAt: r.created_at }))
    };
  });
  route('PUT', '/api/admin/reviews/:id', (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run(ctx.body.approved ? 1 : 0, int(ctx.params.id, 1, 1e12, 'دیدگاه'));
    if (!r.changes) throw new HttpError(404, 'دیدگاه پیدا نشد.');
    return { ok: true };
  });
  route('DELETE', '/api/admin/reviews/:id', (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare('DELETE FROM reviews WHERE id = ?').run(int(ctx.params.id, 1, 1e12, 'دیدگاه'));
    if (!r.changes) throw new HttpError(404, 'دیدگاه پیدا نشد.');
    return { ok: true };
  });

  /* ---------- کدهای تخفیف ---------- */
  route('GET', '/api/admin/coupons', (ctx) => {
    requireAdmin(ctx);
    return { coupons: db.prepare('SELECT * FROM coupons ORDER BY code').all().map((c) => ({ code: c.code, pct: c.pct, cap: c.cap, active: Boolean(c.active), uses: c.uses })) };
  });
  route('POST', '/api/admin/coupons', (ctx) => {
    requireAdmin(ctx);
    const code = String(ctx.body.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new HttpError(400, 'کد تخفیف باید ۳ تا ۲۰ حرف انگلیسی یا عدد باشد.');
    if (db.prepare('SELECT 1 FROM coupons WHERE code = ?').get(code)) throw new HttpError(409, 'این کد تخفیف قبلاً ساخته شده است.');
    db.prepare('INSERT INTO coupons (code, pct, cap) VALUES (?, ?, ?)').run(code, int(ctx.body.pct, 1, 90, 'درصد تخفیف'), int(ctx.body.cap, 0, 1000000000, 'سقف تخفیف'));
    return { ok: true };
  });
  route('PUT', '/api/admin/coupons/:code', (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare('UPDATE coupons SET active = ? WHERE code = ?').run(ctx.body.active ? 1 : 0, ctx.params.code);
    if (!r.changes) throw new HttpError(404, 'کد تخفیف پیدا نشد.');
    return { ok: true };
  });
  route('DELETE', '/api/admin/coupons/:code', (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare('DELETE FROM coupons WHERE code = ?').run(ctx.params.code);
    if (!r.changes) throw new HttpError(404, 'کد تخفیف پیدا نشد.');
    return { ok: true };
  });

  /* ---------- مشتریان ---------- */
  route('GET', '/api/admin/users', (ctx) => {
    requireAdmin(ctx);
    const rows = db.prepare(`SELECT u.*, COUNT(o.id) AS orders,
        COALESCE(SUM(CASE WHEN o.status IN ('processing', 'shipped', 'delivered') THEN o.total END), 0) AS spent
      FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id ORDER BY u.id DESC LIMIT 500`).all();
    return { users: rows.map((u) => ({ id: u.id, phone: u.phone, name: u.name, orders: u.orders, spent: u.spent, createdAt: u.created_at })) };
  });

  /* ---------- تنظیمات فروشگاه ---------- */
  route('GET', '/api/admin/settings', (ctx) => { requireAdmin(ctx); return { settings: getSettings(), integrations: integrations() }; });
  route('PUT', '/api/admin/settings', (ctx) => {
    requireAdmin(ctx);
    const b = ctx.body;
    const next = {
      storeName: str(b.storeName, 30, 2, 'نام فروشگاه'), phone: str(b.phone || '', 40, 0, 'تلفن پشتیبانی'),
      brandColor: HEX_RE.test(b.brandColor) ? b.brandColor.toLowerCase() : null, accentColor: HEX_RE.test(b.accentColor) ? b.accentColor.toLowerCase() : null,
      freeShip: int(b.freeShip, 0, 1000000000, 'حداقل خرید برای ارسال رایگان'), shipNormal: int(b.shipNormal, 0, 100000000, 'هزینه ارسال عادی'),
      shipExpress: int(b.shipExpress, 0, 100000000, 'هزینه ارسال اکسپرس'), maxPerItem: int(b.maxPerItem, 1, 50, 'حداکثر تعداد هر کالا')
    };
    if (!next.brandColor || !next.accentColor) throw new HttpError(400, 'کد رنگ معتبر نیست.');
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    tx(() => { for (const [k, v] of Object.entries(next)) up.run(k, JSON.stringify(v)); });
    return { settings: getSettings() };
  });

  /* =====================================================================
     هسته HTTP
     ===================================================================== */
  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', CSP);
  }
  function json(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(data);
  }
  function redirect(res, to) { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); }

  function readJson(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0; let tooBig = false; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) {
          if (!tooBig) { tooBig = true; chunks.length = 0; reject(new HttpError(413, 'حجم درخواست بیش از حد مجاز است.', { close: true })); }
          return; // بقیه بدنه خوانده و دور ریخته می‌شود تا پاسخ ۴۱۳ به مرورگر برسد
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return;
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
        } catch (e) { reject(new HttpError(400, 'داده ارسالی معتبر نیست.')); }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'روش درخواست مجاز نیست.' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (e) { return json(res, 400, { error: 'آدرس نامعتبر' }); }
    if (pathname.includes('\0')) return json(res, 400, { error: 'آدرس نامعتبر' });
    let base = cfg.publicDir; let rel = pathname; let immutable = false;
    if (pathname.startsWith('/uploads/')) { base = path.join(cfg.dataDir, 'uploads'); rel = pathname.slice('/uploads'.length); immutable = true; }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(base, path.normalize(rel));
    if (file !== base && !file.startsWith(base + path.sep)) return notFound(res);
    fs.stat(file, (err, st) => {
      if (err) return notFound(res);
      if (st.isDirectory()) return redirect(res, url.pathname + '/' + url.search);
      const mtime = st.mtime.toUTCString();
      const headers = {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'last-modified': mtime,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
      };
      if (req.headers['if-modified-since'] === mtime) { res.writeHead(304, headers); return res.end(); }
      headers['content-length'] = st.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }
  function notFound(res) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>پیدا نشد</title><p dir="rtl" style="font-family:Tahoma;padding:40px;text-align:center">صفحه پیدا نشد. <a href="/">بازگشت به فروشگاه</a></p>');
  }

  async function handle(req, res) {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    const candidates = routes.filter((r) => r.re.test(url.pathname));
    if (!candidates.length) throw new HttpError(404, 'مسیر API پیدا نشد.');
    const r = candidates.find((x) => x.method === req.method);
    if (!r) throw new HttpError(405, 'روش درخواست مجاز نیست.');
    const params = {};
    for (const [k, v] of Object.entries(url.pathname.match(r.re).groups || {})) params[k] = decodeURIComponent(v);
    const fwd = cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ctx = {
      req, res, url, params, query: Object.fromEntries(url.searchParams),
      ip: fwd || req.socket.remoteAddress || 'unknown',
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req, r.opts.limit || 1024 * 1024) : {}
    };
    const out = await r.handler(ctx);
    if (!res.headersSent && !res.writableEnded) json(res, 200, out === undefined ? { ok: true } : out);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) {
        if (e.extra && e.extra.close) { res.setHeader('connection', 'close'); return json(res, e.status, { error: e.message }); }
        return json(res, e.status, Object.assign({ error: e.message }, e.extra || {}));
      }
      console.error(e);
      json(res, 500, { error: 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.' });
    });
  });

  return {
    server, db, pay, sms, log,
    close() { clearInterval(timer); return new Promise((r) => server.close(() => { db.close(); r(); })); }
  };
}

module.exports = { createApp, finalPrice };
