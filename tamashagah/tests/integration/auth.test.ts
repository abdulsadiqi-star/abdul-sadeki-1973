import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUser, sessionCookieName } from '@/lib/auth/session';
import {
  changePasswordAction,
  checkHandleAction,
  createChannelAction,
  loginAction,
  logoutAction,
  logoutEverywhereAction,
  registerAction,
  requestPasswordResetAction,
  resendVerificationAction,
  resetPasswordAction,
  setDigitStyleAction,
  verifyEmailAction,
} from '@/features/auth/actions';
import { resetEnvCache } from '@/lib/env';
import { sha256Hex } from '@/lib/ids';
import { requestContext } from '../helpers/request-context';
import { lastTokenFor, readMailbox } from '../helpers/mailbox';
import { createUser } from '../helpers/factories';

const PASSWORD = 'Str0ng-Passw0rd!';
const register = (email = 'sara@example.test', extra: Record<string, unknown> = {}) =>
  registerAction({ displayName: 'سارا احمدی', email, password: PASSWORD, acceptTerms: true, ...extra });

async function signUpVerified(email = 'sara@example.test') {
  await register(email);
  await verifyEmailAction({ token: await lastTokenFor(email, 'verify-email') });
}

describe('registration', () => {
  it('creates an unverified user, a session cookie and a verification e-mail', async () => {
    const res = await register();
    expect(res.ok).toBe(true);

    const user = await db.user.findUniqueOrThrow({ where: { email: 'sara@example.test' } });
    expect(user.role).toBe('USER');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);

    const cookie = requestContext.cookie(sessionCookieName());
    expect(cookie).toBeTruthy();
    expect(requestContext.cookieOptions(sessionCookieName())).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });

    const me = await getCurrentUser();
    expect(me).toMatchObject({ email: 'sara@example.test', displayName: 'سارا احمدی', emailVerified: false, channel: null });

    const mails = await readMailbox();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toContain('تأیید ایمیل');
    expect(mails[0]!.html).toContain('dir="rtl"');
  });

  it('never stores the raw session token', async () => {
    await register();
    const token = requestContext.cookie(sessionCookieName())!;
    const rows = await db.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(sha256Hex(token));
    expect(rows[0]!.tokenHash).not.toBe(token);
  });

  it('normalizes the e-mail and rejects duplicates', async () => {
    await register('Sara@Example.TEST');
    expect((await db.user.findFirstOrThrow()).email).toBe('sara@example.test');
    const dup = await register('sara@example.test');
    expect(dup).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(dup.ok === false && dup.fieldErrors?.email?.[0]).toContain('قبلاً');
  });

  it.each([
    ['short', { password: 'a1' }],
    ['common', { password: 'password123' }],
    ['no digit', { password: 'onlyletters' }],
    ['bad e-mail', { email: 'not-an-email' }],
    ['terms not accepted', { acceptTerms: false }],
    ['name too short', { displayName: 'ا' }],
  ])('rejects invalid input: %s', async (_name, patch) => {
    const res = await register('x@example.test', patch);
    expect(res).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await db.user.count()).toBe(0);
  });

  it('rate limits registrations per client IP (behind a trusted proxy)', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    resetEnvCache();
    try {
      requestContext.headers.set('x-forwarded-for', '203.0.113.9');
      for (let i = 0; i < 5; i++) expect((await register(`u${i}@example.test`)).ok).toBe(true);
      expect(await register('u99@example.test')).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
      // a different client is unaffected
      requestContext.headers.set('x-forwarded-for', '203.0.113.10');
      expect((await register('other@example.test')).ok).toBe(true);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
      resetEnvCache();
    }
  });

  it('does not lump unknown clients into one strict bucket', async () => {
    for (let i = 0; i < 12; i++) expect((await register(`anon${i}@example.test`)).ok).toBe(true);
  });
});

describe('login and sessions', () => {
  it('logs in with the right password and reports a generic error otherwise', async () => {
    await signUpVerified();
    await logoutAction();
    expect(await getCurrentUser()).toBeNull();

    const wrong = await loginAction({ email: 'sara@example.test', password: 'wrong-password-1' });
    const unknown = await loginAction({ email: 'nobody@example.test', password: 'wrong-password-1' });
    expect(wrong).toMatchObject({ ok: false, code: 'VALIDATION', message: 'ایمیل یا گذرواژه نادرست است.' });
    expect(unknown).toEqual(wrong); // no account enumeration

    const ok = await loginAction({ email: ' SARA@example.test ', password: PASSWORD });
    expect(ok.ok).toBe(true);
    expect((await getCurrentUser())?.emailVerified).toBe(true);
  });

  it('refuses suspended accounts', async () => {
    await signUpVerified();
    await logoutAction();
    await db.user.update({ where: { email: 'sara@example.test' }, data: { status: 'SUSPENDED' } });
    expect(await loginAction({ email: 'sara@example.test', password: PASSWORD })).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(await getCurrentUser()).toBeNull();
  });

  it('ends a suspended user\'s existing session immediately', async () => {
    await signUpVerified();
    expect(await getCurrentUser()).not.toBeNull();
    await db.user.update({ where: { email: 'sara@example.test' }, data: { status: 'SUSPENDED' } });
    expect(await getCurrentUser()).toBeNull();
  });

  it('logout deletes the server-side session', async () => {
    await register();
    expect(await db.session.count()).toBe(1);
    await logoutAction();
    expect(await db.session.count()).toBe(0);
    expect(requestContext.cookie(sessionCookieName())).toBeUndefined();
  });

  it('rejects expired and revoked sessions', async () => {
    await register();
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCurrentUser()).toBeNull();
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() + 86_400_000), revokedAt: new Date() } });
    expect(await getCurrentUser()).toBeNull();
  });

  it('rejects forged or malformed cookies', async () => {
    requestContext.cookiesApi().set(sessionCookieName(), 'x'.repeat(43));
    expect(await getCurrentUser()).toBeNull();
    requestContext.cookiesApi().set(sessionCookieName(), 'short');
    expect(await getCurrentUser()).toBeNull();
  });

  it('throttles repeated failed logins per account', async () => {
    await signUpVerified();
    await logoutAction();
    let last;
    for (let i = 0; i < 9; i++) last = await loginAction({ email: 'sara@example.test', password: `wrong-pass-${i}1` });
    expect(last).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    // even the right password is refused while throttled
    expect(await loginAction({ email: 'sara@example.test', password: PASSWORD })).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('"log out everywhere" revokes every session of the user', async () => {
    await signUpVerified();
    const other = await db.session.create({
      data: { userId: (await db.user.findFirstOrThrow()).id, tokenHash: 'other-device', expiresAt: new Date(Date.now() + 1e9) },
    });
    expect(other.id).toBeTruthy();
    await logoutEverywhereAction();
    expect(await db.session.count()).toBe(0);
  });
});

describe('e-mail verification', () => {
  it('verifies once and burns the token', async () => {
    await register();
    const token = await lastTokenFor('sara@example.test', 'verify-email');
    expect(await verifyEmailAction({ token })).toMatchObject({ ok: true });
    expect((await getCurrentUser())?.emailVerified).toBe(true);
    expect(await verifyEmailAction({ token })).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });

  it('stores only a hash of the token and rejects expired or foreign tokens', async () => {
    await register();
    const token = await lastTokenFor('sara@example.test', 'verify-email');
    const row = await db.emailToken.findFirstOrThrow();
    expect(row.tokenHash).toBe(sha256Hex(token));
    await db.emailToken.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyEmailAction({ token })).toMatchObject({ ok: false });
    expect(await verifyEmailAction({ token: 'A'.repeat(43) })).toMatchObject({ ok: false });
    // a reset token cannot verify an e-mail
    await requestPasswordResetAction({ email: 'sara@example.test' });
    const resetToken = await lastTokenFor('sara@example.test', 'reset-password');
    expect(await verifyEmailAction({ token: resetToken })).toMatchObject({ ok: false });
  });

  it('re-sends a verification mail (rate limited) and invalidates the older link', async () => {
    await register();
    const first = await lastTokenFor('sara@example.test', 'verify-email');
    expect((await resendVerificationAction()).ok).toBe(true);
    const second = await lastTokenFor('sara@example.test', 'verify-email', { minCount: 2 });
    expect(second).not.toBe(first);
    expect(await verifyEmailAction({ token: first })).toMatchObject({ ok: false });
    expect(await verifyEmailAction({ token: second })).toMatchObject({ ok: true });
  });
});

describe('password reset', () => {
  it('does not reveal whether an account exists', async () => {
    const a = await requestPasswordResetAction({ email: 'ghost@example.test' });
    expect(a.ok).toBe(true);
    expect(await readMailbox()).toHaveLength(0);
  });

  it('resets the password, revokes sessions and verifies the address', async () => {
    await register();
    await logoutAction();
    await requestPasswordResetAction({ email: 'sara@example.test' });
    const token = await lastTokenFor('sara@example.test', 'reset-password');

    const weak = await resetPasswordAction({ token, password: '123' });
    expect(weak).toMatchObject({ ok: false, code: 'VALIDATION' });

    const res = await resetPasswordAction({ token, password: 'Brand-New-Pass9' });
    expect(res.ok).toBe(true);
    expect(await db.session.count()).toBe(0);
    expect((await db.user.findFirstOrThrow()).emailVerifiedAt).not.toBeNull();

    expect(await loginAction({ email: 'sara@example.test', password: PASSWORD })).toMatchObject({ ok: false });
    expect(await loginAction({ email: 'sara@example.test', password: 'Brand-New-Pass9' })).toMatchObject({ ok: true });
    // single use
    expect(await resetPasswordAction({ token, password: 'Another-Pass-77' })).toMatchObject({ ok: false });
  });

  it('changing the password keeps the current session but drops the others', async () => {
    await signUpVerified();
    const user = await db.user.findFirstOrThrow();
    await db.session.create({ data: { userId: user.id, tokenHash: 'other-device', expiresAt: new Date(Date.now() + 1e9) } });
    expect(await changePasswordAction({ currentPassword: 'wrong-Current-1', newPassword: 'Newer-Pass-12' })).toMatchObject({ ok: false });
    expect(await changePasswordAction({ currentPassword: PASSWORD, newPassword: 'Newer-Pass-12' })).toMatchObject({ ok: true });
    expect(await db.session.count()).toBe(1);
    expect(await getCurrentUser()).not.toBeNull();
  });
});

describe('channels and roles', () => {
  const channel = { name: 'آشپزی با سارا', handle: 'sara-cooks', description: 'دستور پخت' };

  it('requires authentication and a verified e-mail', async () => {
    expect(await createChannelAction(channel)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    await register();
    expect(await createChannelAction(channel)).toMatchObject({ ok: false, code: 'EMAIL_NOT_VERIFIED' });
  });

  it('creates the channel and promotes the user to CREATOR', async () => {
    await signUpVerified();
    expect(await createChannelAction(channel)).toMatchObject({ ok: true, data: { handle: 'sara-cooks' } });
    const user = await db.user.findFirstOrThrow({ include: { channel: true } });
    expect(user.role).toBe('CREATOR');
    expect(user.channel).toMatchObject({ handle: 'sara-cooks', name: 'آشپزی با سارا', isVerified: false });
    expect(user.channel!.searchName).toContain('sara cooks');
    expect((await getCurrentUser())?.channel?.handle).toBe('sara-cooks');
  });

  it('allows one channel per user and unique handles', async () => {
    await signUpVerified();
    await createChannelAction(channel);
    expect(await createChannelAction({ ...channel, handle: 'another' })).toMatchObject({ ok: false, code: 'CONFLICT' });

    await logoutAction();
    await signUpVerified('nika@example.test');
    const clash = await createChannelAction({ ...channel, handle: 'SARA-cooks' });
    expect(clash).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await checkHandleAction('sara-cooks')).toMatchObject({ ok: true, data: { available: false } });
    expect(await checkHandleAction('free-handle')).toMatchObject({ ok: true, data: { available: true } });
  });

  it.each(['ab', 'Admin', 'studio', 'سارا', 'a--b', '-bad', 'has space'])('rejects the handle %j', async (handle) => {
    await signUpVerified();
    expect(await createChannelAction({ ...channel, handle })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('keeps moderator/admin roles when they create a channel', async () => {
    const mod = await createUser({ role: 'MODERATOR', email: 'mod@example.test' });
    expect(mod.role).toBe('MODERATOR');
    await db.user.update({ where: { id: mod.id }, data: { passwordHash: (await db.user.findFirstOrThrow()).passwordHash } });
    // log in as the moderator via a real session
    requestContext.cookiesApi().set(sessionCookieName(), 'x');
    const { startSession } = await import('@/lib/auth/session');
    await startSession(mod.id);
    expect(await createChannelAction({ ...channel, handle: 'mod-channel' })).toMatchObject({ ok: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: mod.id } })).role).toBe('MODERATOR');
  });
});

describe('numeral preference', () => {
  it('stores the preference for logged-in users and sets the cookie', async () => {
    await register();
    expect((await setDigitStyleAction({ digitStyle: 'EN' })).ok).toBe(true);
    expect((await db.user.findFirstOrThrow()).digitStyle).toBe('EN');
    expect(requestContext.cookie('tg_digits')).toBe('en');
    expect(await setDigitStyleAction({ digitStyle: 'XX' })).toMatchObject({ ok: false });
  });
});
