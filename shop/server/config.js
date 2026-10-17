'use strict';
/* خواندن تنظیمات از متغیرهای محیطی و فایل .env (بدون نیاز به پکیج dotenv) */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function loadConfig(overrides) {
  const env = Object.assign({}, parseEnvFile(path.join(ROOT, '.env')), process.env, overrides || {});
  const isProd = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);

  const cfg = {
    root: ROOT,
    publicDir: path.join(ROOT, 'public'),
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
    port,
    host: env.HOST || '0.0.0.0',
    isProd,
    quiet: env.QUIET === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    publicUrl: (env.PUBLIC_URL || 'http://localhost:' + port).replace(/\/+$/, ''),
    adminPassword: env.ADMIN_PASSWORD || '',
    devAdminPassword: false,
    secret: env.APP_SECRET || '',
    zarinpal: { merchantId: env.ZARINPAL_MERCHANT_ID || '', sandbox: env.ZARINPAL_SANDBOX === 'true' },
    kavenegar: { apiKey: env.KAVENEGAR_API_KEY || '', template: env.KAVENEGAR_TEMPLATE || 'verify' }
  };

  // امکانات آزمایشی (رمز پیش‌فرض، درگاه شبیه‌ساز، نمایش کد ورود) فقط روی localhost و خارج از production فعال‌اند
  // تا اگر کسی NODE_ENV=production را فراموش کرد، سایت عمومی ناامن نشود.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(cfg.publicUrl);
  cfg.devMode = !isProd && local;

  if (!cfg.adminPassword) {
    if (!cfg.devMode) throw new Error('ADMIN_PASSWORD را در فایل .env تنظیم کنید (حداقل ۱۰ کاراکتر).');
    cfg.adminPassword = 'admin1234';
    cfg.devAdminPassword = true;
  } else if (!cfg.devMode && cfg.adminPassword.length < 10) {
    throw new Error('ADMIN_PASSWORD باید حداقل ۱۰ کاراکتر باشد.');
  }
  if (!cfg.secret) {
    if (!cfg.devMode) throw new Error('APP_SECRET را در فایل .env با یک رشته تصادفی طولانی تنظیم کنید.');
    cfg.secret = 'dev-secret-change-me';
  }
  return cfg;
}

module.exports = { loadConfig };
