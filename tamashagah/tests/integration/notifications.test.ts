import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { notify, notifyMany } from '@/features/notifications/service';
import { countUnreadNotifications, listNotifications, markNotificationsRead } from '@/features/notifications/queries';
import { GET as listRoute } from '@/app/api/notifications/route';
import { POST as readRoute } from '@/app/api/notifications/read/route';
import { createUser } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';

async function seedNotifications(userId: string, n: number, extra: { actorId?: string; read?: number } = {}) {
  const base = Date.now() - 3_600_000;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const row = await db.notification.create({
      data: {
        userId,
        type: 'NEW_FOLLOWER',
        title: `اعلان شماره ${i + 1}`,
        href: '/studio',
        actorId: extra.actorId,
        createdAt: new Date(base + i * 1_000),
        readAt: i < (extra.read ?? 0) ? new Date() : null,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

describe('listNotifications', () => {
  it('lists the newest first, only the recipient’s, with cursor pagination', async () => {
    const me = await createUser();
    const other = await createUser();
    await seedNotifications(me.id, 25);
    await seedNotifications(other.id, 3);

    const p1 = await listNotifications(me.id, { limit: 10 });
    expect(p1.items).toHaveLength(10);
    expect(p1.items[0]!.title).toBe('اعلان شماره 25');
    const p2 = await listNotifications(me.id, { limit: 10, cursor: p1.nextCursor });
    const p3 = await listNotifications(me.id, { limit: 10, cursor: p2.nextCursor });
    expect(p3.items).toHaveLength(5);
    expect(p3.nextCursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items, ...p3.items].map((n) => n.id)).size).toBe(25);
  });

  it('filters unread ones and keeps the cursor valid when an item was read meanwhile', async () => {
    const me = await createUser();
    const ids = await seedNotifications(me.id, 12, { read: 4 }); // the 4 oldest are read
    const unread = await listNotifications(me.id, { limit: 5, unreadOnly: true });
    expect(unread.items.every((n) => !n.read)).toBe(true);
    expect(unread.items).toHaveLength(5);
    await markNotificationsRead(me.id, [unread.items.at(-1)!.id]);
    const next = await listNotifications(me.id, { limit: 5, unreadOnly: true, cursor: unread.nextCursor });
    expect(next.items.map((n) => n.title)).toEqual(['اعلان شماره 7', 'اعلان شماره 6', 'اعلان شماره 5']);
    expect(ids).toHaveLength(12);
  });

  it('clamps the page size and describes the actor by channel name when there is one', async () => {
    const me = await createUser();
    const actor = await createUser({ withChannel: true, displayName: 'نام شخصی' });
    await seedNotifications(me.id, 3, { actorId: actor.id });
    expect((await listNotifications(me.id, { limit: 500 })).items).toHaveLength(3);
    expect((await listNotifications(me.id, { limit: 0 })).items).toHaveLength(1);
    const [first] = (await listNotifications(me.id)).items;
    expect(first!.actor).toEqual({ name: actor.channel!.name, avatarUrl: null });
    expect(first).toMatchObject({ read: false, href: '/studio', type: 'NEW_FOLLOWER' });
  });
});

describe('unread count and mark read', () => {
  it('counts unread, marks specific ids or everything, and only for the owner', async () => {
    const me = await createUser();
    const other = await createUser();
    const mine = await seedNotifications(me.id, 5);
    const theirs = await seedNotifications(other.id, 2);
    expect(await countUnreadNotifications(me.id)).toBe(5);

    expect(await markNotificationsRead(me.id, [mine[0]!, mine[1]!])).toBe(2);
    expect(await markNotificationsRead(me.id, [mine[0]!])).toBe(0); // already read
    expect(await countUnreadNotifications(me.id)).toBe(3);

    // somebody else's ids are untouched even when sent by mistake (or on purpose)
    expect(await markNotificationsRead(me.id, theirs)).toBe(0);
    expect(await countUnreadNotifications(other.id)).toBe(2);

    expect(await markNotificationsRead(me.id)).toBe(3);
    expect(await countUnreadNotifications(me.id)).toBe(0);
    expect(await countUnreadNotifications(other.id)).toBe(2);
  });
});

describe('notify / notifyMany', () => {
  it('skip self-notifications and truncate overlong text', async () => {
    const a = await createUser();
    const b = await createUser();
    await notify({ userId: a.id, actorId: a.id, type: 'SYSTEM', title: 'خودم' });
    await notify({ userId: b.id, actorId: a.id, type: 'SYSTEM', title: 'ت'.repeat(300), body: 'ب'.repeat(900) });
    await notifyMany([
      { userId: a.id, actorId: a.id, type: 'SYSTEM', title: 'خودم' },
      { userId: a.id, actorId: b.id, type: 'SYSTEM', title: 'برای الف' },
    ]);
    const rows = await db.notification.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.title.length)).toEqual([200, 'برای الف'.length]);
    expect(rows[0]!.body!.length).toBe(500);
  });
});

describe('GET /api/notifications', () => {
  const get = (qs = '') => listRoute(new NextRequest(`http://localhost:3000/api/notifications?${qs}`), { params: Promise.resolve({}) });

  it('requires a session', async () => {
    logout();
    const res = await get();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns a page, the cursor and the unread count', async () => {
    const me = await createUser();
    await seedNotifications(me.id, 15, { read: 5 });
    await loginAs(me.id);
    const res = await get('limit=10');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(body.items).toHaveLength(10);
    expect(body.unreadCount).toBe(10);
    expect(body.nextCursor).toBe(body.items.at(-1).id);

    const page2 = await (await get(`limit=10&cursor=${body.nextCursor}`)).json();
    expect(page2.items).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();
    const unread = await (await get('unread=1&limit=50')).json();
    expect(unread.items).toHaveLength(10);
    expect(unread.items.every((n: { read: boolean }) => !n.read)).toBe(true);
  });

  it('validates its query', async () => {
    const me = await createUser();
    await loginAs(me.id);
    expect((await get('limit=0')).status).toBe(422);
    expect((await get('limit=51')).status).toBe(422);
    expect((await get('unread=maybe')).status).toBe(422);
    expect((await get(`cursor=${'x'.repeat(41)}`)).status).toBe(422);
  });
});

describe('POST /api/notifications/read', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    readRoute(
      new NextRequest('http://localhost:3000/api/notifications/read', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) },
    );

  it('marks ids or everything read and returns the remaining count', async () => {
    const me = await createUser();
    const ids = await seedNotifications(me.id, 6);
    await loginAs(me.id);
    expect(await (await post({ ids: [ids[0], ids[1]] })).json()).toEqual({ unreadCount: 4 });
    expect(await (await post({ all: true })).json()).toEqual({ unreadCount: 0 });
  });

  it('cannot touch other people’s notifications', async () => {
    const me = await createUser();
    const other = await createUser();
    const theirs = await seedNotifications(other.id, 2);
    await loginAs(me.id);
    expect(await (await post({ ids: theirs })).json()).toEqual({ unreadCount: 0 });
    expect(await countUnreadNotifications(other.id)).toBe(2);
  });

  it('requires a session, a trusted origin and a valid body', async () => {
    const me = await createUser();
    logout();
    expect((await post({ all: true })).status).toBe(401);
    await loginAs(me.id);
    expect((await post({ all: true }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({})).status).toBe(422);
    expect((await post({ ids: [] })).status).toBe(422);
    expect((await post({ ids: Array.from({ length: 101 }, (_, i) => `id${i}`) })).status).toBe(422);
    expect((await post({ all: false })).status).toBe(422);
  });
});
