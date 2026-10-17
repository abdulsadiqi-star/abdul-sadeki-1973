import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/studio/analytics/export/route';
import { db } from '@/lib/db';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { addComment, addFollowEvent, addLike, addViews } from '../helpers/insights-fixtures';

const ORIGIN = 'http://localhost:3000';
const today = new Date();
const daysAgo = (n: number, hour = 10) => new Date(today.getTime() - n * 86_400_000 + (hour - 12) * 3_600_000);

const get = async (query: string) => {
  const res = await GET(new NextRequest(`${ORIGIN}/api/studio/analytics/export${query}`, { headers: { host: 'localhost:3000' } }));
  const bytes = Buffer.from(await res.arrayBuffer());
  // `Response.text()` strips a UTF-8 BOM, so the raw bytes are what proves the BOM is really sent.
  return { res, text: bytes.toString('utf8'), bytes };
};

/** Minimal CSV reader for the shapes this export produces (no embedded newlines in these fixtures). */
const parseCsv = (text: string) =>
  text
    .replace(/^﻿/, '')
    .split('\r\n')
    .map((line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((cell) => cell.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));

async function seeded() {
  const owner = await createUser({ withChannel: true, handle: 'csv-owner' });
  const channelId = owner.channel!.id;
  const v1 = await createVideo(channelId, { title: 'ویدیوی اول' });
  const evil = await createVideo(channelId, { title: '=HYPERLINK("http://evil.example","کلیک")' });
  const fans = await Promise.all([createUser(), createUser()]);
  await addViews([
    { channelId, videoId: v1.id, at: daysAgo(2), viewer: 'a', watch: 120 },
    { channelId, videoId: v1.id, at: daysAgo(2), viewer: 'b', watch: 60 },
    { channelId, videoId: evil.id, at: daysAgo(1), viewer: 'a', watch: 30, source: 'SEED' },
  ]);
  await addLike(fans[0]!.id, v1.id, daysAgo(2));
  await addComment(v1.id, fans[1]!.id, daysAgo(1), 'APPROVED');
  await addFollowEvent(channelId, 'FOLLOW', daysAgo(2));
  await addFollowEvent(channelId, 'UNFOLLOW', daysAgo(1));
  return { owner, channelId, v1, evil, fans };
}

describe('GET /api/studio/analytics/export', () => {
  it('returns a UTF-8 CSV with a BOM, one row per day and the exact numbers from the database', async () => {
    const { owner } = await seeded();
    await loginAs(owner.id);
    const { res, text, bytes } = await get('?range=7d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="tamashagah-analytics-csv-owner-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM: Excel opens Persian text correctly

    const rows = parseCsv(text);
    const [header, ...days] = rows;
    expect(header).toContain('بازدید');
    expect(days).toHaveLength(7);
    const col = (name: string) => header!.indexOf(name);
    const sum = (name: string) => days.reduce((s, row) => s + Number(row[col(name)]), 0);
    expect(sum('بازدید')).toBe(3); // 2 real + 1 seed (the seed rows are flagged in their own column)
    expect(sum('بازدید نمونه‌ی آزمایشی')).toBe(1);
    expect(sum('پسند')).toBe(1);
    expect(sum('دیدگاه')).toBe(1);
    expect(sum('دنبال‌کننده‌ی جدید')).toBe(1);
    expect(sum('لغو دنبال')).toBe(1);
    expect(sum('رشد خالص')).toBe(0);
    expect(sum('دقایق تماشا')).toBeCloseTo(3.5, 2); // (120 + 60 + 30) s
    // ISO + Jalali dates, one distinct day per row
    expect(new Set(days.map((r) => r[0])).size).toBe(7);
    expect(days[0]![2]).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it('exports the per-video table and neutralizes spreadsheet formulas in titles', async () => {
    const { owner, evil } = await seeded();
    await loginAs(owner.id);
    const { res, text } = await get('?range=30d&type=videos');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('-videos.csv');
    const rows = parseCsv(text);
    expect(rows).toHaveLength(3); // header + 2 videos
    const titleRow = rows.find((r) => r[0] === evil.id)!;
    expect(titleRow[1]!.startsWith("'=")).toBe(true); // prefixed with an apostrophe: not a formula any more
    expect(text).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });

  it('scopes to one video when ?video= is the caller\'s own and answers 404 for anybody else\'s', async () => {
    const { owner, v1 } = await seeded();
    const other = await createUser({ withChannel: true });
    const otherVideo = await createVideo(other.channel!.id);
    await loginAs(owner.id);
    const mine = await get(`?range=7d&video=${v1.id}`);
    expect(mine.res.status).toBe(200);
    const header = parseCsv(mine.text)[0]!;
    expect(header).not.toContain('دنبال‌کننده‌ی جدید'); // follower growth is channel level only
    expect((await get(`?range=7d&video=${otherVideo.id}`)).res.status).toBe(404);
    expect((await get('?range=7d&video=doesNotExi1')).res.status).toBe(404); // well-formed but unknown
    expect((await get('?range=7d&video=bad id!')).res.status).toBe(422);
  });

  it('is owner-only: 401 anonymous, 403 without a channel, and no parameter can reach another channel', async () => {
    const { owner } = await seeded();
    const victim = await createUser({ withChannel: true, handle: 'victim-channel' });
    const victimVideo = await createVideo(victim.channel!.id);
    await addViews([{ channelId: victim.channel!.id, videoId: victimVideo.id, at: daysAgo(1), watch: 9_999 }]);
    const plain = await createUser();

    logout();
    expect((await get('?range=7d')).res.status).toBe(401);
    await loginAs(plain.id);
    expect((await get('?range=7d')).res.status).toBe(403);

    await loginAs(owner.id);
    // forged parameters are simply ignored: the data is always the signed-in user's channel
    for (const query of [`?channelId=${victim.channel!.id}`, `?channel=${victim.channel!.handle}`, `?ownerId=${victim.id}`, `?handle=victim-channel&range=7d`]) {
      const { res, text } = await get(query);
      expect(res.status, query).toBe(200);
      expect(res.headers.get('content-disposition'), query).toContain('csv-owner');
      expect(text, query).not.toContain('9999');
    }
    const videos = await get(`?type=videos&channelId=${victim.channel!.id}`);
    expect(videos.text).not.toContain(victimVideo.id);
  });

  it('validates the query (range, custom dates, type) with 422 and a Persian message', async () => {
    const { owner } = await seeded();
    await loginAs(owner.id);
    for (const query of ['?range=bogus', '?type=xml', '?granularity=hour', '?range=custom', '?range=custom&from=2026-02-30&to=2026-03-01', '?range=custom&from=2026-10-10&to=2026-10-01', '?range=custom&from=2020-01-01&to=2026-10-01']) {
      const { res, text } = await get(query);
      expect(res.status, query).toBe(422);
      expect(JSON.parse(text).error.message, query).toMatch(/[؀-ۿ]/);
    }
  });

  it('supports custom Tehran-day ranges and monthly granularity', async () => {
    const { owner } = await seeded();
    await loginAs(owner.id);
    const from = daysAgo(5).toISOString().slice(0, 10);
    const to = daysAgo(0).toISOString().slice(0, 10);
    const custom = parseCsv((await get(`?range=custom&from=${from}&to=${to}`)).text);
    expect(custom.length).toBeGreaterThanOrEqual(2 + 5); // header + at least 6 days (range is clamped to today in Tehran)
    const monthly = parseCsv((await get('?range=90d&granularity=month')).text);
    expect(monthly.length).toBeGreaterThanOrEqual(2);
    expect(monthly.length).toBeLessThanOrEqual(1 + 5); // 90 days touch at most 4–5 Jalali months
    const header = monthly[0]!;
    const views = monthly.slice(1).reduce((s, row) => s + Number(row[header.indexOf('بازدید')]), 0);
    expect(views).toBe(3);
  });

  it('rate-limits the export per user', async () => {
    const { owner } = await seeded();
    await loginAs(owner.id);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await get('?range=7d')).res.status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('leaves the database untouched (read-only endpoint)', async () => {
    const { owner } = await seeded();
    await loginAs(owner.id);
    const before = await Promise.all([db.viewEvent.count(), db.video.count(), db.channel.count()]);
    await get('?range=30d');
    await get('?range=30d&type=videos');
    expect(await Promise.all([db.viewEvent.count(), db.video.count(), db.channel.count()])).toEqual(before);
  });
});
