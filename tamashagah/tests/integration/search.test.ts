import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { parseSearchState, type SearchParams } from '@/features/search/schemas';
import { searchChannels, searchVideos, suggest } from '@/features/search/queries';
import { createCategory, createChannel, createUser, createVideo } from '../helpers/factories';
import { buildChannelSearchName } from '@/lib/persian';
import { daysAgoDate } from '../support/discovery';

const params = (q: string, extra: Record<string, string> = {}): SearchParams => parseSearchState({ q, ...extra });
const find = async (q: string, extra: Record<string, string> = {}, categoryId: string | null = null) =>
  searchVideos(params(q, extra), { categoryId });
const titles = (r: Awaited<ReturnType<typeof find>>) => r.videos.map((v) => v.card.title);

async function owner(name = 'کانال آزمایشی') {
  const user = await createUser({ withChannel: true, displayName: name });
  const channel = await db.channel.update({
    where: { id: user.channel!.id },
    data: { name, searchName: buildChannelSearchName(name, user.channel!.handle) },
  });
  return channel;
}

describe('Persian-aware matching', () => {
  it('finds content regardless of Arabic Yeh/Kaf spelling, in both directions', async () => {
    const ch = await owner();
    // Arabic Yeh/Kaf in the stored title (e.g. pasted from an Arabic keyboard)…
    await createVideo(ch.id, { title: 'كتاب علي و ريحانه' });
    // …and Persian letters in another
    await createVideo(ch.id, { title: 'معرفی کتاب‌های علی' });
    for (const q of ['کتاب علی', 'كتاب علي', 'کتاب علي', 'كتاب علی']) {
      const r = await find(q);
      expect(titles(r), q).toEqual(expect.arrayContaining(['كتاب علي و ريحانه']));
      expect(r.videos.length, q).toBeGreaterThanOrEqual(1);
    }
    expect(titles(await find('ریحانه'))).toEqual(['كتاب علي و ريحانه']);
    expect(titles(await find('ريحانه'))).toEqual(['كتاب علي و ريحانه']);
  });

  it('ZWNJ and space are interchangeable', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'می‌خواهم یاد بگیرم' });
    expect(titles(await find('می خواهم'))).toEqual(['می‌خواهم یاد بگیرم']);
    expect(titles(await find('می‌خواهم'))).toEqual(['می‌خواهم یاد بگیرم']);
    // typed without ZWNJ or space: not a word match, but the typo-tolerant tier rescues it
    const joined = await find('میخواهم');
    expect(titles(joined)).toEqual(['می‌خواهم یاد بگیرم']);
    expect(joined.mode).toBe('fuzzy');
  });

  it('ignores diacritics and tatweel', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'مُحَمَّد رضا شجریان' });
    await createVideo(ch.id, { title: 'آمـــوزش گیتار' });
    expect(titles(await find('محمد'))).toEqual(['مُحَمَّد رضا شجریان']);
    expect(titles(await find('مُحَمَّد'))).toEqual(['مُحَمَّد رضا شجریان']);
    expect(titles(await find('آموزش گیتار'))).toEqual(['آمـــوزش گیتار']);
  });

  it('digits: Persian, Arabic-Indic and ASCII are the same', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: '۱۰۰ لغت پرکاربرد انگلیسی' });
    await createVideo(ch.id, { title: 'سال 1405 چه شد؟' });
    for (const q of ['100 لغت', '۱۰۰ لغت', '١٠٠ لغت', '۱۰۰']) expect(titles(await find(q)), q).toEqual(['۱۰۰ لغت پرکاربرد انگلیسی']);
    for (const q of ['1405', '۱۴۰۵', '١٤٠٥']) expect(titles(await find(q)), q).toEqual(['سال 1405 چه شد؟']);
  });

  it('Alef variants (آ أ إ ا) and Heh forms fold together', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'آموزش اسکی' });
    await createVideo(ch.id, { title: 'أمیر و إمام' });
    expect(titles(await find('اموزش'))).toEqual(['آموزش اسکی']);
    expect(titles(await find('آموزش'))).toEqual(['آموزش اسکی']);
    expect(titles(await find('امیر'))).toEqual(['أمیر و إمام']);
  });

  it('prefix matching: a partial word finds the full word', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'آموزش پایتون برای مبتدیان' });
    for (const q of ['پایت', 'پا', 'مبتد', 'اموز']) expect(titles(await find(q)), q).toEqual(['آموزش پایتون برای مبتدیان']);
  });

  it('typo tolerance (trigram on the normalized title) when exact results are sparse', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'آموزش پایتون برای مبتدیان' });
    await createVideo(ch.id, { title: 'طرز تهیه‌ی قورمه‌سبزی' });
    // one word is right, one is misspelled → rescued by the OR tier, best title match first
    const partial = await find('اموزش پایتن');
    expect(titles(partial)[0]).toBe('آموزش پایتون برای مبتدیان');
    // no word matches exactly → only the trigram tier can find it
    const typo = await find('پایتن');
    expect(titles(typo)).toEqual(['آموزش پایتون برای مبتدیان']);
    expect(typo.mode).toBe('fuzzy');
    expect(titles(await find('قورمه سبزی'))).toEqual(['طرز تهیه‌ی قورمه‌سبزی']);
    expect((await find('قورمه‌سزی')).videos.map((v) => v.card.title)).toEqual(['طرز تهیه‌ی قورمه‌سبزی']);
    // nothing similar → nothing
    expect((await find('زرافه')).videos).toEqual([]);
  });

  it('searches the description, tags and channel name too (lower weight than the title)', async () => {
    const ch = await owner('سرآشپز بزرگ');
    await createVideo(ch.id, { title: 'ویدیوی اول', description: 'در این ویدیو درباره‌ی زعفران صحبت می‌کنیم', tags: ['ادویه'] });
    expect(titles(await find('زعفران'))).toEqual(['ویدیوی اول']);
    expect(titles(await find('ادویه'))).toEqual(['ویدیوی اول']);
    expect(titles(await find('سرآشپز'))).toEqual(['ویدیوی اول']);
  });
});

describe('ranking and modes', () => {
  it('title matches outrank description-only matches', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'ویدیویی درباره‌ی چیز دیگر', description: 'گیتار گیتار گیتار' });
    await createVideo(ch.id, { title: 'آموزش گیتار' });
    expect(titles(await find('گیتار'))[0]).toBe('آموزش گیتار');
  });

  it('AND results are used when plentiful; OR fallback ranks videos containing all words first', async () => {
    const ch = await owner();
    for (let i = 0; i < 6; i++) await createVideo(ch.id, { title: `آموزش پایتون ${i}` });
    await createVideo(ch.id, { title: 'آموزش آشپزی' });
    await createVideo(ch.id, { title: 'پایتون پیشرفته' });
    const many = await find('آموزش پایتون');
    expect(many.mode).toBe('and');
    expect(many.total).toBe(6);

    // only one video contains BOTH words → sparse → widened to OR; the AND match comes first
    const ch2 = await owner('دیگری');
    await createVideo(ch2.id, { title: 'ریاضی و فیزیک مقدماتی' });
    await createVideo(ch2.id, { title: 'ریاضی کنکور' });
    await createVideo(ch2.id, { title: 'فیزیک کنکور' });
    const widened = await find('ریاضی فیزیک');
    expect(widened.mode).toBe('or');
    expect(titles(widened)[0]).toBe('ریاضی و فیزیک مقدماتی');
    expect(titles(widened).sort()).toEqual(['ریاضی و فیزیک مقدماتی', 'ریاضی کنکور', 'فیزیک کنکور'].sort());
  });

  it('reports no results for gibberish, empty and punctuation-only queries (browse mode for the latter)', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'یک ویدیو' });
    expect((await find('zzzzqqqq')).videos).toEqual([]);
    expect((await find('zzzzqqqq')).total).toBe(0);
    const browse = await find('');
    expect(browse.mode).toBe('browse');
    expect(browse.videos).toHaveLength(1);
    expect((await find('!!! ???')).mode).toBe('browse');
  });
});

describe('visibility: non-public videos are never returned', () => {
  it('excludes every hidden state in every mode (and, or, typo-tolerant, browse)', async () => {
    const ch = await owner();
    const suspendedOwner = await createUser({ withChannel: true });
    await db.channel.update({ where: { id: suspendedOwner.channel!.id }, data: { suspendedAt: new Date(), name: 'کانال معلق' } });
    await createVideo(ch.id, { title: 'گیتار عمومی', tags: ['گیتار'] });
    const hiddenTitles: string[] = [];
    for (const state of ['private', 'unlisted', 'draft', 'processing', 'failed', 'scheduled', 'takedown'] as const) {
      const title = `گیتار ${state}`;
      hiddenTitles.push(title);
      await createVideo(ch.id, { title, state, tags: ['گیتار'] });
    }
    await createVideo(suspendedOwner.channel!.id, { title: 'گیتار از کانال معلق' });

    for (const q of ['گیتار', 'گیتار عمومی', 'گیتر', 'گیتار private', 'گی']) {
      const r = await find(q);
      for (const t of r.videos.map((v) => v.card.title)) {
        expect(hiddenTitles, `${q} → ${t}`).not.toContain(t);
        expect(t).not.toBe('گیتار از کانال معلق');
      }
    }
    const browse = (await find('')).videos.map((v) => v.card.title);
    expect(browse).toEqual(['گیتار عمومی']);
    // filters never widen visibility either
    expect((await find('', { type: 'video', sort: 'newest' })).videos).toHaveLength(1);
  });

  it('a video that becomes hidden disappears immediately', async () => {
    const ch = await owner();
    const v = await createVideo(ch.id, { title: 'ویدیوی موقت' });
    expect(titles(await find('موقت'))).toEqual(['ویدیوی موقت']);
    await db.video.update({ where: { id: v.id }, data: { visibility: 'PRIVATE' } });
    expect(titles(await find('موقت'))).toEqual([]);
    await db.video.update({ where: { id: v.id }, data: { visibility: 'PUBLIC', takedownAt: new Date() } });
    expect(titles(await find('موقت'))).toEqual([]);
  });
});

describe('filters, sorting, pagination', () => {
  it('type: video / short', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'کلیپ بلند', kind: 'VIDEO' });
    await createVideo(ch.id, { title: 'کلیپ کوتاه', kind: 'SHORT', durationSeconds: 20 });
    expect(titles(await find('کلیپ'))).toHaveLength(2);
    expect(titles(await find('کلیپ', { type: 'video' }))).toEqual(['کلیپ بلند']);
    expect(titles(await find('کلیپ', { type: 'short' }))).toEqual(['کلیپ کوتاه']);
  });

  it('date windows (hour / today / week / month / year)', async () => {
    const ch = await owner();
    const make = (title: string, publishedAt: Date) => createVideo(ch.id, { title, publishedAt });
    await make('برنامه نیم‌ساعت پیش', new Date(Date.now() - 30 * 60_000));
    await make('برنامه دیروز', daysAgoDate(1.5));
    await make('برنامه چند روز پیش', daysAgoDate(5));
    await make('برنامه ماه پیش', daysAgoDate(20));
    await make('برنامه سال پیش', daysAgoDate(200));
    await make('برنامه خیلی قدیمی', daysAgoDate(500));
    const count = async (date: string) => (await find('برنامه', { date })).total;
    expect(await count('hour')).toBe(1);
    expect(await count('today')).toBe(1);
    expect(await count('week')).toBe(3);
    expect(await count('month')).toBe(4);
    expect(await count('year')).toBe(5);
    expect(await count('any')).toBe(6);
  });

  it('duration buckets: short < 4 min, medium 4–20 min, long > 20 min', async () => {
    const ch = await owner();
    for (const [title, seconds] of [['درس ۱', 90], ['درس ۲', 239], ['درس ۳', 240], ['درس ۴', 1200], ['درس ۵', 1201], ['درس ۶', 4000]] as const) {
      await createVideo(ch.id, { title, durationSeconds: seconds });
    }
    const bucket = async (duration: string) => (await find('درس', { duration })).videos.map((v) => v.card.title).sort();
    expect(await bucket('short')).toEqual(['درس ۱', 'درس ۲']);
    expect(await bucket('medium')).toEqual(['درس ۳', 'درس ۴']);
    expect(await bucket('long')).toEqual(['درس ۵', 'درس ۶']);
  });

  it('category filter', async () => {
    const music = await createCategory('music', 'موسیقی');
    const sports = await createCategory('sports', 'ورزش');
    const ch = await owner();
    await createVideo(ch.id, { title: 'تمرین ریتم', categoryId: music.id });
    await createVideo(ch.id, { title: 'تمرین دو', categoryId: sports.id });
    expect(titles(await find('تمرین', {}, music.id))).toEqual(['تمرین ریتم']);
    expect(titles(await find('تمرین', {}, sports.id))).toEqual(['تمرین دو']);
    expect((await find('تمرین')).total).toBe(2);
  });

  it('sort: newest and most viewed (relevance ordering is not applied)', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'مرور قدیمی پربازدید', viewCount: 900, publishedAt: daysAgoDate(30) });
    await createVideo(ch.id, { title: 'مرور تازه کم‌بازدید', viewCount: 5, publishedAt: daysAgoDate(1) });
    await createVideo(ch.id, { title: 'مرور میانی', viewCount: 100, publishedAt: daysAgoDate(10) });
    expect(titles(await find('مرور', { sort: 'newest' }))).toEqual(['مرور تازه کم‌بازدید', 'مرور میانی', 'مرور قدیمی پربازدید']);
    expect(titles(await find('مرور', { sort: 'popular' }))).toEqual(['مرور قدیمی پربازدید', 'مرور میانی', 'مرور تازه کم‌بازدید']);
  });

  it('browse without a query is popular-first and supports filters', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'الف', viewCount: 1 });
    await createVideo(ch.id, { title: 'ب', viewCount: 500 });
    await createVideo(ch.id, { title: 'ج', viewCount: 50, kind: 'SHORT', durationSeconds: 15 });
    expect(titles(await find(''))).toEqual(['ب', 'ج', 'الف']);
    expect(titles(await find('', { type: 'short' }))).toEqual(['ج']);
  });

  it('paginates with a stable total order, correct totals and no duplicates', async () => {
    const ch = await owner();
    for (let i = 0; i < 45; i++) await createVideo(ch.id, { title: `قسمت ${i}`, viewCount: 1000 - i });
    const p1 = await find('قسمت', { sort: 'popular' });
    const p2 = await find('قسمت', { sort: 'popular', page: '2' });
    const p3 = await find('قسمت', { sort: 'popular', page: '3' });
    const p4 = await find('قسمت', { sort: 'popular', page: '4' });
    expect([p1.total, p1.pageCount, p1.videos.length]).toEqual([45, 3, 20]);
    expect([p2.videos.length, p3.videos.length, p4.videos.length]).toEqual([20, 5, 0]);
    const all = [...p1.videos, ...p2.videos, ...p3.videos].map((v) => v.card.id);
    expect(new Set(all).size).toBe(45);
    expect(p1.videos[0]!.card.title).toBe('قسمت 0');
    expect(p3.videos.at(-1)!.card.title).toBe('قسمت 44');
  });

  it('highlights matched terms and builds a safe snippet', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'آموزش پایتون', description: 'در این ویدیو با <b>پایتون</b> و <script>alert(1)</script> آشنا می‌شویم.' });
    const r = await find('پایتون');
    const v = r.videos[0]!;
    expect(v.titleSegments.filter((s) => s.match).map((s) => s.text)).toEqual(['پایتون']);
    const snippetText = v.snippet.map((s) => s.text).join('');
    expect(snippetText).toContain('<script>alert(1)</script>'); // kept as plain text, rendered escaped by React
    expect(v.snippet.some((s) => s.match)).toBe(true);
  });
});

describe('injection safety', () => {
  it('survives hostile queries without errors and keeps the tables intact', async () => {
    const ch = await owner();
    await createVideo(ch.id, { title: 'ویدیوی عادی' });
    const hostile = [
      `'); DROP TABLE "Video"; --`,
      `" OR 1=1 --`,
      `\\' OR '1'='1`,
      `% _ \\ %`,
      `foo:* & bar | !baz <-> (qux)`,
      `&&& ||| !!! ::: ***`,
      `a'b"c\`d`,
      '\u0000\u0001 control',
      `<script>alert(1)</script>`,
      'ا'.repeat(300),
      `${'کلمه '.repeat(60)}`,
      `ویدیو:* | (`,
    ];
    for (const q of hostile) {
      const r = await find(q);
      expect(Array.isArray(r.videos), q).toBe(true);
      await expect(searchChannels(q)).resolves.toBeDefined();
      await expect(suggest(q)).resolves.toBeDefined();
    }
    expect(await db.video.count()).toBe(1);
    expect(titles(await find('عادی'))).toEqual(['ویدیوی عادی']);
  });
});

describe('channels', () => {
  it('matches by name or handle words, in either script spelling, and excludes suspended channels', async () => {
    const sara = await createUser({ withChannel: true, handle: 'sara-cooks' });
    await db.channel.update({ where: { id: sara.channel!.id }, data: { name: 'آشپزی با سارا', searchName: buildChannelSearchName('آشپزی با سارا', 'sara-cooks'), followerCount: 10 } });
    const arman = await createUser({ withChannel: true, handle: 'arman-tech' });
    await db.channel.update({ where: { id: arman.channel!.id }, data: { name: 'آرمان تک', searchName: buildChannelSearchName('آرمان تک', 'arman-tech'), followerCount: 50 } });
    const gone = await createUser({ withChannel: true, handle: 'sara-gone' });
    await db.channel.update({ where: { id: gone.channel!.id }, data: { name: 'سارای معلق', searchName: buildChannelSearchName('سارای معلق', 'sara-gone'), suspendedAt: new Date() } });

    const names = async (q: string) => (await searchChannels(q)).channels.map((c) => c.name);
    expect(await names('سارا')).toEqual(['آشپزی با سارا']);
    expect(await names('sara')).toEqual(['آشپزی با سارا']);
    expect(await names('اشپزی')).toEqual(['آشپزی با سارا']);
    expect(await names('آشپزی')).toEqual(['آشپزی با سارا']);
    expect(await names('arm')).toEqual(['آرمان تک']);
    expect(await names('آرمان تک')).toEqual(['آرمان تک']);
    // the suspended channel is never listed (the typo-tolerant tier may still offer the healthy "سارا" channel)
    expect(await names('سارای')).not.toContain('سارای معلق');
    expect(await names('sara-gone')).not.toContain('سارای معلق');
    expect(await names('gone')).toEqual([]);
    expect(await names('هیچی')).toEqual([]);
  });

  it('typo-tolerant when there are very few hits; most-followed first otherwise', async () => {
    const make = async (handle: string, name: string, followers: number) => {
      const u = await createUser({ withChannel: true, handle });
      await db.channel.update({ where: { id: u.channel!.id }, data: { name, searchName: buildChannelSearchName(name, handle), followerCount: followers } });
    };
    await make('big', 'ورزش بزرگ', 500);
    await make('small', 'ورزش کوچک', 5);
    expect((await searchChannels('ورزش')).channels.map((c) => c.handle)).toEqual(['big', 'small']);
    const typo = await searchChannels('ورزشش بزرگ');
    expect(typo.channels.map((c) => c.handle)).toContain('big');
  });

  it('reports a video count of PUBLIC videos only', async () => {
    const u = await createUser({ withChannel: true, handle: 'counted' });
    await db.channel.update({ where: { id: u.channel!.id }, data: { name: 'شمارش', searchName: buildChannelSearchName('شمارش', 'counted') } });
    await createVideo(u.channel!.id, { title: 'الف' });
    await createVideo(u.channel!.id, { title: 'ب' });
    await createVideo(u.channel!.id, { title: 'خصوصی', state: 'private' });
    await createVideo(u.channel!.id, { title: 'پیش‌نویس', state: 'draft' });
    expect((await searchChannels('شمارش')).channels[0]!.videoCount).toBe(2);
  });

  it('paginates and reports totals; no query lists the most followed', async () => {
    for (let i = 0; i < 14; i++) {
      const u = await createUser({ withChannel: true, handle: `chan-${i}` });
      await db.channel.update({ where: { id: u.channel!.id }, data: { name: `کانال نمونه ${i}`, searchName: buildChannelSearchName(`کانال نمونه ${i}`, `chan-${i}`), followerCount: i } });
    }
    const first = await searchChannels('کانال', { limit: 5 });
    expect(first.channels).toHaveLength(5);
    expect(first.total).toBe(14);
    expect(first.hasMore).toBe(true);
    const last = await searchChannels('کانال', { limit: 5, page: 3 });
    expect(last.channels).toHaveLength(4);
    expect(last.hasMore).toBe(false);
    const browse = await searchChannels('', { limit: 3 });
    expect(browse.channels.map((c) => c.handle)).toEqual(['chan-13', 'chan-12', 'chan-11']);
  });
});

describe('suggestions', () => {
  it('returns at most 8 items: matching titles and channels, hidden videos excluded', async () => {
    const u = await createUser({ withChannel: true, handle: 'guitar-lab' });
    await db.channel.update({ where: { id: u.channel!.id }, data: { name: 'آزمایشگاه گیتار', searchName: buildChannelSearchName('آزمایشگاه گیتار', 'guitar-lab') } });
    for (let i = 0; i < 9; i++) await createVideo(u.channel!.id, { title: `گیتار آموزشی ${i}`, viewCount: 100 - i });
    await createVideo(u.channel!.id, { title: 'گیتار خصوصی', state: 'private', viewCount: 9999 });
    await createVideo(u.channel!.id, { title: 'گیتار حذف‌شده', state: 'takedown', viewCount: 9999 });

    const items = await suggest('گیتار');
    expect(items.length).toBeLessThanOrEqual(8);
    const videos = items.filter((i) => i.type === 'video');
    const channels = items.filter((i) => i.type === 'channel');
    expect(videos.length).toBe(5);
    expect(channels.map((c) => c.href)).toEqual(['/channel/guitar-lab']);
    expect(videos[0]!.text).toBe('گیتار آموزشی 0'); // most viewed first
    expect(videos.every((v) => v.href.startsWith('/watch/'))).toBe(true);
    expect(items.map((i) => i.text)).not.toContain('گیتار خصوصی');
    expect(items.map((i) => i.text)).not.toContain('گیتار حذف‌شده');
  });

  it('needs at least two characters; tolerates typos; dedupes identical titles', async () => {
    const u = await owner();
    await createVideo(u.id, { title: 'آموزش پایتون' });
    await createVideo(u.id, { title: 'آموزش پایتون' });
    expect(await suggest('آ')).toEqual([]);
    expect(await suggest(' ')).toEqual([]);
    expect((await suggest('اموزش پایتن')).filter((i) => i.type === 'video')).toHaveLength(1);
    expect((await suggest('آموزش')).filter((i) => i.type === 'video')).toHaveLength(1);
  });
});
