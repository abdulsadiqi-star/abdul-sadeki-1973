#!/usr/bin/env node
/**
 * Create `.env` from `.env.example` with freshly generated secrets.
 *
 *   pnpm setup:env            # refuses to overwrite an existing .env
 *   pnpm setup:env --force
 *
 * Generated: SESSION_SECRET, POSTGRES_PASSWORD, S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (the bundled object store
 * uses the same credentials as the app). DATABASE_URL and the S3 settings are rewritten to match, so
 * `docker compose up -d postgres redis objectstore` works immediately.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const force = process.argv.includes('--force');
if (fs.existsSync('.env') && !force) {
  console.error('.env already exists — use --force to overwrite.');
  process.exit(1);
}

const hex = (n) => randomBytes(n).toString('hex');
const secrets = {
  SESSION_SECRET: hex(32),
  POSTGRES_PASSWORD: hex(16),
  S3_ACCESS_KEY_ID: `tg${hex(4)}`,
  S3_SECRET_ACCESS_KEY: hex(16),
};

let env = fs.readFileSync('.env.example', 'utf8');
const set = (key, value) => {
  const line = new RegExp(`^#?\\s*${key}=.*$`, 'm');
  env = line.test(env) ? env.replace(line, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
};

set('SESSION_SECRET', secrets.SESSION_SECRET);
set('POSTGRES_PASSWORD', secrets.POSTGRES_PASSWORD);
set('DATABASE_URL', `postgresql://tamashagah:${secrets.POSTGRES_PASSWORD}@localhost:5432/tamashagah`);
set('DATABASE_URL_TEST', `postgresql://tamashagah:${secrets.POSTGRES_PASSWORD}@localhost:5432/tamashagah_test`);
set('S3_ENDPOINT', 'http://localhost:9000');
set('S3_BUCKET', 'tamashagah');
set('S3_ACCESS_KEY_ID', secrets.S3_ACCESS_KEY_ID);
set('S3_SECRET_ACCESS_KEY', secrets.S3_SECRET_ACCESS_KEY);
set('MAIL_TRANSPORT', 'smtp');
set('SMTP_HOST', 'localhost');
set('SMTP_PORT', '1025');

fs.writeFileSync('.env', env, { mode: 0o600 });
console.log('✔ .env created with generated secrets (git-ignored).');
console.log('  Next: docker compose up -d && pnpm db:deploy && pnpm db:seed && pnpm dev');
