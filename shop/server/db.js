'use strict';
/* پایگاه داده SQLite داخلی Node.js (node:sqlite) — بدون نیاز به نصب پکیج */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', hue INTEGER NOT NULL DEFAULT 20,
  subs TEXT NOT NULL DEFAULT '[]', sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, cat TEXT NOT NULL REFERENCES categories(id),
  brand TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, off INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 0, reviews INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
  emoji TEXT NOT NULL DEFAULT '📦', sold INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  colors TEXT NOT NULL DEFAULT '[]', specs TEXT NOT NULL DEFAULT '{}', img TEXT, description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otps (phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_sent INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, is_admin INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL, pay_method TEXT NOT NULL, ship_method TEXT NOT NULL, items TEXT NOT NULL,
  list_total INTEGER NOT NULL, payable INTEGER NOT NULL, coupon TEXT, coupon_disc INTEGER NOT NULL DEFAULT 0,
  ship_cost INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, address TEXT NOT NULL,
  authority TEXT, ref_id TEXT, created_at INTEGER NOT NULL, paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_authority ON orders(authority);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, name TEXT NOT NULL, rate INTEGER NOT NULL, text TEXT NOT NULL,
  buyer INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_product ON reviews(product_id);
CREATE TABLE IF NOT EXISTS coupons (code TEXT PRIMARY KEY, pct INTEGER NOT NULL, cap INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0);
`;

/** داده‌های نمونه را از همان فایل data.js سایت می‌خواند تا فقط یک منبع داشته باشیم */
function loadSeed(publicDir) {
  const code = fs.readFileSync(path.join(publicDir, 'js', 'data.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { timeout: 1000 });
  return sandbox.window.SHOP;
}

function seed(db, publicDir) {
  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n > 0) return;
  const S = loadSeed(publicDir);
  const now = Date.now();
  transaction(db, () => {
    const cat = db.prepare('INSERT INTO categories (id, name, icon, hue, subs, sort) VALUES (?, ?, ?, ?, ?, ?)');
    S.categories.forEach((c, i) => cat.run(c.id, c.name, c.icon, c.hue, JSON.stringify(c.subs), i));
    const prod = db.prepare(`INSERT INTO products (id, title, cat, brand, price, off, rating, reviews, stock, emoji, sold, created_at, colors, specs, img)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of S.products) {
      prod.run(p.id, p.title, p.cat, p.brand, p.price, p.off, p.rating, p.reviews, p.stock, p.emoji, p.sold,
        now - p.age * 86400000, JSON.stringify(p.colors), JSON.stringify(p.specs), p.img || null);
    }
    const rev = db.prepare('INSERT INTO reviews (product_id, name, rate, text, buyer, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [pid, list] of Object.entries(S.reviews)) {
      list.forEach((r, i) => rev.run(Number(pid), r.name, r.rate, r.text, r.buy ? 1 : 0, now - (i + 1) * 86400000 * 5));
    }
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(S.settings)) set.run(k, JSON.stringify(v));
    const cp = db.prepare('INSERT INTO coupons (code, pct, cap) VALUES (?, ?, ?)');
    for (const [code, c] of Object.entries(S.coupons)) cp.run(code, c.pct, c.cap);
  });
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function openDb(cfg) {
  fs.mkdirSync(path.join(cfg.dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(cfg.dataDir, 'shop.db'));
  db.exec(SCHEMA);
  seed(db, cfg.publicDir);
  return db;
}

module.exports = { openDb, transaction, loadSeed };
