import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { Info, SearchX } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { ChannelResultCard } from '@/components/search/channel-result-card';
import { SearchFilters } from '@/components/search/search-filters';
import { SearchResultItem } from '@/components/search/search-result-item';
import { ShortCard } from '@/components/shorts/short-card';
import { SectionHeading, VideoGrid } from '@/components/video/video-grid';
import { getFormatter } from '@/lib/format-server';
import { getCategories } from '@/features/categories/queries';
import { socialMetadata } from '@/features/discovery/seo';
import { getTrendingVideos } from '@/features/recommendations';
import { searchTypeLabels } from '@/features/search/labels';
import { searchChannels, searchVideos } from '@/features/search/queries';
import {
  SEARCH_CHANNEL_PAGE_SIZE,
  SEARCH_TYPES,
  defaultSortFor,
  hasActiveFilters,
  parseSearchState,
  searchHref,
  type SearchParams,
} from '@/features/search/schemas';
import { COUNT_CAP, prepareQuery } from '@/features/search/sql';
import { cn } from '@/lib/utils';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = parseSearchState(await searchParams);
  const parameterized = p.q !== '' || hasActiveFilters(p) || p.page > 1 || p.sort !== defaultSortFor(p.q !== '');
  const title = p.q ? `نتایج جستجو برای «${p.q}»` : 'جستجو و پرطرفدارها';
  const description = 'در تماشاگاه ویدیو، شورتس و کانال‌ها را جستجو کنید؛ با فیلتر تاریخ، مدت و دسته‌بندی.';
  return {
    title,
    description,
    // Result pages carry parameters: keep them out of the index (robots.txt disallows them too) but let links be followed.
    robots: parameterized ? { index: false, follow: true } : undefined,
    ...socialMetadata({ title, description, path: '/search' }),
  };
}

function heading(params: SearchParams, browsing: boolean): string {
  if (!browsing) return `نتایج جستجو برای «${params.q}»`;
  if (params.type === 'channel') return 'کانال‌های پرطرفدار';
  if (params.type === 'short') return 'شورتس‌های پرطرفدار';
  return 'پرطرفدارترین‌ها';
}

export default async function SearchPage({ searchParams }: Props) {
  const parsed = parseSearchState(await searchParams);
  const [categories, f] = await Promise.all([getCategories(), getFormatter()]);
  const category = parsed.category ? categories.find((c) => c.slug === parsed.category) : undefined;
  const params: SearchParams = { ...parsed, category: category?.slug ?? null };

  const query = params.q ? prepareQuery(params.q) : null;
  const browsing = query === null;
  const onlyChannels = params.type === 'channel';
  const wantChannels = onlyChannels || (params.type === 'all' && !browsing && params.page === 1);

  const [videoResult, channelResult] = await Promise.all([
    onlyChannels ? null : searchVideos(params, { categoryId: category?.id ?? null }),
    wantChannels
      ? searchChannels(browsing ? '' : params.q, {
          limit: onlyChannels ? SEARCH_CHANNEL_PAGE_SIZE : 3,
          page: onlyChannels ? params.page : 1,
        })
      : null,
  ]);

  const videos = videoResult?.videos ?? [];
  const channels = channelResult?.channels ?? [];
  const nothingFound = videos.length === 0 && channels.length === 0;
  const popular = nothingFound ? await getTrendingVideos({ kind: 'VIDEO', limit: 8 }) : [];

  const total = onlyChannels ? (channelResult?.total ?? 0) : (videoResult?.total ?? 0);
  const pageCount = onlyChannels ? Math.max(1, Math.ceil(total / SEARCH_CHANNEL_PAGE_SIZE)) : (videoResult?.pageCount ?? 1);
  const capped = !onlyChannels && (videoResult?.capped ?? false);
  const countLabel = capped ? `بیش از ${f.number(COUNT_CAP)} نتیجه` : `${f.number(total)} نتیجه`;
  const href = (page: number) => searchHref(params, { page });
  const clearedFilters = searchHref(params, { type: 'all', date: 'any', duration: 'any', category: null });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">
          {browsing ? (
            heading(params, true)
          ) : (
            <>
              نتایج جستجو برای <bdi dir="auto">«{params.q}»</bdi>
            </>
          )}
        </h1>
        {browsing && !onlyChannels && (
          <p className="mt-1 text-sm text-muted-foreground">پربازدیدترین ویدیوهای تماشاگاه؛ با فیلترها می‌توانید فهرست را محدود کنید.</p>
        )}
      </div>

      <nav aria-label="نوع نتیجه" className="scrollbar-hide -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {SEARCH_TYPES.map((type) => (
          <Button key={type} asChild size="sm" shape="pill" variant={params.type === type ? 'default' : 'secondary'} className="shrink-0">
            <Link href={searchHref(params, { type }) as Route} aria-current={params.type === type ? 'page' : undefined}>
              {searchTypeLabels[type]}
            </Link>
          </Button>
        ))}
      </nav>

      <SearchFilters params={params} categories={categories} />

      {!nothingFound && (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {countLabel}
        </p>
      )}

      {videoResult && videoResult.mode === 'or' && (
        <Alert variant="info">
          <Info />
          <AlertDescription>نتیجه‌ای که همه‌ی کلمه‌ها را داشته باشد کم بود؛ ویدیوهایی که شامل برخی از کلمه‌ها هستند هم نمایش داده می‌شوند.</AlertDescription>
        </Alert>
      )}
      {videoResult && videoResult.mode === 'fuzzy' && (
        <Alert variant="info">
          <Info />
          <AlertDescription>نتیجه‌ی دقیقی پیدا نشد؛ ویدیوهایی با نوشتار نزدیک به «{params.q}» هم نمایش داده می‌شوند.</AlertDescription>
        </Alert>
      )}

      {channels.length > 0 && (
        <section aria-label="کانال‌ها">
          <SectionHeading title="کانال‌ها" />
          <ul className={cn('grid gap-3', onlyChannels ? 'sm:grid-cols-2' : 'grid-cols-1')}>
            {channels.map((channel) => (
              <li key={channel.id}>
                <ChannelResultCard channel={channel} />
              </li>
            ))}
          </ul>
          {!onlyChannels && channelResult && (channelResult.hasMore || channelResult.total > channels.length) && (
            <div className="mt-3">
              <Button asChild variant="outline" size="sm" shape="pill">
                <Link href={searchHref(params, { type: 'channel' }) as Route}>نمایش همه‌ی کانال‌ها ({f.number(channelResult.total)})</Link>
              </Button>
            </div>
          )}
        </section>
      )}

      {videos.length > 0 && (
        <section aria-label={params.type === 'short' ? 'شورتس' : 'ویدیوها'}>
          {channels.length > 0 ? (
            <SectionHeading title={params.type === 'short' ? 'شورتس' : 'ویدیوها'} />
          ) : (
            <h2 className="sr-only">{params.type === 'short' ? 'شورتس' : 'ویدیوها'}</h2>
          )}
          {!browsing ? (
            <ol className="space-y-5">
              {videos.map((result, i) => (
                <li key={result.card.id}>
                  <SearchResultItem result={result} priority={i < 3} />
                </li>
              ))}
            </ol>
          ) : params.type === 'short' ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
              {videos.map((result, i) => (
                <li key={result.card.id}>
                  <ShortCard video={result.card} priority={i < 6} />
                </li>
              ))}
            </ul>
          ) : (
            <VideoGrid videos={videos.map((r) => r.card)} />
          )}
        </section>
      )}

      {nothingFound && (
        <div className="space-y-8">
          <EmptyState
            icon={SearchX}
            title={browsing ? 'هنوز موردی برای نمایش نیست' : `نتیجه‌ای برای «${params.q}» پیدا نشد`}
            description={
              browsing
                ? 'با این فیلترها ویدیویی وجود ندارد. فیلترها را تغییر دهید.'
                : 'املای کلمه‌ها را بررسی کنید، از کلمه‌های کمتر یا کلی‌تر استفاده کنید یا فیلترها را بردارید.'
            }
            action={
              hasActiveFilters(params) ? (
                <Button asChild variant="outline" shape="pill">
                  <Link href={clearedFilters as Route}>برداشتن فیلترها</Link>
                </Button>
              ) : undefined
            }
          />
          {categories.length > 0 && (
            <section aria-labelledby="browse-categories">
              <h2 id="browse-categories" className="mb-3 text-base font-bold">
                مرور بر اساس دسته‌بندی
              </h2>
              <ul className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <li key={c.id}>
                    <Button asChild size="sm" shape="pill" variant="secondary">
                      <Link href={`/category/${c.slug}` as Route}>{c.nameFa}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {popular.length > 0 && (
            <section aria-labelledby="popular-heading">
              <h2 id="popular-heading" className="mb-4 text-lg font-bold">
                ویدیوهای پرطرفدار
              </h2>
              <VideoGrid videos={popular} priorityCount={0} />
            </section>
          )}
        </div>
      )}

      <Pagination page={onlyChannels ? params.page : (videoResult?.page ?? 1)} pageCount={pageCount} href={href} className="pt-4" />
    </div>
  );
}
