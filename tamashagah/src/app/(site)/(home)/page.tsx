import Link from 'next/link';
import type { Route } from 'next';
import type { Metadata } from 'next';
import { Clapperboard, Flame, History, Sparkles, Users, Wand2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
import { EmptyState } from '@/components/empty-state';
import { ShortsRail } from '@/components/shorts/shorts-rail';
import { VideoGrid } from '@/components/video/video-grid';
import { siteConfig } from '@/config/site';
import { getCurrentUser } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { getCategories } from '@/features/categories/queries';
import { CategoryChips } from '@/features/discovery/components/category-chips';
import { HomeSection } from '@/features/discovery/components/home-section';
import { JsonLd } from '@/features/discovery/components/json-ld';
import { VideoRail } from '@/features/discovery/components/video-rail';
import { ServiceWorkerRegister } from '@/features/info/components/service-worker-register';
import { getHomeFeed } from '@/features/recommendations';

// The default title ("تماشاگاه — …") comes from the root layout.
export const metadata: Metadata = { alternates: { canonical: '/' } };

const seeAll = (href: string, label = 'مشاهده‌ی همه') => (
  <Button asChild variant="ghost" size="sm" className="shrink-0 text-primary">
    <Link href={href as Route}>{label}</Link>
  </Button>
);

/**
 * Home. Personalized sections only appear for logged-in viewers who have something to show; visitors get
 * trending / latest / shorts / category rows. Non-personalized rankings are cached (ids only) — see getHomeFeed.
 */
export default async function HomePage() {
  const [user, categories] = await Promise.all([getCurrentUser(), getCategories()]);
  const feed = await getHomeFeed(user?.id);

  const hasContent = feed.latest.length > 0 || feed.trending.length > 0 || feed.shorts.length > 0 || feed.continueWatching.length > 0;
  const base = env.APP_URL.replace(/\/$/, '');

  return (
    <div className="space-y-10">
      <ServiceWorkerRegister />
      <h1 className="sr-only">{siteConfig.name} — {siteConfig.tagline}</h1>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: siteConfig.name,
          url: base,
          inLanguage: 'fa-IR',
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${base}/search?q={search_term_string}` },
            'query-input': 'required name=search_term_string',
          },
        }}
      />
      <CategoryChips categories={categories} active={null} />

      {!hasContent ? (
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
          {feed.continueWatching.length > 0 && (
            <HomeSection
              id="continue"
              title="ادامه‌ی تماشا"
              icon={<History className="size-5 text-primary" aria-hidden="true" />}
              action={seeAll('/library/history', 'تاریخچه')}
            >
              <VideoRail label="ادامه‌ی تماشا" videos={feed.continueWatching} priorityCount={3} />
            </HomeSection>
          )}

          {feed.fromFollowed.length > 0 && (
            <HomeSection
              id="followed"
              title="از کانال‌های دنبال‌شده"
              icon={<Users className="size-5 text-primary" aria-hidden="true" />}
              action={seeAll('/library/following', 'کانال‌های من')}
            >
              <VideoRail label="از کانال‌های دنبال‌شده" videos={feed.fromFollowed} />
            </HomeSection>
          )}

          {feed.forYou.length > 0 && (
            <HomeSection
              id="for-you"
              title="پیشنهاد برای شما"
              icon={<Wand2 className="size-5 text-primary" aria-hidden="true" />}
              hint="بر اساس تاریخچه‌ی تماشا، ویدیوهای پسندیده و کانال‌هایی که دنبال می‌کنید"
            >
              <VideoRail label="پیشنهاد برای شما" videos={feed.forYou} />
            </HomeSection>
          )}

          {feed.trending.length > 0 && (
            <HomeSection
              id="trending"
              title="داغ‌ترین‌ها"
              icon={<Flame className="size-5 text-primary" aria-hidden="true" />}
              hint="پرتماشاترین‌ها و پسندیده‌ترین‌های این هفته"
              action={seeAll('/search?sort=popular', 'پرطرفدارها')}
            >
              <VideoRail label="داغ‌ترین‌ها" videos={feed.trending} priorityCount={user ? 0 : 3} />
            </HomeSection>
          )}

          {feed.latest.length > 0 && (
            <HomeSection id="latest" title="جدیدترین‌ها" icon={<Sparkles className="size-5 text-primary" aria-hidden="true" />}>
              <VideoGrid videos={feed.latest} priorityCount={0} />
            </HomeSection>
          )}

          {feed.shorts.length > 0 && (
            <HomeSection
              id="shorts"
              title="شورتس"
              icon={<Zap className="size-5 text-primary" aria-hidden="true" />}
              action={seeAll('/shorts', 'تماشای شورتس')}
            >
              <ShortsRail videos={feed.shorts} />
            </HomeSection>
          )}

          {feed.categoryRows.map((row) => (
            <HomeSection
              key={row.category.id}
              id={`category-${row.category.slug}`}
              title={row.category.nameFa}
              icon={<CategoryIcon name={row.category.icon} className="size-5 text-primary" />}
              action={seeAll(`/category/${row.category.slug}`)}
            >
              <VideoRail label={row.category.nameFa} videos={row.videos} />
            </HomeSection>
          ))}
        </>
      )}
    </div>
  );
}
