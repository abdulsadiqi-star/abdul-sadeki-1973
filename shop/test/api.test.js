'use strict';
/* تست‌های خودکار API: npm test */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../server/config');
const { createApp, finalPrice } = require('../server/app');

let app; let base; let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalano-test-'));
  const cfg = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-admin-pass', APP_SECRET: 'test-secret', QUIET: 'true', ZARINPAL_MERCHANT_ID: '', KAVENEGAR_API_KEY: '' });
  app = createApp(cfg);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function call(method, url, body, token) {
  const headers = { accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

let phoneSeq = 0;
async function login(name) {
  const phone = '0912' + String(1000000 + (++phoneSeq)).slice(-7);
  const r = await call('POST', '/api/auth/request', { phone });
  assert.equal(r.status, 200);
  assert.match(r.body.devCode, /^\d{5}$/);
  const v = await call('POST', '/api/auth/verify', { phone, code: r.body.devCode, name: name || '' });
  assert.equal(v.status, 200);
  return { token: v.body.token, phone };
}
const address = (phone) => ({ name: 'عبدل تست', phone, province: 'تهران', city: 'تهران', address: 'خیابان آزادی، پلاک ۱۰، واحد ۲', postal: '۱۲۳۴۵۶۷۸۹۰' });
async function adminToken() { return (await call('POST', '/api/admin/login', { password: 'test-admin-pass' })).body.token; }
async function product(id) { return (await call('GET', '/api/catalog')).body.products.find((p) => p.id === id); }

test('تنظیمات و کاتالوگ از داده‌های نمونه ساخته می‌شوند', async () => {
  const s = await call('GET', '/api/settings');
  assert.equal(s.status, 200);
  assert.equal(s.body.storeName, 'کالانو');
  assert.equal(s.body.features.paymentMode, 'fake');
  const c = await call('GET', '/api/catalog');
  assert.equal(c.body.categories.length, 10);
  assert.equal(c.body.products.length, 48);
});

test('ورود با کد: کد اشتباه رد می‌شود و بعد از ۵ تلاش قفل می‌شود', async () => {
  const phone = '09350000001';
  const r = await call('POST', '/api/auth/request', { phone });
  const wrong = r.body.devCode === '11111' ? '22222' : '11111';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/verify', { phone, code: wrong })).status, 400);
  assert.equal((await call('POST', '/api/auth/verify', { phone, code: r.body.devCode })).status, 429);
  // ارسال دوباره قبل از ۶۰ ثانیه مجاز نیست
  assert.equal((await call('POST', '/api/auth/request', { phone })).status, 429);
});

test('شماره موبایل نامعتبر رد می‌شود و ارقام فارسی پذیرفته می‌شوند', async () => {
  assert.equal((await call('POST', '/api/auth/request', { phone: '12345' })).status, 400);
  assert.equal((await call('POST', '/api/auth/request', { phone: '۰۹۱۹۹۹۹۹۹۹۹' })).status, 200);
});

test('بدون ورود نمی‌شود سفارش داد یا سفارش‌ها را دید', async () => {
  assert.equal((await call('POST', '/api/orders', { items: [{ id: 1, qty: 1 }] })).status, 401);
  assert.equal((await call('GET', '/api/orders')).status, 401);
  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
});

test('سفارش پرداخت در محل: قیمت از سرور حساب می‌شود و موجودی کم می‌شود', async () => {
  const u = await login('مشتری');
  const before = await product(34);
  const r = await call('POST', '/api/orders', {
    items: [{ id: 34, qty: 2, price: 1 }], coupon: 'kalano10', ship: 'normal', pay: 'cod', address: address(u.phone)
  }, u.token);
  assert.equal(r.status, 200, r.text);
  const o = r.body.order;
  const unit = finalPrice({ price: before.price, off: before.off });
  assert.equal(o.payable, unit * 2);
  const disc = Math.min(Math.round(unit * 2 * 0.1 / 1000) * 1000, 300000);
  assert.equal(o.couponDisc, disc);
  assert.equal(o.shipCost, 49000);
  assert.equal(o.total, unit * 2 - disc + 49000);
  assert.equal(o.status, 'processing');
  assert.equal((await product(34)).stock, before.stock - 2);
  const mine = await call('GET', '/api/orders', null, u.token);
  assert.equal(mine.body.orders.length, 1);
  // کاربر دیگر نمی‌تواند سفارش این کاربر را ببیند
  const other = await login();
  assert.equal((await call('GET', '/api/orders/' + o.code, null, other.token)).status, 404);
});

test('سفارش بیشتر از موجودی و کالای ناموجود رد می‌شود', async () => {
  const u = await login();
  const p = await product(37); // موجودی ۴
  const r = await call('POST', '/api/orders', { items: [{ id: 37, qty: 5 }], pay: 'cod', address: address(u.phone) }, u.token);
  assert.equal(r.status, 409); // ۵ عدد در سقف مجاز است اما از موجودی بیشتر است
  assert.equal((await call('POST', '/api/orders', { items: [{ id: 37, qty: 9 }], pay: 'cod', address: address(u.phone) }, u.token)).status, 400); // بیشتر از سقف هر کالا
  const r2 = await call('POST', '/api/orders', { items: [{ id: 37, qty: 3 }, { id: 37, qty: 2 }], pay: 'cod', address: address(u.phone) }, u.token);
  assert.equal(r2.status, 409);
  assert.equal((await product(37)).stock, p.stock);
  const r3 = await call('POST', '/api/orders', { items: [{ id: 6, qty: 1 }], pay: 'cod', address: address(u.phone) }, u.token);
  assert.equal(r3.status, 409);
});

test('آدرس ناقص و کد تخفیف نامعتبر رد می‌شوند', async () => {
  const u = await login();
  const bad = await call('POST', '/api/orders', { items: [{ id: 1, qty: 1 }], pay: 'cod', address: Object.assign(address(u.phone), { postal: '123' }) }, u.token);
  assert.equal(bad.status, 400);
  const badCoupon = await call('POST', '/api/orders', { items: [{ id: 1, qty: 1 }], pay: 'cod', coupon: 'NOPE', address: address(u.phone) }, u.token);
  assert.equal(badCoupon.status, 400);
  assert.equal((await call('POST', '/api/coupons/check', { code: 'nope' })).status, 404);
  assert.equal((await call('POST', '/api/coupons/check', { code: 'kalano10' })).body.pct, 10);
});

test('پرداخت اینترنتی: موفق، ناموفق و جعل callback', async () => {
  const u = await login();
  const stock0 = (await product(10)).stock;
  const ok = await call('POST', '/api/orders', { items: [{ id: 10, qty: 1 }], pay: 'online', address: address(u.phone) }, u.token);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.order.status, 'pending_payment');
  const authority = new URL(ok.body.payUrl, base).searchParams.get('Authority');
  const page = await call('GET', '/api/pay/fake?Authority=' + authority);
  assert.equal(page.status, 200);
  const cb = await call('GET', '/api/pay/callback?Authority=' + authority + '&Status=OK');
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/#/done/' + ok.body.order.code);
  const paid = await call('GET', '/api/orders/' + ok.body.order.code, null, u.token);
  assert.equal(paid.body.status, 'processing');
  assert.ok(paid.body.refId);
  // بازگشت دوباره از درگاه، وضعیت را عوض نمی‌کند
  await call('GET', '/api/pay/callback?Authority=' + authority + '&Status=NOK');
  assert.equal((await call('GET', '/api/orders/' + ok.body.order.code, null, u.token)).body.status, 'processing');

  const fail = await call('POST', '/api/orders', { items: [{ id: 10, qty: 2 }], pay: 'online', address: address(u.phone) }, u.token);
  const a2 = new URL(fail.body.payUrl, base).searchParams.get('Authority');
  assert.equal((await product(10)).stock, stock0 - 3);
  await call('GET', '/api/pay/callback?Authority=' + a2 + '&Status=NOK');
  assert.equal((await call('GET', '/api/orders/' + fail.body.order.code, null, u.token)).body.status, 'payment_failed');
  assert.equal((await product(10)).stock, stock0 - 1); // موجودی سفارش ناموفق برگشت

  const forged = await call('GET', '/api/pay/callback?Authority=NOT-REAL&Status=OK');
  assert.equal(forged.status, 302);
  assert.equal(forged.headers.get('location'), '/#/');
});

test('دیدگاه: فقط کاربر واردشده و با متن معتبر', async () => {
  assert.equal((await call('POST', '/api/products/2/reviews', { rate: 5, text: 'خیلی خوب بود واقعا', name: 'علی' })).status, 401);
  const u = await login('علی');
  assert.equal((await call('POST', '/api/products/2/reviews', { rate: 5, text: 'کوتاه', name: 'علی' }, u.token)).status, 400);
  assert.equal((await call('POST', '/api/products/2/reviews', { rate: 5, text: 'کیفیت ساخت عالی و ارسال سریع بود', name: 'علی <b>' }, u.token)).status, 200);
  const list = await call('GET', '/api/products/2/reviews');
  assert.equal(list.body.reviews[0].name, 'علی <b>'); // متن خام ذخیره و در مرورگر escape می‌شود
});

test('پنل مدیریت: رمز اشتباه، مدیریت کالا، تغییر وضعیت و لغو سفارش', async () => {
  assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401);
  const t = await adminToken();
  assert.ok(t);
  // توکن مشتری به پنل مدیریت دسترسی ندارد
  const u = await login();
  assert.equal((await call('GET', '/api/admin/stats', null, u.token)).status, 401);

  const created = await call('POST', '/api/admin/products', {
    title: 'ماگ سرامیکی طرح کاشی', cat: 'home', brand: 'کالانو هوم', price: 250000, off: 10, stock: 7, emoji: '☕',
    colors: [{ name: 'آبی', hex: '#2F6FD6' }], specs: [['جنس', 'سرامیک'], ['حجم', '۳۰۰ میلی‌لیتر']]
  }, t);
  assert.equal(created.status, 200, created.text);
  const pid = created.body.product.id;
  assert.equal(created.body.product.specs['جنس'], 'سرامیک');
  assert.ok((await call('GET', '/api/catalog')).body.products.some((p) => p.id === pid));
  assert.equal((await call('POST', '/api/admin/products', { title: 'x', cat: 'home', price: 5 }, t)).status, 400);
  assert.equal((await call('POST', '/api/admin/products', { title: 'کالای بد', cat: 'home', brand: 'b', price: 10000, img: 'javascript:alert(1)' }, t)).status, 400);

  const hide = await call('PUT', '/api/admin/products/' + pid, Object.assign({}, created.body.product, { specs: Object.entries(created.body.product.specs), active: false }), t);
  assert.equal(hide.status, 200, hide.text);
  assert.ok(!(await call('GET', '/api/catalog')).body.products.some((p) => p.id === pid));

  const order = await call('POST', '/api/orders', { items: [{ id: 2, qty: 1 }], pay: 'cod', address: address(u.phone) }, u.token);
  const stock = (await product(2)).stock;
  assert.equal((await call('PUT', '/api/admin/orders/' + order.body.order.code, { status: 'shipped' }, t)).status, 200);
  assert.equal((await call('PUT', '/api/admin/orders/' + order.body.order.code, { status: 'cancelled' }, t)).status, 200);
  assert.equal((await product(2)).stock, stock + 1);
  assert.equal((await call('PUT', '/api/admin/orders/' + order.body.order.code, { status: 'processing' }, t)).status, 400);

  const stats = await call('GET', '/api/admin/stats', null, t);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.daily.length, 14);
  assert.ok(stats.body.revenue > 0);
  assert.equal((await call('DELETE', '/api/admin/products/' + pid, null, t)).status, 200);
});

test('تنظیمات فروشگاه از پنل مدیریت تغییر می‌کند', async () => {
  const t = await adminToken();
  const r = await call('PUT', '/api/admin/settings', { storeName: 'بازارچه', phone: '۰۲۱-۱۲۳', brandColor: '#2E9D6A', accentColor: '#FFC83D', freeShip: 500000, shipNormal: 30000, shipExpress: 70000, maxPerItem: 3 }, t);
  assert.equal(r.status, 200, r.text);
  const s = await call('GET', '/api/settings');
  assert.equal(s.body.storeName, 'بازارچه');
  assert.equal(s.body.brandColor, '#2e9d6a');
  assert.equal((await call('PUT', '/api/admin/settings', { storeName: 'x', brandColor: 'red' }, t)).status, 400);
});

test('کد تخفیف و دسته‌بندی از پنل مدیریت ساخته و حذف می‌شوند', async () => {
  const t = await adminToken();
  assert.equal((await call('POST', '/api/admin/coupons', { code: 'yalda20', pct: 20, cap: 500000 }, t)).status, 200);
  assert.equal((await call('POST', '/api/coupons/check', { code: 'YALDA20' })).body.pct, 20);
  assert.equal((await call('PUT', '/api/admin/coupons/YALDA20', { active: false }, t)).status, 200);
  assert.equal((await call('POST', '/api/coupons/check', { code: 'YALDA20' })).status, 404);
  assert.equal((await call('POST', '/api/admin/categories', { id: 'pets', name: 'حیوانات خانگی', icon: '🐶', hue: 30, subs: 'غذا، اسباب‌بازی' }, t)).status, 200);
  assert.equal((await call('DELETE', '/api/admin/categories/mobile', null, t)).status, 409);
  assert.equal((await call('DELETE', '/api/admin/categories/pets', null, t)).status, 200);
});

test('بارگذاری عکس فقط فرمت‌های مجاز را می‌پذیرد', async () => {
  const t = await adminToken();
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  const ok = await call('POST', '/api/admin/upload', { data: 'data:image/png;base64,' + png }, t);
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /^\/uploads\/[a-f0-9]{24}\.png$/);
  const served = await fetch(base + ok.body.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  const html = Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await call('POST', '/api/admin/upload', { data: html }, t)).status, 400);
});

test('فایل‌های سایت سرو می‌شوند و دسترسی به بیرون پوشه public ممکن نیست', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/admin/')).status, 200);
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/server/app.js', '/uploads/..%2f..%2fshop.db', '/..%5cserver%5capp.js']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  const big = await fetch(base + '/api/coupons/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(2 * 1024 * 1024) }) });
  assert.equal(big.status, 413);
});

test('روی آدرس عمومی بدون production، امکانات آزمایشی خاموش است', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'development', PUBLIC_URL: 'https://shop.example.ir', ADMIN_PASSWORD: '', APP_SECRET: 'x' }), /ADMIN_PASSWORD/);
  const c = loadConfig({ NODE_ENV: 'development', PUBLIC_URL: 'https://shop.example.ir', ADMIN_PASSWORD: 'a-long-password', APP_SECRET: 'x' });
  assert.equal(c.devMode, false);
  const { createPayment } = require('../server/payment');
  assert.equal(createPayment(Object.assign({}, c, { zarinpal: { merchantId: '', sandbox: false } })).mode, 'off');
  assert.equal(loadConfig({ NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:3000', ADMIN_PASSWORD: '', APP_SECRET: '' }).devMode, true);
});
