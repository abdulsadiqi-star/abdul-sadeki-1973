import { describe, expect, it } from 'vitest';
import { computePublishUpdate, decidePublishOnReady } from '@/features/videos-studio/publishing';
import { studioListHref, studioVideoOrderBy, studioVideoWhere, tabWhere } from '@/features/videos-studio/filters';
import { bulkVideosSchema, studioListParamsSchema, updateVideoSchema, videoMetadataSchema } from '@/features/videos-studio/schemas';

const NOW = new Date('2026-10-11T10:00:00Z');
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe('publish decision when processing finishes', () => {
  it('publishOnReady publishes now; a draft stays a draft', () => {
    expect(decidePublishOnReady({ publishOnReady: true, scheduledFor: null }, NOW)).toEqual({ publishStatus: 'PUBLISHED', publishedAt: NOW, scheduledFor: null });
    expect(decidePublishOnReady({ publishOnReady: false, scheduledFor: null }, NOW)).toEqual({ publishStatus: 'DRAFT', publishedAt: null, scheduledFor: null });
  });

  it('a future schedule wins over publishOnReady; a past schedule publishes immediately', () => {
    const future = minutes(90);
    expect(decidePublishOnReady({ publishOnReady: true, scheduledFor: future }, NOW)).toEqual({ publishStatus: 'SCHEDULED', publishedAt: null, scheduledFor: future });
    expect(decidePublishOnReady({ publishOnReady: false, scheduledFor: minutes(-1) }, NOW)).toEqual({ publishStatus: 'PUBLISHED', publishedAt: NOW, scheduledFor: null });
    // exactly now counts as due
    expect(decidePublishOnReady({ publishOnReady: false, scheduledFor: NOW }, NOW).publishStatus).toBe('PUBLISHED');
  });
});

describe('studio publish requests', () => {
  const ready = (publishStatus: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED', publishedAt: Date | null = null) => ({ processingStatus: 'READY' as const, publishStatus, publishedAt });
  const processing = { processingStatus: 'PROCESSING' as const, publishStatus: 'DRAFT' as const, publishedAt: null };

  it('READY: publish, keep the original publish date, unpublish, schedule', () => {
    const published = computePublishUpdate(ready('DRAFT'), { mode: 'PUBLISH' }, NOW);
    expect(published).toEqual({ publishOnReady: true, scheduledFor: null, publishStatus: 'PUBLISHED', publishedAt: NOW, becamePublished: true });

    const earlier = new Date('2026-01-01T00:00:00Z');
    const again = computePublishUpdate(ready('PUBLISHED', earlier), { mode: 'PUBLISH' }, NOW);
    expect(again).toMatchObject({ publishStatus: 'PUBLISHED', publishedAt: earlier, becamePublished: false });

    expect(computePublishUpdate(ready('PUBLISHED', earlier), { mode: 'DRAFT' }, NOW)).toEqual({
      publishOnReady: false, scheduledFor: null, publishStatus: 'DRAFT', publishedAt: null, becamePublished: false,
    });
    const at = minutes(120);
    expect(computePublishUpdate(ready('DRAFT'), { mode: 'SCHEDULE', scheduledFor: at }, NOW)).toEqual({
      publishOnReady: false, scheduledFor: at, publishStatus: 'SCHEDULED', publishedAt: null, becamePublished: false,
    });
    // publishing a scheduled video publishes it now and clears the schedule
    expect(computePublishUpdate(ready('SCHEDULED'), { mode: 'PUBLISH' }, NOW)).toMatchObject({ publishStatus: 'PUBLISHED', scheduledFor: null, becamePublished: true });
  });

  it('not READY yet: only the intent is recorded, nothing goes live', () => {
    expect(computePublishUpdate(processing, { mode: 'PUBLISH' }, NOW)).toEqual({
      publishOnReady: true, scheduledFor: null, publishStatus: 'DRAFT', publishedAt: null, becamePublished: false,
    });
    expect(computePublishUpdate(processing, { mode: 'DRAFT' }, NOW)).toMatchObject({ publishOnReady: false, publishStatus: 'DRAFT' });
    const at = minutes(30);
    expect(computePublishUpdate(processing, { mode: 'SCHEDULE', scheduledFor: at }, NOW)).toMatchObject({ publishStatus: 'SCHEDULED', scheduledFor: at, becamePublished: false });
  });

  it('a schedule needs a time', () => {
    expect(() => computePublishUpdate(processing, { mode: 'SCHEDULE' }, NOW)).toThrow();
  });
});

describe('video list filters', () => {
  it('maps every tab onto the three state axes', () => {
    expect(tabWhere('all')).toEqual({});
    expect(tabWhere('unpublished')).toEqual({ publishStatus: 'DRAFT', processingStatus: 'READY' });
    expect(tabWhere('scheduled')).toEqual({ publishStatus: 'SCHEDULED' });
    expect(tabWhere('processing')).toEqual({ processingStatus: { in: ['AWAITING_UPLOAD', 'QUEUED', 'PROCESSING'] } });
    expect(tabWhere('failed')).toEqual({ processingStatus: 'FAILED' });
    expect(tabWhere('shorts')).toEqual({ kind: 'SHORT' });
  });

  it('always scopes by channel and normalizes the search text like the index', () => {
    const where = studioVideoWhere('chan1', { tab: 'all', q: 'كتاب ي', visibility: 'PRIVATE', category: 'cat12345678' });
    expect(where.channelId).toBe('chan1');
    expect(where.AND).toEqual([
      {},
      { OR: [{ searchTitle: { contains: 'کتاب ی' } }, { searchBody: { contains: 'کتاب ی' } }] },
      { visibility: 'PRIVATE' },
      { categoryId: 'cat12345678' },
    ]);
    expect(studioVideoWhere('c', { tab: 'all', q: '   ', visibility: undefined, category: undefined }).AND).toEqual([{}]);
  });

  it('every ordering ends with the id (stable pagination)', () => {
    for (const sort of ['newest', 'oldest', 'views', 'likes'] as const) {
      expect(studioVideoOrderBy(sort).at(-1)).toHaveProperty('id');
    }
  });

  it('builds URLs with only the non-default values', () => {
    expect(studioListHref({})).toBe('/studio/videos');
    expect(studioListHref({ tab: 'failed', page: 3 })).toBe('/studio/videos?tab=failed&page=3');
    expect(studioListHref({ tab: 'failed', page: 3 }, { page: 1 })).toBe('/studio/videos?tab=failed');
    expect(studioListHref({ q: 'ویدیو', view: 'list', sort: 'views' })).toBe(`/studio/videos?q=${encodeURIComponent('ویدیو')}&sort=views&view=list`);
  });

  it('parses query parameters leniently: junk falls back to defaults instead of erroring the page', () => {
    expect(studioListParamsSchema.parse({})).toMatchObject({ tab: 'all', q: '', sort: 'newest', view: 'grid', page: 1 });
    expect(studioListParamsSchema.parse({ tab: 'hax', sort: 'drop table', view: 'x', page: '-4', visibility: 'secret', category: 'x' })).toMatchObject({
      tab: 'all', sort: 'newest', view: 'grid', page: 1, visibility: undefined, category: undefined,
    });
    expect(studioListParamsSchema.parse({ tab: 'failed', page: '3', q: '  ي  ' })).toMatchObject({ tab: 'failed', page: 3, q: 'ی' });
  });
});

describe('metadata schema', () => {
  const base = { title: '  عنوان   ویدیو ', visibility: 'PUBLIC' as const };

  it('normalizes text and applies defaults', () => {
    const parsed = videoMetadataSchema.parse({ ...base, description: 'خط ۱\r\n\r\n\r\nخط ۲', tags: ['#ایران', 'ایران', ' سفر ', ''] });
    expect(parsed).toMatchObject({
      title: 'عنوان ویدیو',
      description: 'خط ۱\n\nخط ۲',
      tags: ['ایران', 'سفر'],
      publishMode: 'PUBLISH',
      commentsEnabled: true,
      kindChoice: 'auto',
      categoryId: null,
    });
    expect(parsed.ageRestricted).toBeUndefined();
    expect(parsed.language).toBeUndefined();
  });

  it('enforces the documented limits with Persian messages', () => {
    const fail = (input: unknown) => {
      const r = videoMetadataSchema.safeParse(input);
      return r.success ? null : r.error.issues[0]!.message;
    };
    expect(fail({ ...base, title: '   ' })).toMatch(/[؀-ۿ]/);
    expect(fail({ ...base, title: 'ا'.repeat(101) })).toContain('۱۰۰');
    expect(fail({ ...base, description: 'ا'.repeat(5001) })).toContain('۵۰۰۰');
    expect(fail({ ...base, visibility: 'SECRET' })).toBeTruthy();
    expect(fail({ ...base, language: 'xx' })).toContain('زبان');
    expect(fail({ ...base, publishMode: 'SCHEDULE' })).toContain('زمان‌بندی');
    expect(fail({ ...base, publishMode: 'SCHEDULE', scheduledFor: 'not a date' })).toBeTruthy();
    expect(fail({ ...base, tags: Array.from({ length: 41 }, (_, i) => `t${i}`) })).toBeTruthy();
  });

  it('caps tags at 15 of 32 characters after normalization', () => {
    const parsed = videoMetadataSchema.parse({ ...base, tags: Array.from({ length: 30 }, (_, i) => `برچسب${i}`.padEnd(40, 'x')) });
    expect(parsed.tags).toHaveLength(15);
    expect(parsed.tags.every((t) => t.length <= 32)).toBe(true);
  });

  it('parses schedules into instants and validates the id of update requests', () => {
    const parsed = videoMetadataSchema.parse({ ...base, publishMode: 'SCHEDULE', scheduledFor: '2026-12-01T10:30:00.000Z' });
    expect(parsed.scheduledFor).toEqual(new Date('2026-12-01T10:30:00.000Z'));
    expect(updateVideoSchema.safeParse({ id: 'short', metadata: base }).success).toBe(false);
    expect(updateVideoSchema.safeParse({ id: 'aB3dE5gH7jK', metadata: base }).success).toBe(true);
  });
});

describe('bulk request schema', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `aB3dE5gH7j${String.fromCharCode(65 + (i % 26))}`);

  it('accepts the three operations and bounds the batch', () => {
    expect(bulkVideosSchema.safeParse({ action: 'publish', ids: ids(3) }).success).toBe(true);
    expect(bulkVideosSchema.safeParse({ action: 'delete', ids: ids(50) }).success).toBe(true);
    expect(bulkVideosSchema.safeParse({ action: 'visibility', ids: ids(2), visibility: 'PRIVATE' }).success).toBe(true);
    expect(bulkVideosSchema.safeParse({ action: 'delete', ids: ids(51) }).success).toBe(false);
    expect(bulkVideosSchema.safeParse({ action: 'delete', ids: [] }).success).toBe(false);
    expect(bulkVideosSchema.safeParse({ action: 'visibility', ids: ids(1) }).success).toBe(false);
    expect(bulkVideosSchema.safeParse({ action: 'ban', ids: ids(1) }).success).toBe(false);
    expect(bulkVideosSchema.safeParse({ action: 'delete', ids: ['not-a-video-id'] }).success).toBe(false);
  });
});
