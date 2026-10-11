#!/usr/bin/env node
/**
 * Static security audit (fast, dependency-free). Run: `pnpm audit:security`  (exit code 1 on findings)
 *
 * Checks
 *  1. Every exported Server Action (files with 'use server') calls an auth guard, or is on the PUBLIC allow-list.
 *  2. Every Route Handler method is wrapped by `apiHandler` (CSRF/Origin + error envelope) or is on the allow-list,
 *     and non-public handlers call an auth guard.
 *  3. Dangerous constructs: dangerouslySetInnerHTML, eval/new Function, $queryRawUnsafe/$executeRawUnsafe (outside tests),
 *     child_process outside worker/scripts, direct process.env reads outside lib/env.ts (and a few bootstrap files).
 *  4. Raw SQL built with string concatenation / template interpolation that is not Prisma.sql.
 *  5. Secrets accidentally committed (private keys, obvious tokens) and .env files tracked by git.
 *
 * Extend the allow-lists below deliberately — each entry is a conscious "this is public on purpose" decision.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const SRC = path.join(root, 'src');

const GUARDS = /\b(requireUser|requireVerifiedUser|requireChannelUser|requireRole|requirePageUser|requirePageChannelUser|requirePageRole|getCurrentUser|requireStaff|requireModerator|requireAdmin|assertStaff|authorize\w*)\s*\(/;

/** Server Actions that are intentionally callable without a session (authentication/recovery flows, public forms). */
const PUBLIC_ACTIONS = new Set([
  'registerAction', 'loginAction', 'logoutAction', 'verifyEmailAction', 'requestPasswordResetAction', 'resetPasswordAction',
  'setDigitStyleAction', // visitors may choose numerals (cookie only)
]);

/** Route handlers that are public on purpose (path fragment → reason). */
const PUBLIC_ROUTES = [
  ['api/health', 'liveness/readiness probe'],
  ['media/', 'public media delivery; visibility enforced inside'],
  ['api/search', 'public search/suggestions (rate-limited)'],
  ['api/videos', 'view/heartbeat tracking for anonymous viewers (validated + rate-limited inside)'],
  ['api/upload', 'tus protocol endpoint; auth enforced in tus hooks'],
  ['sitemap', 'SEO'],
  ['robots', 'SEO'],
  ['manifest', 'PWA'],
];

const findings = [];
const add = (severity, file, line, msg) => findings.push({ severity, file: path.relative(root, file), line, msg });

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'generated'].includes(entry.name)) continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) yield full;
  }
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Split a file into exported async function bodies (good enough for our conventions). */
function exportedFunctions(text) {
  const out = [];
  const re = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    // body = until the next top-level "export " or EOF
    const start = m.index;
    const next = text.indexOf('\nexport ', start + 1);
    out.push({ name: m[1], index: start, body: text.slice(start, next === -1 ? text.length : next) });
  }
  return out;
}

for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);

  // 1. Server Actions ---------------------------------------------------------------------------
  if (/^\s*['"]use server['"]/m.test(text.slice(0, 400))) {
    for (const fn of exportedFunctions(text)) {
      if (PUBLIC_ACTIONS.has(fn.name)) continue;
      if (!GUARDS.test(fn.body) && !/\bviewer\(\)|\bactor\(\)|\bctx\(\)/.test(fn.body)) {
        add('HIGH', file, lineOf(text, fn.index), `Server Action ${fn.name}() has no auth guard (add requireUser()/requireRole()… or allow-list it deliberately)`);
      }
      if (!/\brunAction\s*\(/.test(fn.body)) {
        add('MEDIUM', file, lineOf(text, fn.index), `Server Action ${fn.name}() does not use runAction() (uncaught errors may leak)`);
      }
    }
  }

  // 2. Route handlers --------------------------------------------------------------------------
  if (/\/route\.ts$/.test(rel)) {
    const publicReason = PUBLIC_ROUTES.find(([frag]) => rel.includes(frag))?.[1];
    const methods = [...text.matchAll(/export\s+(?:const|async function|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)];
    for (const m of methods) {
      const method = m[1];
      const rest = text.slice(m.index, m.index + 400);
      const wrapped = /apiHandler\s*[<(]/.test(rest);
      if (!wrapped && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !publicReason) {
        add('HIGH', file, lineOf(text, m.index), `${method} handler is not wrapped by apiHandler() (no Origin/CSRF check)`);
      }
      if (!publicReason && !GUARDS.test(text)) {
        add('HIGH', file, lineOf(text, m.index), `${method} handler has no auth guard and is not on the PUBLIC_ROUTES allow-list`);
      }
    }
  }

  // 3. Dangerous constructs --------------------------------------------------------------------
  const isTest = /(^|\/)tests?\//.test(rel);
  for (const [re, sev, msg, allow] of [
    [/dangerouslySetInnerHTML/g, 'HIGH', 'dangerouslySetInnerHTML (XSS risk) — must be sanitized/serialized JSON-LD only', /JSON\.stringify/],
    // Bare `eval(` only — member calls such as `redis.eval(` are the Redis EVAL command, not JavaScript eval.
    [/(?<![.\w$])eval\s*\(|new\s+Function\s*\(/g, 'HIGH', 'eval / new Function'],
    [/\$(queryRawUnsafe|executeRawUnsafe)\b/g, isTest ? null : 'HIGH', 'Unsafe raw SQL API outside tests'],
    [/from\s+['"](node:)?child_process['"]/g, /^(worker|scripts|tests|prisma)\//.test(rel) ? null : 'HIGH', 'child_process outside worker/scripts'],
  ]) {
    if (!sev) continue;
    for (const m of text.matchAll(re)) {
      const window = text.slice(Math.max(0, m.index - 200), m.index + 300);
      if (allow && allow.test(window)) continue;
      add(sev, file, lineOf(text, m.index), msg);
    }
  }
  if (!/^src\/lib\/(env|logger)\.ts$/.test(rel) && !/^src\/(app\/layout|proxy|\.\.\.)/.test(rel) && !isTest && !/^src\/config\//.test(rel)) {
    for (const m of text.matchAll(/process\.env\.([A-Z_]+)/g)) {
      if (/NEXT_PHASE|NODE_ENV|NEXT_RUNTIME|SERVICE_NAME|NEXT_PUBLIC_/.test(m[1])) continue;
      add('LOW', file, lineOf(text, m.index), `direct process.env.${m[1]} read — use env from @/lib/env`);
    }
  }

  // 4. Raw SQL via interpolation ----------------------------------------------------------------
  for (const m of text.matchAll(/\$queryRaw\s*\(\s*[`'"]|\$executeRaw\s*\(\s*[`'"]/g)) {
    add('HIGH', file, lineOf(text, m.index), 'Raw SQL passed as a plain string — use the tagged template ($queryRaw`...`) or Prisma.sql');
  }
  for (const m of text.matchAll(/Prisma\.raw\(|sql\.raw\(/g)) {
    add('MEDIUM', file, lineOf(text, m.index), 'Prisma.raw()/sql.raw() — verify the argument is a constant, never user input');
  }
}

// 5. Secrets / tracked env files ----------------------------------------------------------------
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
  for (const f of tracked) {
    if (/(^|\/)\.env(\.|$)/.test(f) && !/\.env\.example$/.test(f)) add('HIGH', path.join(root, f), 0, '.env file is tracked by git');
    if (/\.(pem|key|p12)$/.test(f)) add('HIGH', path.join(root, f), 0, 'key material tracked by git');
  }
  for (const f of tracked.filter((x) => /\.(ts|tsx|mjs|json|ya?ml|md|sh)$/.test(x) && !/pnpm-lock/.test(x))) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8');
    for (const re of [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /xox[baprs]-[0-9A-Za-z-]{10,}/, /ghp_[0-9A-Za-z]{30,}/]) {
      if (re.test(t)) add('HIGH', p, 0, `possible secret matching ${re}`);
    }
  }
} catch {
  /* not a git checkout */
}

const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file));
for (const f of findings) console.log(`${f.severity.padEnd(6)} ${f.file}${f.line ? `:${f.line}` : ''}  ${f.msg}`);
const high = findings.filter((f) => f.severity === 'HIGH').length;
console.log(`\n${findings.length} finding(s): ${high} high, ${findings.filter((f) => f.severity === 'MEDIUM').length} medium, ${findings.filter((f) => f.severity === 'LOW').length} low`);
process.exit(high > 0 ? 1 : 0);
