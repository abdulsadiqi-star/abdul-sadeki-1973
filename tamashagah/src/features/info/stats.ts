import 'server-only';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';
import { publicVideoWhere } from '@/features/videos/visibility';

export type AboutStats = {
  videos: number;
  shorts: number;
  channels: number;
  totalViews: number;
  /** True when the catalogue contains demo data (synthetic view events), so the page can say so instead of implying real traffic. */
  hasDemoData: boolean;
};

/**
 * The numbers on the about page: counts of what is PUBLIC right now, computed in the database and cached for five minutes
 * (nothing here is typed in by hand). `hasDemoData` is true when synthetic `ViewEvent`s (`source = 'SEED'`) exist.
 */
export const getAboutStats = unstable_cache(
  async (): Promise<AboutStats> => {
    const [groups, channels, seed] = await Promise.all([
      db.video.groupBy({ by: ['kind'], where: publicVideoWhere, _count: { _all: true }, _sum: { viewCount: true } }),
      db.channel.count({ where: { suspendedAt: null, videos: { some: publicVideoWhere } } }),
      db.viewEvent.findFirst({ where: { source: 'SEED' }, select: { id: true } }),
    ]);
    const stats: AboutStats = { videos: 0, shorts: 0, channels, totalViews: 0, hasDemoData: seed !== null };
    for (const group of groups) {
      if (group.kind === 'VIDEO') stats.videos = group._count._all;
      else stats.shorts = group._count._all;
      stats.totalViews += group._sum.viewCount ?? 0;
    }
    return stats;
  },
  ['info:about-stats:v1'],
  { revalidate: 300, tags: ['videos'] },
);
