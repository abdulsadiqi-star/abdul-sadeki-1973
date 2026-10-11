import { Eye, TrendingUp, Users, Video } from 'lucide-react';
import { StatCard } from '@/components/stat-card';
import { StatCell } from '@/components/studio/stat-cell';
import { SampleChip } from '@/components/analytics/seed-data-notice';
import { getFormatter } from '@/lib/format-server';
import type { DashboardData } from '@/features/studio/types';

/**
 * The four headline numbers (reference order, right to left): videos · followers · total views · today's views.
 * Views come from ViewEvent rows; a figure that includes synthetic SEED rows carries a "sample" marker.
 */
export async function DashboardStats({ data, showSample }: { data: DashboardData; showSample: boolean }) {
  const f = await getFormatter();
  const { counts, sample } = data;
  return (
    <section aria-label="آمار کلی کانال" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCell id="videos">
        <StatCard label="ویدیوهای شما" icon={Video} value={f.number(counts.videos)} hint={counts.videos > 0 ? `${f.number(counts.published)} منتشرشده` : undefined} />
      </StatCell>
      <StatCell id="followers">
        <StatCard label="دنبال‌کنندگان" icon={Users} value={f.number(counts.followers)} />
      </StatCell>
      <StatCell id="total-views">
        <StatCard label="بازدید ویدیوها" icon={Eye} value={f.number(counts.totalViews)} badge={showSample && sample.totalViews.seed > 0 ? <SampleChip /> : undefined} />
      </StatCell>
      <StatCell id="today-views">
        <StatCard label="بازدید امروز" icon={TrendingUp} value={f.number(counts.todayViews)} badge={showSample && sample.todayViews.seed > 0 ? <SampleChip /> : undefined} />
      </StatCell>
    </section>
  );
}
