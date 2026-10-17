'use strict';
/* نقطه شروع سرور: node server/index.js */
const { loadConfig } = require('./config');
const { createApp } = require('./app');

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  console.error('خطا در تنظیمات: ' + e.message);
  process.exit(1);
}

const app = createApp(cfg);
app.server.listen(cfg.port, cfg.host, () => {
  console.log('فروشگاه روی ' + cfg.publicUrl + ' اجرا شد (' + (cfg.isProd ? 'production' : cfg.devMode ? 'development' : 'development روی آدرس عمومی؛ امکانات آزمایشی خاموش است') + ')');
  console.log('پنل مدیریت: ' + cfg.publicUrl + '/admin/');
  if (cfg.devAdminPassword) console.log('رمز پیش‌فرض پنل مدیریت در حالت توسعه: admin1234  (در production حتماً ADMIN_PASSWORD را تنظیم کنید)');
  console.log('درگاه پرداخت: ' + { live: 'زرین‌پال (واقعی)', sandbox: 'زرین‌پال (آزمایشی)', fake: 'شبیه‌ساز داخلی', off: 'غیرفعال (فقط پرداخت در محل)' }[app.pay.mode]);
  console.log('پیامک: ' + (app.sms.enabled ? 'کاوه‌نگار' : 'غیرفعال؛ کد ورود در همین کنسول چاپ می‌شود'));
});

function shutdown() { app.close().then(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
