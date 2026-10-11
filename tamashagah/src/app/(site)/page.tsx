import Link from 'next/link';
import type { Route } from 'next';
import { Clapperboard, Flame, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
import { EmptyState } from '@/components/empty-state';
import { SectionHeading, VideoGrid } from '@/components/video/video-grid';
import { db } from '@/lib/db';
import { getCategories } from '@/features/categories/queries';
import { toVideoCard, videoCardSelect } from '@/features/videos/card';
import { publicVideoWhere } from '@/features/videos/visibility';

export const metadata = { title: 'خانه' };
// Cheap and always fresh for now; the discovery feature adds caching/personalization.
export const dynamic = 'force-dynamic';

/**
 * Home page. NOTE: this is the foundation version (latest + most viewed); the
 * discovery feature replaces the data sources with the recommendation engine.
 */
export default async function HomePage() {
  const [categories, latest, popular] = await Promise.all([
    getCategories(),
    db.video.findMany({
      where: { ...publicVideoWhere, kind: 'VIDEO' },
      orderBy: { publishedAt: 'desc' },
      take: 12,
      select: videoCardSelect,
    }),
    db.video.findMany({
      where: { ...publicVideoWhere, kind: 'VIDEO' },
      orderBy: { viewCount: 'desc' },
      take: 8,
      select: videoCardSelect,
    }),
  ]);

  return (
    <div className="space-y-10">
      {categories.length > 0 && (
        <nav aria-label="دسته‌بندی‌ها" className="scrollbar-hide -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
          <Button asChild size="sm" shape="pill" className="shrink-0">
            <Link href="/">همه</Link>
          </Button>
          {categories.map((c) => (
            <Button key={c.id} asChild size="sm" shape="pill" variant="secondary" className="shrink-0">
              <Link href={`/category/${c.slug}` as Route}>
                <CategoryIcon name={c.icon} />
                {c.nameFa}
              </Link>
            </Button>
          ))}
        </nav>
      )}

      {latest.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="هنوز ویدیویی منتشر نشده است"
          description="اولین ویدیو را شما بارگذاری کنید یا کمی بعد دوباره سر بزنید."
          action={
            <Button asChild shape="pill">
              <Link href="/studio/upload">بارگذاری ویدیو</Link>
            </Button>
          }
        />
      ) : (
        <>
          <section aria-labelledby="latest-heading">
            <SectionHeading title="تازه‌ترین ویدیوها" icon={<Sparkles className="size-5 text-primary" aria-hidden="true" />} />
            <h2 id="latest-heading" className="sr-only">
              تازه‌ترین ویدیوها
            </h2>
            <VideoGrid videos={latest.map(toVideoCard)} />
          </section>
          {popular.length > 0 && (
            <section>
              <SectionHeading title="پربازدیدترین‌ها" icon={<Flame className="size-5 text-primary" aria-hidden="true" />} />
              <VideoGrid videos={popular.map(toVideoCard)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
