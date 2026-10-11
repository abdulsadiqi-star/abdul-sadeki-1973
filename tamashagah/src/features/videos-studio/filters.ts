/**
 * Pure helpers behind `/studio/videos`: tab / search / filter → Prisma `where`, sort → `orderBy`, and URL building.
 * (No I/O, unit-tested.)
 */
import type { Prisma } from '@/generated/prisma/client';
import { normalizeSearchText } from '@/lib/persian';
import type { StudioSort, StudioTab } from './labels';
import type { StudioListParams } from './schemas';

export const GRID_PAGE_SIZE = 24;
export const LIST_PAGE_SIZE = 20;

export const pageSizeFor = (view: 'grid' | 'list') => (view === 'grid' ? GRID_PAGE_SIZE : LIST_PAGE_SIZE);

/** Each tab is a filter on the three independent state axes (see docs/architecture.md). */
export function tabWhere(tab: StudioTab): Prisma.VideoWhereInput {
  switch (tab) {
    case 'unpublished':
      // Ready to go but not live: processing videos are in "processing", failed ones in "failed".
      return { publishStatus: 'DRAFT', processingStatus: 'READY' };
    case 'scheduled':
      return { publishStatus: 'SCHEDULED' };
    case 'processing':
      return { processingStatus: { in: ['AWAITING_UPLOAD', 'QUEUED', 'PROCESSING'] } };
    case 'failed':
      return { processingStatus: 'FAILED' };
    case 'shorts':
      return { kind: 'SHORT' };
    default:
      return {};
  }
}

export function studioVideoWhere(
  channelId: string,
  params: Pick<StudioListParams, 'tab' | 'q' | 'visibility' | 'category'>,
): Prisma.VideoWhereInput {
  const and: Prisma.VideoWhereInput[] = [tabWhere(params.tab as StudioTab)];
  const needle = normalizeSearchText(params.q);
  if (needle) and.push({ OR: [{ searchTitle: { contains: needle } }, { searchBody: { contains: needle } }] });
  if (params.visibility) and.push({ visibility: params.visibility });
  if (params.category) and.push({ categoryId: params.category });
  return { channelId, AND: and };
}

/** Every ordering ends in `id` so pagination is stable (docs/conventions.md §5b). */
export function studioVideoOrderBy(sort: StudioSort): Prisma.VideoOrderByWithRelationInput[] {
  switch (sort) {
    case 'oldest':
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'views':
      return [{ viewCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
    case 'likes':
      return [{ likeCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

const DEFAULTS: StudioListParams = { tab: 'all', q: '', visibility: undefined, category: undefined, sort: 'newest', view: 'grid', page: 1 };

/** `/studio/videos?tab=failed&page=2` — only values that differ from the defaults are written. */
export function studioListHref(current: Partial<StudioListParams>, overrides: Partial<StudioListParams> = {}): string {
  const merged = { ...DEFAULTS, ...current, ...overrides };
  const query = new URLSearchParams();
  if (merged.tab !== DEFAULTS.tab) query.set('tab', merged.tab);
  if (merged.q) query.set('q', merged.q);
  if (merged.visibility) query.set('visibility', merged.visibility);
  if (merged.category) query.set('category', merged.category);
  if (merged.sort !== DEFAULTS.sort) query.set('sort', merged.sort);
  if (merged.view !== DEFAULTS.view) query.set('view', merged.view);
  if (merged.page > 1) query.set('page', String(merged.page));
  const text = query.toString();
  return text ? `/studio/videos?${text}` : '/studio/videos';
}
