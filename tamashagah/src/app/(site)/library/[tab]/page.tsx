import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ListVideo, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { PageHeader } from '@/components/page-header';
import { PlaylistCard } from '@/components/channel/playlist-card';
import { requirePageUser } from '@/lib/auth/guards';
import { watchLaterPlaylistId } from '@/lib/ids';
import { labels } from '@/lib/i18n/fa';
import { parsePage } from '@/features/discovery/category';
import { FollowingView } from '@/features/library/components/following-view';
import { HistoryView } from '@/features/library/components/history-view';
import { LibraryTabs } from '@/features/library/components/library-tabs';
import { PlaylistFormDialog } from '@/features/library/components/playlist-form-dialog';
import { LikedView, WatchLaterView } from '@/features/library/components/saved-videos-view';
import { libraryTabTitles } from '@/features/library/labels';
import {
  getFollowingPage,
  getHistoryPage,
  getLikedPage,
  getMyPlaylists,
  getWatchLaterPage,
  getWatchLaterSummary,
  isLibraryTab,
} from '@/features/library/queries';

type Props = {
  params: Promise<{ tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab } = await params;
  return { title: isLibraryTab(tab) ? libraryTabTitles[tab] : 'کتابخانه', robots: { index: false, follow: false } };
}

export default async function LibraryTabPage({ params, searchParams }: Props) {
  const { tab } = await params;
  if (!isLibraryTab(tab)) notFound();
  const user = await requirePageUser(`/library/${tab}`);
  const page = parsePage((await searchParams).page, 200);
  const href = (p: number) => `/library/${tab}${p > 1 ? `?page=${p}` : ''}`;

  let body: React.ReactNode;
  let pageCount = 1;
  let actions: React.ReactNode = null;

  switch (tab) {
    case 'history': {
      const data = await getHistoryPage(user.id, page);
      pageCount = data.pageCount;
      body = <HistoryView items={data.items} total={data.total} />;
      break;
    }
    case 'watch-later': {
      const data = await getWatchLaterPage(user.id, page);
      pageCount = data.pageCount;
      body = <WatchLaterView videos={data.videos} playlistId={watchLaterPlaylistId(user.id)} />;
      break;
    }
    case 'liked': {
      const data = await getLikedPage(user.id, page);
      pageCount = data.pageCount;
      body = <LikedView videos={data.videos} />;
      break;
    }
    case 'following': {
      const data = await getFollowingPage(user.id, page);
      pageCount = data.pageCount;
      body = <FollowingView channels={data.channels} />;
      break;
    }
    case 'playlists': {
      const [playlists, later] = await Promise.all([getMyPlaylists(user.id), getWatchLaterSummary(user.id)]);
      actions = (
        <PlaylistFormDialog>
          <Button shape="pill">
            <Plus /> ساخت لیست پخش
          </Button>
        </PlaylistFormDialog>
      );
      body =
        playlists.length === 0 && later.videoCount === 0 ? (
          <EmptyState
            icon={ListVideo}
            title="هنوز لیست پخشی نساخته‌اید"
            description="با لیست پخش می‌توانید ویدیوهای هم‌موضوع را کنار هم نگه دارید و با دیگران به اشتراک بگذارید."
            action={
              <PlaylistFormDialog>
                <Button shape="pill">
                  <Plus /> ساخت اولین لیست
                </Button>
              </PlaylistFormDialog>
            }
          />
        ) : (
          <ul className="grid gap-x-4 gap-y-8 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
            <li>
              <PlaylistCard id={watchLaterPlaylistId(user.id)} href="/library/watch-later" title="بعداً تماشا می‌کنم" videoCount={later.videoCount} coverUrl={later.coverUrl} badge={labels.visibility.PRIVATE} />
            </li>
            {playlists.map((p) => (
              <li key={p.id}>
                <PlaylistCard id={p.id} title={p.title} description={p.description} videoCount={p.videoCount} coverUrl={p.coverUrl} badge={labels.visibility[p.visibility]} />
              </li>
            ))}
          </ul>
        );
      break;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={libraryTabTitles[tab]} actions={actions} />
      <LibraryTabs active={tab} />
      {body}
      <Pagination page={page} pageCount={pageCount} href={href} className="pt-2" />
    </div>
  );
}
