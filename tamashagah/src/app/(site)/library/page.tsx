import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { Bookmark, History, Library, ListVideo, ThumbsUp, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PlaylistCard } from '@/components/channel/playlist-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { requirePageUser } from '@/lib/auth/guards';
import { labels } from '@/lib/i18n/fa';
import { HomeSection } from '@/features/discovery/components/home-section';
import { VideoRail } from '@/features/discovery/components/video-rail';
import { LibraryTabs } from '@/features/library/components/library-tabs';
import { getLibraryOverview } from '@/features/library/queries';

export const metadata: Metadata = { title: 'کتابخانه‌ی من', robots: { index: false, follow: false } };

const more = (href: string, label = 'مشاهده‌ی همه') => (
  <Button asChild variant="ghost" size="sm" className="shrink-0 text-primary">
    <Link href={href as Route}>{label}</Link>
  </Button>
);

/** Overview: the latest few items of every section, each with a link to its full page. */
export default async function LibraryPage() {
  const user = await requirePageUser('/library');
  const o = await getLibraryOverview(user.id);
  const empty =
    o.history.total === 0 && o.watchLater.total === 0 && o.liked.total === 0 && o.following.total === 0 && o.playlists.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader title="کتابخانه‌ی من" description="تاریخچه، ذخیره‌ها، پسندها، کانال‌ها و لیست‌های پخش شما یک‌جا." />
      <LibraryTabs active="overview" />

      {empty ? (
        <EmptyState
          icon={Library}
          title="کتابخانه‌ی شما هنوز خالی است"
          description="هر ویدیویی که تماشا، ذخیره یا بپسندید و هر کانالی که دنبال کنید اینجا جمع می‌شود."
          action={
            <Button asChild shape="pill">
              <Link href="/">مرور ویدیوها</Link>
            </Button>
          }
        />
      ) : (
        <>
          {o.history.items.length > 0 && (
            <HomeSection id="lib-history" title="تاریخچه‌ی تماشا" icon={<History className="size-5 text-primary" aria-hidden="true" />} action={more('/library/history')}>
              <VideoRail label="تاریخچه‌ی تماشا" videos={o.history.items.map((i) => ({ ...i.video, progress: i.progress }))} />
            </HomeSection>
          )}
          {o.watchLater.videos.length > 0 && (
            <HomeSection id="lib-later" title="بعداً تماشا می‌کنم" icon={<Bookmark className="size-5 text-primary" aria-hidden="true" />} action={more('/library/watch-later')}>
              <VideoRail label="بعداً تماشا می‌کنم" videos={o.watchLater.videos} />
            </HomeSection>
          )}
          {o.liked.videos.length > 0 && (
            <HomeSection id="lib-liked" title="ویدیوهای پسندیده" icon={<ThumbsUp className="size-5 text-primary" aria-hidden="true" />} action={more('/library/liked')}>
              <VideoRail label="ویدیوهای پسندیده" videos={o.liked.videos} />
            </HomeSection>
          )}
          {o.following.channels.length > 0 && (
            <HomeSection id="lib-following" title="کانال‌های دنبال‌شده" icon={<Users className="size-5 text-primary" aria-hidden="true" />} action={more('/library/following')}>
              <ul className="flex flex-wrap gap-2">
                {o.following.channels.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/channel/${c.handle}` as Route}
                      className="flex items-center gap-2 rounded-full border bg-card py-1 ps-1 pe-3 text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <ChannelAvatar name={c.name} src={c.avatarUrl} size="sm" />
                      <span dir="auto" className="max-w-40 truncate">
                        {c.name}
                      </span>
                      {c.isVerified && <VerifiedBadge className="size-3.5" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </HomeSection>
          )}
          {o.playlists.length > 0 && (
            <HomeSection id="lib-playlists" title="لیست‌های پخش" icon={<ListVideo className="size-5 text-primary" aria-hidden="true" />} action={more('/library/playlists')}>
              <ul className="grid gap-x-4 gap-y-8 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
                {o.playlists.slice(0, 4).map((p) => (
                  <li key={p.id}>
                    <PlaylistCard id={p.id} title={p.title} description={p.description} videoCount={p.videoCount} coverUrl={p.coverUrl} badge={labels.visibility[p.visibility]} />
                  </li>
                ))}
              </ul>
            </HomeSection>
          )}
        </>
      )}
    </div>
  );
}
