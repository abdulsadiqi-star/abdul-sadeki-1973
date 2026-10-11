import 'server-only';
import { db } from '@/lib/db';
import { toVideoCard, videoCardSelect, type VideoCardData } from '@/features/videos/card';
import { publicVideoWhere } from '@/features/videos/visibility';
import { getTrendingVideoIds, getTrendingVideos, hydrateCards } from '@/features/recommendations';

export const CATEGORY_TABS = ['new', 'views', 'hot'] as const;
export type CategoryTab = (typeof CATEGORY_TABS)[number];
export const CATEGORY_PAGE_SIZE = 24;
/** The "hot" tab ranks at most this many videos (4 pages): a trending list has no meaningful tail. */
export const CATEGORY_HOT_LIMIT = 96;

export const categoryTabLabels: Record<CategoryTab, string> = { new: 'جدید', views: 'پربازدید', hot: 'داغ' };

export function parseCategoryTab(value: string | string[] | undefined): CategoryTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (CATEGORY_TABS as readonly string[]).includes(v ?? '') ? (v as CategoryTab) : 'new';
}

export function parsePage(value: string | string[] | undefined, max = 500): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.trunc(n))) : 1;
}

/** Active category by slug (404 for unknown or deactivated ones). Always read from the database, never from a cache. */
export function getActiveCategory(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) return Promise.resolve(null);
  return db.category.findFirst({
    where: { slug, isActive: true },
    select: { id: true, slug: true, nameFa: true, nameEn: true, description: true, icon: true },
  });
}

export type CategoryPage = { videos: VideoCardData[]; total: number; pageCount: number };

/** One page of a category's public videos (regular videos; shorts have their own rail). */
export async function getCategoryPage(categoryId: string, tab: CategoryTab, page: number): Promise<CategoryPage> {
  const where = { ...publicVideoWhere, kind: 'VIDEO' as const, categoryId };
  const total = await db.video.count({ where });

  if (tab === 'hot') {
    const ids = await getTrendingVideoIds({ kind: 'VIDEO', categoryId, limit: CATEGORY_HOT_LIMIT, days: 14 });
    const slice = ids.slice((page - 1) * CATEGORY_PAGE_SIZE, page * CATEGORY_PAGE_SIZE);
    return { videos: await hydrateCards(slice), total: ids.length, pageCount: Math.max(1, Math.ceil(ids.length / CATEGORY_PAGE_SIZE)) };
  }

  const rows = await db.video.findMany({
    where,
    orderBy:
      tab === 'views'
        ? [{ viewCount: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }]
        : [{ publishedAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * CATEGORY_PAGE_SIZE,
    take: CATEGORY_PAGE_SIZE,
    select: videoCardSelect,
  });
  return { videos: rows.map(toVideoCard), total, pageCount: Math.max(1, Math.ceil(total / CATEGORY_PAGE_SIZE)) };
}

export function getCategoryShorts(categoryId: string, limit = 10): Promise<VideoCardData[]> {
  return getTrendingVideos({ kind: 'SHORT', categoryId, limit, days: 14 });
}
