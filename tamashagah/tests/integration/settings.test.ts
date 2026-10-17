import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUser, startSession } from '@/lib/auth/session';
import { getStorage } from '@/lib/storage';
import { logoutEverywhereAction } from '@/features/auth/actions';
import { revokeSessionAction, saveAccountSettingsAction, updateChannelAction } from '@/features/settings/actions';
import { isOwnedImageKey } from '@/features/settings/images';
import { getAccountSettings, getChannelSettings, listActiveSessions } from '@/features/settings/queries';
import { DELETE as deleteAccountAvatar, POST as postAccountAvatar } from '@/app/api/studio/account/avatar/route';
import { DELETE as deleteChannelAvatar, POST as postChannelAvatar } from '@/app/api/studio/channel/avatar/route';
import { DELETE as deleteChannelBanner, POST as postChannelBanner } from '@/app/api/studio/channel/banner/route';
import { createUser } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { requestContext } from '../helpers/request-context';

const ORIGIN = 'http://localhost:3000';

// The global setup resets the database per test, but not the storage directory: start every test with an empty bucket.
beforeEach(async () => {
  await fs.rm(process.env.STORAGE_FS_ROOT!, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const png = (width = 800, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: '#7c3aed' } }).png().toBuffer();

function multipart(path: string, file: Buffer | null, opts: { name?: string; type?: string; origin?: string | null; method?: string } = {}): NextRequest {
  const headers: Record<string, string> = { host: 'localhost:3000' };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.method === 'DELETE') return new NextRequest(`${ORIGIN}${path}`, { method: 'DELETE', headers });
  const form = new FormData();
  if (file) form.set('file', new File([new Uint8Array(file)], opts.name ?? 'upload.png', { type: opts.type ?? 'image/png' }));
  return new NextRequest(`${ORIGIN}${path}`, { method: 'POST', body: form, headers });
}

type Handler = (req: NextRequest) => Promise<Response>;
const call = async (handler: Handler, req: NextRequest) => {
  const res = await handler(req);
  const body = res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
  return { status: res.status, body };
};
const errorCode = (r: { body: Record<string, unknown> | null }) => (r.body?.error as { code?: string } | undefined)?.code;

const AVATAR = '/api/studio/account/avatar';
const CH_AVATAR = '/api/studio/channel/avatar';
const CH_BANNER = '/api/studio/channel/banner';

const keyOfUrl = (url: string) => decodeURIComponent(url.replace(/^\/media\//, ''));
async function stored(key: string) {
  const got = await getStorage().get(key);
  if (!got) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of got.stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Pretend to be another browser of the same user (a second device). */
function asDevice(token: string) {
  requestContext.reset();
  requestContext.jar.set('tg_session', { value: token, options: {} });
}

async function twoDevices(userId: string) {
  await loginAs(userId);
  const a = requestContext.cookie('tg_session')!;
  requestContext.reset();
  requestContext.headers.set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  await startSession(userId);
  const b = requestContext.cookie('tg_session')!;
  return { a, b };
}

// ---------------------------------------------------------------------------
// account + channel settings
// ---------------------------------------------------------------------------

describe('account settings', () => {
  it('saves display name, numeral style and e-mail preference, and mirrors the numerals in the cookie', async () => {
    const user = await createUser({ displayName: 'نام قدیمی' });
    await loginAs(user.id);
    const result = await saveAccountSettingsAction({ displayName: '  سارا   احمدی ', digitStyle: 'EN', notifyByEmail: false });
    expect(result.ok).toBe(true);
    expect(await getAccountSettings(user.id)).toMatchObject({ displayName: 'سارا احمدی', digitStyle: 'EN', notifyByEmail: false, emailVerified: true });
    expect(requestContext.cookie('tg_digits')).toBe('en');
    // the header sees it immediately (it reads the user row)
    expect((await getCurrentUser())!.displayName).toBe('سارا احمدی');
  });

  it('rejects anonymous callers and invalid input, and cannot be abused to change role or e-mail', async () => {
    const user = await createUser({ displayName: 'اولیه' });
    logout();
    expect(await saveAccountSettingsAction({ displayName: 'نام', digitStyle: 'FA', notifyByEmail: true })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });

    await loginAs(user.id);
    const bad = await saveAccountSettingsAction({ displayName: 'ا', digitStyle: 'FA', notifyByEmail: true });
    expect(bad).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(bad.ok === false && bad.fieldErrors?.displayName?.[0]).toBeTruthy();

    // extra keys are dropped by the schema: nothing but the three fields can be written
    const result = await saveAccountSettingsAction({ displayName: 'نام تازه', digitStyle: 'FA', notifyByEmail: true, role: 'ADMIN', email: 'x@evil.test', id: 'someone-else' });
    expect(result.ok).toBe(true);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ displayName: 'نام تازه', role: 'USER', email: user.email });
  });
});

describe('channel settings', () => {
  const valid = {
    name: 'کانال تازه',
    description: 'توضیحات تازه',
    links: [{ title: 'سایت', url: 'https://example.com' }],
    commentsMode: 'APPROVAL_REQUIRED',
    defaultVisibility: 'UNLISTED',
  };

  it('updates the channel and keeps the search index in sync, but never the handle', async () => {
    const owner = await createUser({ withChannel: true, handle: 'my-handle' });
    await loginAs(owner.id);
    const result = await updateChannelAction({ ...valid, name: 'كانال  تازه', handle: 'hacked-handle' });
    expect(result.ok).toBe(true);
    const channel = await db.channel.findUniqueOrThrow({ where: { id: owner.channel!.id } });
    expect(channel).toMatchObject({
      name: 'کانال تازه', // Arabic kaf folded, spaces collapsed
      description: 'توضیحات تازه',
      commentsMode: 'APPROVAL_REQUIRED',
      defaultVisibility: 'UNLISTED',
      handle: 'my-handle',
      searchName: 'کانال تازه my handle', // normalized name + handle, as the search expects
    });
    expect(channel.links).toEqual([{ title: 'سایت', url: 'https://example.com/' }]);
    expect(await getChannelSettings(channel.id)).toMatchObject({ name: 'کانال تازه', links: [{ title: 'سایت', url: 'https://example.com/' }] });
    // visible immediately in the header/menu: the session reads the channel row
    expect((await getCurrentUser())!.channel).toMatchObject({ name: 'کانال تازه', commentsMode: 'APPROVAL_REQUIRED', defaultVisibility: 'UNLISTED' });
  });

  it('validates links (https only, at most five) and field lengths', async () => {
    const owner = await createUser({ withChannel: true });
    await loginAs(owner.id);
    const bad = await updateChannelAction({ ...valid, links: [{ title: 'x', url: 'http://example.com' }] });
    expect(bad).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await updateChannelAction({ ...valid, links: Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, url: `https://e${i}.com` })) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await updateChannelAction({ ...valid, name: 'ا' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await updateChannelAction({ ...valid, description: 'ا'.repeat(1001) })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await updateChannelAction({ ...valid, commentsMode: 'EVERYONE' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    // nothing was written
    expect((await db.channel.findUniqueOrThrow({ where: { id: owner.channel!.id } })).name).toBe(owner.channel!.name);
  });

  it('requires a signed-in user WITH a channel, and only ever edits the caller\'s own channel', async () => {
    const withoutChannel = await createUser();
    const a = await createUser({ withChannel: true, handle: 'chan-a' });
    const b = await createUser({ withChannel: true, handle: 'chan-b' });

    logout();
    expect(await updateChannelAction(valid)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    await loginAs(withoutChannel.id);
    expect(await updateChannelAction(valid)).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    // channelId / ownerId in the payload are ignored: A can only change A
    await loginAs(a.id);
    expect((await updateChannelAction({ ...valid, name: 'تغییر توسط الف', channelId: b.channel!.id, id: b.channel!.id, ownerId: b.id })).ok).toBe(true);
    expect((await db.channel.findUniqueOrThrow({ where: { id: a.channel!.id } })).name).toBe('تغییر توسط الف');
    expect((await db.channel.findUniqueOrThrow({ where: { id: b.channel!.id } })).name).toBe(b.channel!.name);
  });
});

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

describe('active sessions', () => {
  it('lists real sessions with a readable device label and marks the current one', async () => {
    const user = await createUser();
    const { a, b } = await twoDevices(user.id);
    asDevice(b);
    const current = (await getCurrentUser())!;
    const sessions = await listActiveSessions(user.id, current.sessionId);
    expect(sessions).toHaveLength(2);
    const [mine, other] = [sessions.find((s) => s.current)!, sessions.find((s) => !s.current)!];
    expect(mine.label).toBe('Safari روی آیفون');
    expect(mine.kind).toBe('MOBILE');
    expect(other.label).toBe('دستگاه ناشناس'); // user-agent "vitest"
    expect(a).not.toBe(b);
  });

  it('hides expired, revoked and over-age sessions (exactly what getCurrentUser() would refuse)', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const current = (await getCurrentUser())!;
    const make = (data: { expiresAt?: Date; revokedAt?: Date; createdAt?: Date }) =>
      db.session.create({ data: { userId: user.id, tokenHash: randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 86_400_000), ...data } });
    await make({ expiresAt: new Date(Date.now() - 1000) });
    await make({ revokedAt: new Date() });
    await make({ createdAt: new Date(Date.now() - 400 * 86_400_000) }); // beyond SESSION_ABSOLUTE_TTL_DAYS
    const keep = await make({});
    const ids = (await listActiveSessions(user.id, current.sessionId)).map((s) => s.id);
    expect(ids.sort()).toEqual([current.sessionId, keep.id].sort());
  });

  it('revokes another device for real: its cookie stops working, this one keeps working', async () => {
    const user = await createUser();
    const { a, b } = await twoDevices(user.id);
    asDevice(a);
    const other = await db.session.findFirstOrThrow({ where: { userId: user.id, tokenHash: { not: (await db.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })).tokenHash } } });
    expect((await getCurrentUser())!.sessionId).not.toBe(other.id);

    expect(await revokeSessionAction({ sessionId: other.id })).toEqual({ ok: true, data: undefined });

    asDevice(b);
    expect(await getCurrentUser()).toBeNull(); // the revoked device is logged out
    asDevice(a);
    expect(await getCurrentUser()).not.toBeNull(); // this one is untouched
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('cannot revoke the current session, someone else\'s session or an unknown one', async () => {
    const user = await createUser();
    const stranger = await createUser();
    await loginAs(stranger.id);
    const strangerSession = (await getCurrentUser())!.sessionId;

    await loginAs(user.id);
    const mine = (await getCurrentUser())!.sessionId;
    expect(await revokeSessionAction({ sessionId: mine })).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(await revokeSessionAction({ sessionId: strangerSession })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await revokeSessionAction({ sessionId: 'doesNotExist123456' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await revokeSessionAction({ sessionId: strangerSession, userId: stranger.id })).toMatchObject({ ok: false, code: 'VALIDATION' });
    // the stranger's session is still alive
    expect(await db.session.count({ where: { id: strangerSession } })).toBe(1);

    logout();
    expect(await revokeSessionAction({ sessionId: mine })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('"log out everywhere" ends every device', async () => {
    const user = await createUser();
    const { a, b } = await twoDevices(user.id);
    asDevice(a);
    expect((await logoutEverywhereAction()).ok).toBe(true);
    asDevice(a);
    expect(await getCurrentUser()).toBeNull();
    asDevice(b);
    expect(await getCurrentUser()).toBeNull();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// image uploads (real Route Handlers, real sharp, real storage driver)
// ---------------------------------------------------------------------------

describe('avatar upload (account)', () => {
  it('stores a clean 400×400 webp, points the user at it and shows it immediately', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const res = await call(postAccountAvatar, multipart(AVATAR, await png(1200, 700)));
    expect(res.status).toBe(200);
    const url = res.body!.url as string;
    const key = keyOfUrl(url);
    expect(key).toMatch(new RegExp(`^images/avatars/${user.id}/[A-Za-z0-9_-]+\\.webp$`));
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).avatarKey).toBe(key);
    expect((await getCurrentUser())!.avatarUrl).toBe(url); // header/menu

    const meta = await sharp((await stored(key))!).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 400, height: 400 });
  });

  it('strips EXIF/GPS metadata and drops payloads appended to a JPEG (polyglot)', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const marker = '<script>alert("pwned")</script><?php system($_GET["c"]); ?>';
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#10b981' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'SECRET-COPYRIGHT-MARKER' } })
      .toBuffer();
    const polyglot = Buffer.concat([jpeg, Buffer.from(marker)]);
    expect(polyglot.includes(Buffer.from(marker))).toBe(true);

    const res = await call(postAccountAvatar, multipart(AVATAR, polyglot, { name: 'photo.jpg', type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const out = (await stored(keyOfUrl(res.body!.url as string)))!;
    expect(out.includes(Buffer.from('<script>'))).toBe(false);
    expect(out.includes(Buffer.from('<?php'))).toBe(false);
    expect(out.includes(Buffer.from('SECRET-COPYRIGHT-MARKER'))).toBe(false);
    expect((await sharp(out).metadata()).exif).toBeUndefined();
  });

  it('replaces the image and deletes the old file; DELETE removes it entirely', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const first = keyOfUrl((await call(postAccountAvatar, multipart(AVATAR, await png()))).body!.url as string);
    expect(await getStorage().head(first)).not.toBeNull();

    const second = keyOfUrl((await call(postAccountAvatar, multipart(AVATAR, await png(500, 500)))).body!.url as string);
    expect(second).not.toBe(first);
    expect(await getStorage().head(first)).toBeNull(); // the replaced file is gone
    expect(await getStorage().head(second)).not.toBeNull();

    const removed = await call(deleteAccountAvatar, multipart(AVATAR, null, { method: 'DELETE' }));
    expect(removed).toMatchObject({ status: 200, body: { url: null } });
    expect(await getStorage().head(second)).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).avatarKey).toBeNull();
    expect((await getCurrentUser())!.avatarUrl).toBeNull();
  });

  it('keeps exactly one file after concurrent uploads (rows are locked while swapping)', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const results = await Promise.all([1, 2, 3].map(async () => call(postAccountAvatar, multipart(AVATAR, await png(300, 300)))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const files = await getStorage().list(`images/avatars/${user.id}/`);
    expect(files).toHaveLength(1);
    expect(files[0]!.key).toBe((await db.user.findUniqueOrThrow({ where: { id: user.id } })).avatarKey);
  });

  it('never deletes a foreign object the column happens to point at', async () => {
    const user = await createUser();
    const foreignKey = 'videos/AAAAAAAAAAA/thumbs/poster_x.jpg';
    await getStorage().put(foreignKey, Buffer.from('not an avatar'));
    await db.user.update({ where: { id: user.id }, data: { avatarKey: foreignKey } });
    expect(isOwnedImageKey(foreignKey, 'avatars', user.id)).toBe(false);
    await loginAs(user.id);
    expect((await call(postAccountAvatar, multipart(AVATAR, await png()))).status).toBe(200);
    expect(await getStorage().head(foreignKey)).not.toBeNull();
  });

  it('removes the freshly stored file when the database update fails', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const spy = vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('database unavailable'));
    const res = await call(postAccountAvatar, multipart(AVATAR, await png()));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await getStorage().list(`images/avatars/${user.id}/`)).toHaveLength(0);
  });
});

describe('channel avatar and banner', () => {
  it('stores a 400×400 avatar and a 1920×480 banner under the channel folder and shows them at once', async () => {
    const owner = await createUser({ withChannel: true });
    await loginAs(owner.id);
    const avatar = await call(postChannelAvatar, multipart(CH_AVATAR, await png(900, 900)));
    const banner = await call(postChannelBanner, multipart(CH_BANNER, await png(2400, 900)));
    expect([avatar.status, banner.status]).toEqual([200, 200]);

    const avatarKey = keyOfUrl(avatar.body!.url as string);
    const bannerKey = keyOfUrl(banner.body!.url as string);
    expect(avatarKey).toMatch(new RegExp(`^images/avatars/${owner.channel!.id}/`));
    expect(bannerKey).toMatch(new RegExp(`^images/banners/${owner.channel!.id}/`));
    expect(await sharp((await stored(avatarKey))!).metadata()).toMatchObject({ format: 'webp', width: 400, height: 400 });
    expect(await sharp((await stored(bannerKey))!).metadata()).toMatchObject({ format: 'webp', width: 1920, height: 480 });

    const channel = await db.channel.findUniqueOrThrow({ where: { id: owner.channel!.id } });
    expect(channel).toMatchObject({ avatarKey, bannerKey });
    expect((await getCurrentUser())!.channel!.avatarUrl).toBe(avatar.body!.url); // the menu shows the channel avatar
    expect((await getChannelSettings(channel.id)).bannerUrl).toBe(banner.body!.url);

    // replacing deletes the old files
    const newAvatar = keyOfUrl((await call(postChannelAvatar, multipart(CH_AVATAR, await png(600, 600)))).body!.url as string);
    expect(await getStorage().head(avatarKey)).toBeNull();
    expect(await getStorage().head(newAvatar)).not.toBeNull();
    expect((await call(deleteChannelBanner, multipart(CH_BANNER, null, { method: 'DELETE' }))).status).toBe(200);
    expect(await getStorage().head(bannerKey)).toBeNull();
    expect((await call(deleteChannelAvatar, multipart(CH_AVATAR, null, { method: 'DELETE' }))).status).toBe(200);
    expect((await db.channel.findUniqueOrThrow({ where: { id: owner.channel!.id } })).avatarKey).toBeNull();
  });

  it('is owner-only: anonymous gets 401, a user without a channel 403, and nobody can touch another channel', async () => {
    const owner = await createUser({ withChannel: true });
    const noChannel = await createUser();
    const other = await createUser({ withChannel: true });

    logout();
    expect(await call(postChannelBanner, multipart(CH_BANNER, await png()))).toMatchObject({ status: 401 });
    expect(await call(postAccountAvatar, multipart(AVATAR, await png()))).toMatchObject({ status: 401 });
    expect(await call(deleteChannelAvatar, multipart(CH_AVATAR, null, { method: 'DELETE' }))).toMatchObject({ status: 401 });

    await loginAs(noChannel.id);
    const forbidden = await call(postChannelAvatar, multipart(CH_AVATAR, await png()));
    expect(forbidden.status).toBe(403);
    expect(errorCode(forbidden)).toBe('FORBIDDEN');

    // the owner can only ever write their own channel: there is no id in the request to forge
    await loginAs(other.id);
    await call(postChannelAvatar, multipart(CH_AVATAR, await png()));
    expect((await db.channel.findUniqueOrThrow({ where: { id: owner.channel!.id } })).avatarKey).toBeNull();
    expect((await db.channel.findUniqueOrThrow({ where: { id: other.channel!.id } })).avatarKey).not.toBeNull();
  });
});

describe('upload validation', () => {
  const rejected = async (file: Buffer | null, opts: Parameters<typeof multipart>[2] = {}, handler: Handler = postAccountAvatar, path = AVATAR) => {
    const user = await createUser();
    await loginAs(user.id);
    const res = await call(handler, multipart(path, file, opts));
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).avatarKey).toBeNull(); // nothing was stored
    expect(await getStorage().list('images/')).toHaveLength(0);
    return res;
  };

  it.each([
    ['plain text pretending to be a PNG', () => Buffer.from('hello world, definitely not an image at all'), { name: 'a.png', type: 'image/png' }],
    ['an SVG document', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'), { name: 'a.svg', type: 'image/svg+xml' }],
    ['an HTML file renamed to .jpg', () => Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>'), { name: 'a.jpg', type: 'image/jpeg' }],
    ['a PNG signature followed by garbage', () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2000)]), { name: 'a.png', type: 'image/png' }],
    ['a GIF', () => Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), { name: 'a.gif', type: 'image/gif' }],
    ['a ZIP archive', () => Buffer.concat([Buffer.from('PK\x03\x04'), randomBytes(3000)]), { name: 'a.zip', type: 'application/zip' }],
  ])('rejects %s with 400 and stores nothing', async (_label, make, opts) => {
    const res = await rejected(make(), opts);
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('BAD_REQUEST');
    expect((res.body!.error as { message: string }).message).toMatch(/[؀-ۿ]/); // Persian message
  });

  it('rejects an empty file and a request without a file field', async () => {
    expect((await rejected(Buffer.alloc(0))).status).toBe(400);
    expect((await rejected(null)).status).toBe(400);
  });

  it('rejects a non-multipart request', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const req = new NextRequest(`${ORIGIN}${AVATAR}`, { method: 'POST', body: JSON.stringify({ file: 'x' }), headers: { 'content-type': 'application/json', origin: ORIGIN, host: 'localhost:3000' } });
    const res = await call(postAccountAvatar, req);
    expect(res.status).toBe(400);
  });

  it('rejects an oversize file (declared length) with 413', async () => {
    const big = Buffer.concat([await png(100, 100), randomBytes(9 * 1024 * 1024)]);
    const res = await rejected(big, { name: 'big.png' });
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe('QUOTA_EXCEEDED');
  });

  it('stops reading a streamed body that never declares its size', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const boundary = '----tgtest';
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) controller.enqueue(new Uint8Array(head));
        controller.enqueue(new Uint8Array(1024 * 1024));
        sent += 1;
        if (sent > 40) controller.close(); // 40 MiB would be sent if nobody stopped us
      },
    });
    const req = new NextRequest(`${ORIGIN}${AVATAR}`, {
      method: 'POST',
      body: stream,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, origin: ORIGIN, host: 'localhost:3000' },
      duplex: 'half', // undici requires it for streamed request bodies
    });
    const res = await call(postAccountAvatar, req);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(20); // cancelled long before the whole body was consumed
  });

  it('refuses cross-site requests (Origin check) before doing anything', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const res = await call(postAccountAvatar, multipart(AVATAR, await png(), { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(await getStorage().list('images/')).toHaveLength(0);
    const noOrigin = await call(postAccountAvatar, multipart(AVATAR, await png(), { origin: null }));
    expect(noOrigin.status).toBe(403);
  });

  it('rate-limits uploads per user', async () => {
    const user = await createUser();
    await loginAs(user.id);
    const tiny = await png(16, 16);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call(postAccountAvatar, multipart(AVATAR, tiny))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    // the files of the throttled attempt were never written: still exactly one avatar
    expect(await getStorage().list(`images/avatars/${user.id}/`)).toHaveLength(1);
  });
});
