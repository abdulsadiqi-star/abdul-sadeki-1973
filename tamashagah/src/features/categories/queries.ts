import 'server-only';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';

export type CategoryItem = { id: string; slug: string; nameFa: string; icon: string | null };

/** Active categories in display order. Cached for 5 minutes (tag: "categories"). */
export const getCategories = unstable_cache(
  async (): Promise<CategoryItem[]> =>
    db.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameFa: 'asc' }],
      select: { id: true, slug: true, nameFa: true, icon: true },
    }),
  ['categories:v1'],
  { revalidate: 300, tags: ['categories'] },
);
