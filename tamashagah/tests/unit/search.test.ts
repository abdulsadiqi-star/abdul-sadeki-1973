import { describe, expect, it } from 'vitest';
import {
  SEARCH_MAX_PAGES,
  SEARCH_QUERY_MAX,
  dateFilterSince,
  durationFilterRange,
  hasActiveFilters,
  parseSearchState,
  searchHref,
} from '@/features/search/schemas';
import { findMatchRanges, foldWithMap, highlightSegments, snippetSegments } from '@/features/search/highlight';
import {
  COUNT_CAP,
  RANK_WEIGHTS,
  channelPrefixCondition,
  countSql,
  escapeLike,
  filterConditions,
  matchCondition,
  orderSql,
  pageSql,
  prepareQuery,
  type VideoSearchPlan,
} from '@/features/search/sql';

const NOW = new Date('2026-10-11T12:00:00.000Z');

describe('parseSearchState', () => {
  it('defaults: popular when browsing, relevance with a query', () => {
    expect(parseSearchState({})).toEqual({ q: '', type: 'all', sort: 'popular', date: 'any', duration: 'any', category: null, page: 1 });
    expect(parseSearchState({ q: 'پایتون' }).sort).toBe('relevance');
  });

  it('falls back to defaults for invalid values instead of failing', () => {
    const s = parseSearchState({ q: 'x', type: 'bogus', sort: 'bogus', date: 'decade', duration: 'forever', category: 'NOT VALID!', page: 'abc' });
    expect(s).toMatchObject({ type: 'all', sort: 'relevance', date: 'any', duration: 'any', category: null, page: 1 });
  });

  it('keeps valid values and clamps the page', () => {
    expect(parseSearchState({ q: 'x', type: 'short', sort: 'newest', date: 'week', duration: 'medium', category: 'music', page: '3' })).toEqual({
      q: 'x',
      type: 'short',
      sort: 'newest',
      date: 'week',
      duration: 'medium',
      category: 'music',
      page: 3,
    });
    expect(parseSearchState({ page: '0' }).page).toBe(1);
    expect(parseSearchState({ page: '-4' }).page).toBe(1);
    expect(parseSearchState({ page: '99999' }).page).toBe(SEARCH_MAX_PAGES);
    expect(parseSearchState({ page: '2.7' }).page).toBe(2);
  });

  it('"relevance" without a query is popular; the first value wins for repeated params', () => {
    expect(parseSearchState({ sort: 'relevance' }).sort).toBe('popular');
    expect(parseSearchState({ q: ['اول', 'دوم'] }).q).toBe('اول');
  });

  it('cleans the query: Arabic Yeh/Kaf → Persian, controls and bidi marks stripped, spaces collapsed, length capped', () => {
    expect(parseSearchState({ q: '  علي   كتاب \u0000‮ ' }).q).toBe('علی کتاب');
    expect(parseSearchState({ q: 'ا'.repeat(500) }).q).toHaveLength(SEARCH_QUERY_MAX);
  });
});

describe('searchHref', () => {
  const base = parseSearchState({ q: 'پایتون' });
  it('omits defaults and resets paging when something else changes', () => {
    expect(searchHref(parseSearchState({}))).toBe('/search');
    expect(searchHref(base)).toBe('/search?q=%D9%BE%D8%A7%DB%8C%D8%AA%D9%88%D9%86');
    expect(searchHref({ ...base, page: 4 }, { sort: 'newest' })).toBe(`${searchHref(base)}&sort=newest`);
    expect(searchHref(base, { page: 3 })).toContain('page=3');
  });
  it('"popular" is the default only without a query', () => {
    expect(searchHref(parseSearchState({}), { sort: 'popular' })).toBe('/search');
    expect(searchHref(base, { sort: 'popular' })).toContain('sort=popular');
  });
  it('roundtrips through parseSearchState', () => {
    const state = parseSearchState({ q: 'آموزش', type: 'video', sort: 'newest', date: 'month', duration: 'long', category: 'education', page: '2' });
    const url = new URL(searchHref(state, { page: state.page }), 'http://x');
    expect(parseSearchState(Object.fromEntries(url.searchParams))).toEqual(state);
  });
  it('hasActiveFilters ignores query, sort and page', () => {
    expect(hasActiveFilters(parseSearchState({ q: 'x', sort: 'newest', page: '3' }))).toBe(false);
    expect(hasActiveFilters(parseSearchState({ date: 'week' }))).toBe(true);
    expect(hasActiveFilters(parseSearchState({ type: 'channel' }))).toBe(true);
  });
});

describe('filter helpers', () => {
  it('date windows are rolling', () => {
    expect(dateFilterSince('any', NOW)).toBeNull();
    expect(NOW.getTime() - dateFilterSince('hour', NOW)!.getTime()).toBe(3_600_000);
    expect(NOW.getTime() - dateFilterSince('today', NOW)!.getTime()).toBe(86_400_000);
    expect(NOW.getTime() - dateFilterSince('week', NOW)!.getTime()).toBe(7 * 86_400_000);
    expect(NOW.getTime() - dateFilterSince('month', NOW)!.getTime()).toBe(30 * 86_400_000);
    expect(NOW.getTime() - dateFilterSince('year', NOW)!.getTime()).toBe(365 * 86_400_000);
  });
  it('duration buckets: <4 min, 4–20 min, >20 min', () => {
    expect(durationFilterRange('any')).toEqual({ min: null, max: null });
    expect(durationFilterRange('short')).toEqual({ min: null, max: 239 });
    expect(durationFilterRange('medium')).toEqual({ min: 240, max: 1200 });
    expect(durationFilterRange('long')).toEqual({ min: 1201, max: null });
  });
});

describe('highlight', () => {
  const join = (segments: { text: string }[]) => segments.map((s) => s.text).join('');
  const marked = (segments: { text: string; match: boolean }[]) => segments.filter((s) => s.match).map((s) => s.text);

  it('marks word-prefix matches and keeps the original text intact', () => {
    const segments = highlightSegments('آموزش پایتون برای مبتدیان', ['پایت']);
    expect(marked(segments)).toEqual(['پایت']);
    expect(join(segments)).toBe('آموزش پایتون برای مبتدیان');
  });

  it('matches regardless of Arabic Yeh/Kaf, diacritics, tatweel, case and digit scripts', () => {
    expect(marked(highlightSegments('كتاب علي', ['کتاب']))).toEqual(['كتاب']);
    expect(marked(highlightSegments('علي', ['علی']))).toEqual(['علي']);
    expect(marked(highlightSegments('مُحَمَّد رضا', ['محمد']))).toEqual(['مُحَمَّد']);
    expect(marked(highlightSegments('آمـــوزش', ['اموزش']))).toEqual(['آمـــوزش']);
    expect(marked(highlightSegments('Python Basics', ['python']))).toEqual(['Python']);
    expect(marked(highlightSegments('سال ۲۰۲۶ میلادی', ['2026']))).toEqual(['۲۰۲۶']);
    expect(marked(highlightSegments('سال 1405', ['۱۴۰۵'.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))]))).toEqual(['1405']);
  });

  it('treats ZWNJ and a space as the same separator', () => {
    // "می‌خواهم" is indexed as the two words "می" and "خواهم" — the query matches both spellings alike
    expect(marked(highlightSegments('می‌خواهم بروم', ['می', 'خواهم']))).toEqual(['می', 'خواهم']);
    expect(marked(highlightSegments('می خواهم', ['می', 'خواهم']))).toEqual(['می', 'خواهم']);
    expect(join(highlightSegments('می‌خواهم', ['می', 'خواهم']))).toBe('می‌خواهم');
  });

  it('only matches at the start of a word (like the prefix tsquery), not inside one', () => {
    expect(marked(highlightSegments('قورمه سبزی', ['ور']))).toEqual([]);
    expect(marked(highlightSegments('قورمه سبزی', ['قور']))).toEqual(['قور']);
  });

  it('merges overlapping hits and handles several tokens', () => {
    const segments = highlightSegments('پایتون پایه', ['پای', 'پایت']);
    expect(marked(segments)).toEqual(['پایت', 'پای']);
    expect(join(segments)).toBe('پایتون پایه');
  });

  it('never produces markup: hostile text stays plain segment text', () => {
    const text = '<img src=x onerror=alert(1)> <script>alert(1)</script> script';
    const segments = highlightSegments(text, ['script']);
    expect(join(segments)).toBe(text);
    expect(segments.every((s) => typeof s.text === 'string' && typeof s.match === 'boolean')).toBe(true);
    expect(marked(segments).every((m) => m === 'script')).toBe(true);
  });

  it('returns one plain segment without tokens or hits, and nothing for empty text', () => {
    expect(highlightSegments('سلام', [])).toEqual([{ text: 'سلام', match: false }]);
    expect(highlightSegments('سلام', ['xyz'])).toEqual([{ text: 'سلام', match: false }]);
    expect(highlightSegments('', ['x'])).toEqual([]);
  });

  it('foldWithMap maps folded characters back to original offsets', () => {
    const { folded, starts, ends } = foldWithMap('كُتاب');
    expect(folded).toBe('کتاب');
    expect(starts[0]).toBe(0);
    expect(ends[0]).toBe(2); // the kaf plus its damma
    expect(findMatchRanges('كُتاب', ['کتاب'])).toEqual([[0, 5]]);
  });

  it('snippet: centred excerpt with separate ellipsis segments, plain start when nothing matches', () => {
    const filler = 'کلمه '.repeat(60);
    const text = `${filler}هدف اصلی این بخش آموزش پایتون است ${filler}`;
    const snippet = snippetSegments(text, ['پایتون'], 120);
    expect(snippet[0]).toEqual({ text: '…', match: false });
    expect(snippet.at(-1)).toEqual({ text: '…', match: false });
    expect(marked(snippet)).toEqual(['پایتون']);
    expect(join(snippet).length).toBeLessThanOrEqual(130);

    const noMatch = snippetSegments(text, ['xyz'], 100);
    expect(join(noMatch).startsWith('کلمه')).toBe(true);
    expect(snippetSegments('کوتاه', ['کو'], 100)).toEqual([
      { text: 'کو', match: true },
      { text: 'تاه', match: false },
    ]);
    expect(snippetSegments('   ', ['a'])).toEqual([]);
  });
});

describe('SQL builders', () => {
  const hostile = `'); DROP TABLE "Video"; --`;
  const query = prepareQuery(hostile)!;
  const plan = (over: Partial<VideoSearchPlan> = {}): VideoSearchPlan => ({
    query,
    mode: 'and',
    filters: { type: 'short', date: 'week', duration: 'medium', categoryId: 'cat_1' },
    sort: 'relevance',
    now: NOW,
    ...over,
  });

  it('prepareQuery keeps only normalized tokens (letters/digits), so nothing injectable reaches to_tsquery', () => {
    expect(query.tokens).toEqual(['drop', 'table', 'video']);
    expect(query.and).toBe('drop:* & table:* & video:*');
    expect(query.or).toBe('drop:* | table:* | video:*');
    expect(`${query.and}${query.or}`).toMatch(/^[\p{L}\p{N}:*&| ]+$/u);
    expect(prepareQuery('   ')).toBeNull();
    expect(prepareQuery('!!! ... ---')).toBeNull();
    expect(prepareQuery('می‌خواهم ۱۲۳')?.tokens).toEqual(['می', 'خواهم', '123']);
  });

  it('binds every user-derived value as a parameter — none appears in the statement text', () => {
    for (const sql of [pageSql(plan(), 20, 40), countSql(plan()), pageSql(plan({ mode: 'fuzzy' }), 20, 0), pageSql(plan({ mode: 'or' }), 20, 0)]) {
      expect(sql.sql).not.toMatch(/drop|DROP TABLE "Video"/i);
      expect(sql.sql).not.toContain('cat_1');
      expect(sql.text).toMatch(/\$\d+/); // PostgreSQL numbered placeholders
      expect(sql.sql.match(/\?/g)?.length).toBe(sql.values.length);
      expect(sql.values).toContain('drop:* & table:* & video:*');
    }
    const fuzzy = pageSql(plan({ mode: 'fuzzy' }), 20, 0);
    expect(fuzzy.values).toContain('drop table video');
    expect(fuzzy.sql).toContain('<%');
  });

  it('every statement carries the public-visibility conditions', () => {
    for (const sql of [pageSql(plan(), 20, 0), countSql(plan()), pageSql(plan({ query: null, mode: 'browse', sort: 'popular' }), 20, 0)]) {
      expect(sql.sql).toContain(`v."processingStatus" = 'READY'`);
      expect(sql.sql).toContain(`v."publishStatus" = 'PUBLISHED'`);
      expect(sql.sql).toContain(`v."visibility" = 'PUBLIC'`);
      expect(sql.sql).toContain('v."takedownAt" IS NULL');
      expect(sql.sql).toContain('c."suspendedAt" IS NULL');
    }
  });

  it('filters become casts / bounds on bound parameters', () => {
    const conditions = filterConditions({ type: 'short', date: 'week', duration: 'medium', categoryId: 'cat_1' }, NOW);
    const text = conditions.map((c) => c.sql).join(' AND ');
    expect(text).toContain('::"VideoKind"');
    expect(text).toContain('::float8');
    const values = conditions.flatMap((c) => c.values);
    expect(values).toEqual(expect.arrayContaining(['SHORT', 240, 1200, 'cat_1']));
    expect(filterConditions({ type: 'all', date: 'any', duration: 'any', categoryId: null }, NOW)).toHaveLength(1);
    expect(filterConditions({ type: 'channel', date: 'any', duration: 'any', categoryId: null }, NOW)).toHaveLength(1);
  });

  it('modes use the right match predicate; browse has none', () => {
    expect(matchCondition('and', query).sql).toContain('q.tq_and');
    expect(matchCondition('or', query).sql).toContain('q.tq_or');
    expect(matchCondition('fuzzy', query).sql).toContain('<%');
    const browse = pageSql(plan({ query: null, mode: 'browse', sort: 'popular' }), 20, 0).sql;
    expect(browse).not.toContain('tq_and');
    expect(browse).not.toContain('@@');
  });

  it('ordering is total (id tie-breaker) and relevance only applies with a query', () => {
    expect(orderSql('relevance', true).sql).toBe('score DESC, v.id ASC');
    expect(orderSql('newest', true).sql).toContain('v.id DESC');
    expect(orderSql('popular', false).sql).toContain('"viewCount" DESC');
    expect(orderSql('popular', false).sql).toContain('v.id DESC');
    expect(orderSql('relevance', false).sql).toContain('"viewCount" DESC'); // no query → popularity
  });

  it('counts are capped and pages are bounded', () => {
    expect(countSql(plan()).values).toContain(COUNT_CAP + 1);
    expect(pageSql(plan(), 20, 40).values).toEqual(expect.arrayContaining([20, 40]));
  });

  it('rank weights sum to 1', () => {
    expect(Object.values(RANK_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('channel matching escapes LIKE wildcards and binds patterns', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    const cond = channelPrefixCondition(prepareQuery('سارا آشپزی')!);
    expect(cond.sql).toContain('LIKE');
    expect(cond.values).toEqual(['سارا%', '% سارا%', 'اشپزی%', '% اشپزی%']);
  });
});
