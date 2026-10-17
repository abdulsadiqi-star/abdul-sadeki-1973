import Link from 'next/link';
import { Film, Plus, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { VideoFilterBar } from '@/components/studio/video-filter-bar';
import { VideoLibrary } from '@/components/studio/video-library';
import { VideoTabsNav } from '@/components/studio/video-tabs-nav';
import { requirePageChannelUser } from '@/lib/auth/guards';
import { getFormatter } from '@/lib/format-server';
import { getCategories } from '@/features/categories/queries';
import { studioListHref } from '@/features/videos-studio/filters';
import { studioTabs } from '@/features/videos-studio/labels';
import { listStudioVideos } from '@/features/videos-studio/queries';
import { studioListParamsSchema } from '@/features/videos-studio/schemas';

export const metadata = { title: 'ویدیوهای من' };
export const dynamic = 'force-dynamic';

export default async function StudioVideosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageChannelUser('/studio/videos');
  const params = studioListParamsSchema.parse(await searchParams);
  const [data, categories, f] = await Promise.all([listStudioVideos(user.channel.id, params), getCategories(), getFormatter()]);

  const filtering = Boolean(params.q || params.visibility || params.category);
  const tabLabel = studioTabs.find((tab) => tab.value === params.tab)?.label ?? '';
  const firstShown = (data.page - 1) * data.pageSize + 1;

  return (
    <>
      <PageHeader
        title="ویدیوهای من"
        description="ویدیوهای کانال را ببینید، ویرایش کنید، منتشر کنید یا حذف کنید."
        actions={
          <Button asChild shape="pill">
            <Link href="/studio/upload">
              <Plus /> بارگذاری ویدیو
            </Link>
          </Button>
        }
      />

      <div className="space-y-4">
        <VideoTabsNav params={params} counts={data.counts} />
        <VideoFilterBar params={params} categories={categories.map((category) => ({ id: category.id, nameFa: category.nameFa }))} />

        {data.items.length === 0 ? (
          data.counts.all === 0 ? (
            <EmptyState
              icon={Film}
              title="هنوز ویدیویی بارگذاری نکرده‌اید"
              description="اولین ویدیوی خود را بارگذاری کنید تا اینجا نمایش داده شود و بتوانید آن را مدیریت کنید."
              action={
                <Button asChild shape="pill">
                  <Link href="/studio/upload">
                    <Plus /> بارگذاری اولین ویدیو
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="ویدیویی پیدا نشد"
              description={filtering ? 'با این جستجو و فیلترها ویدیویی وجود ندارد. فیلترها را تغییر دهید یا پاک کنید.' : `در بخش «${tabLabel}» ویدیویی وجود ندارد.`}
              action={
                <Button asChild variant="outline">
                  <Link href="/studio/videos">نمایش همه‌ی ویدیوها</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <p className="text-sm text-muted-foreground" data-testid="results-summary">
              {data.total > data.pageSize
                ? `نمایش ${f.number(firstShown)} تا ${f.number(firstShown + data.items.length - 1)} از ${f.number(data.total)} ویدیو`
                : `${f.number(data.total)} ویدیو`}
            </p>
            <VideoLibrary items={data.items} view={params.view} showUploadTile={data.page === 1 && !filtering && params.tab === 'all'} />
            <Pagination page={data.page} pageCount={data.pageCount} href={(page) => studioListHref(params, { page })} className="pt-2" />
          </>
        )}
      </div>
    </>
  );
}
