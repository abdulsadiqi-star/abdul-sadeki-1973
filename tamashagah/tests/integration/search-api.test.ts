import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { buildChannelSearchName } from '@/lib/persian';
import { db } from '@/lib/db';
import { GET } from '@/app/api/search/suggest/route';
import { createUser, createVideo } from '../helpers/factories';

const call = (q: string | null, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:3000/api/search/suggest${q === null ? '' : `?q=${encodeURIComponent(q)}`}`, { headers }));

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  resetEnvCache();
});

describe('GET /api/search/suggest', () => {
  it('returns up to 8 suggestions with titles and channels, public videos only', async () => {
    const owner = await createUser({ withChannel: true, handle: 'guitar-lab' });
    await db.channel.update({ where: { id: owner.channel!.id }, data: { name: 'آزمایشگاه گیتار', searchName: buildChannelSearchName('آزمایشگاه گیتار', 'guitar-lab') } });
    for (let i = 0; i < 7; i++) await createVideo(owner.channel!.id, { title: `گیتار پایه ${i}` });
    await createVideo(owner.channel!.id, { title: 'گیتار خصوصی', state: 'private' });

    const res = await call('گیتار');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('private');
    const body = (await res.json()) as { items: { type: string; text: string; href: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(8);
    expect(body.items.some((i) => i.type === 'channel' && i.href === '/channel/guitar-lab')).toBe(true);
    expect(body.items.map((i) => i.text)).not.toContain('گیتار خصوصی');
  });

  it('answers with an empty list (no database work) for fewer than 2 characters or no query', async () => {
    for (const q of [null, '', ' ', 'آ', 'a', '!!', '‌']) {
      const res = await call(q);
      expect(res.status, String(q)).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
    }
  });

  it('rejects overlong queries with a validation error', async () => {
    const res = await call('ا'.repeat(500));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  it('is rate limited per client (60 requests / minute) with Retry-After', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    resetEnvCache();
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 60; i++) expect((await call('گیتار', headers)).status).toBe(200);
    const blocked = await call('گیتار', headers);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // another client is unaffected
    expect((await call('گیتار', { 'x-forwarded-for': '203.0.113.8' })).status).toBe(200);
  });

  it('survives hostile input', async () => {
    for (const q of [`'); DROP TABLE "Video"; --`, '% _ \\', 'a:* & b | !c', '<script>alert(1)</script>']) {
      const res = await call(q);
      expect(res.status, q).toBe(200);
    }
  });
});
