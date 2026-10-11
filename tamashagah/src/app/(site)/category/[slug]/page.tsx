import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { Clapperboard, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { ShortsRail } from '@/components/shorts/shorts-rail';
import { VideoGrid } from '@/components/video/video-grid';
import { env } from '@/lib/env';
import { getFormatter } from '@/lib/format-server';
import { getCategories } from '@/features/categories/queries';
import {
  CATEGORY_TABS,
  categoryTabLabels,
  getActiveCategory,
  getCategoryPage,
  getCategoryShorts,
  parseCategoryTab,
  parsePage,
} from '@/features/discovery/category';
import { CategoryChips } from '@/features/discovery/components/category-chips';
import { JsonLd } from '@/features/discovery/components/json-ld';
import { siteConfig } from '@/config/site';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const hrefFor = (slug: string, tab: string, page: number) => {
  const qs = new URLSearchParams();
  if (tab !== 'new') qs.set('tab', tab);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return `/category/${slug}${s ? `?${s}` : ''}`;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getActiveCategory(slug);
  if (!category) return { title: 'دسته‌بندی پیدا نشد', robots: { index: false } };
  const sp = await searchParams;
  const tab = parseCategoryTab(sp.tab);
  const page = parsePage(sp.page);
  return {
    title: `ویدیوهای ${category.nameFa}`,
    description: category.description || `تازه‌ترین، پربازدیدترین و داغ‌ترین ویدیوهای دسته‌ی «${category.nameFa}» در ${siteConfig.name}.`,
    alternates: { canonical: hrefFor(slug, tab, page) },
    openGraph: { title: `ویدیوهای ${category.nameFa} | ${siteConfig.name}`, type: 'website' },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const category = await getActiveCategory(slug);
  if (!category) notFound();

  const sp = await searchParams;
  const tab = parseCategoryTab(sp.tab);
  const page = parsePage(sp.page);
  const [categories, result, shorts, f] = await Promise.all([
    getCategories(),
    getCategoryPage(category.id, tab, page),
    page === 1 ? getCategoryShorts(category.id) : Promise.resolve([]),
    getFormatter(),
  ]);
  const base = env.APP_URL.replace(/\/$/, '');

  return (
    <div className="space-y-6">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: siteConfig.name, item: base },
            { '@type': 'ListItem', position: 2, name: category.nameFa, item: `${base}/category/${category.slug}` },
          ],
        }}
      />
      <CategoryChips categories={categories} active={category.slug} />

      <header className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-sm">
          <CategoryIcon name={category.icon} className="size-7" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">{category.nameFa}</h1>
          <p className="text-sm text-muted-foreground">
            {f.count(result.total, 'ویدیو')}
            {category.description ? <span> · {category.description}</span> : null}
          </p>
        </div>
      </header>

      <nav aria-label="مرتب‌سازی ویدیوها" className="flex gap-2">
        {CATEGORY_TABS.map((t) => (
          <Button key={t} asChild size="sm" shape="pill" variant={tab === t ? 'default' : 'secondary'}>
            <Link href={hrefFor(category.slug, t, 1) as Route} aria-current={tab === t ? 'page' : undefined}>
              {categoryTabLabels[t]}
            </Link>
          </Button>
        ))}
      </nav>

      {shorts.length > 0 && (
        <section aria-labelledby="category-shorts">
          <h2 id="category-shorts" className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Zap className="size-5 text-primary" aria-hidden="true" /> شورتس {category.nameFa}
          </h2>
          <ShortsRail videos={shorts} label={`شورتس ${category.nameFa}`} />
        </section>
      )}

      {result.videos.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="هنوز ویدیویی در این دسته منتشر نشده است"
          description="اولین ویدیوی این دسته را شما بارگذاری کنید یا به دسته‌های دیگر سر بزنید."
          action={
            <Button asChild shape="pill">
              <Link href="/studio/upload">بارگذاری ویدیو</Link>
            </Button>
          }
        />
      ) : (
        <section aria-label="ویدیوها">
          <VideoGrid videos={result.videos} priorityCount={4} />
        </section>
      )}

      <Pagination page={page} pageCount={result.pageCount} href={(p) => hrefFor(category.slug, tab, p)} className="pt-2" />
    </div>
  );
}
