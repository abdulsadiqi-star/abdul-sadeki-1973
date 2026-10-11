import { cache } from 'react';
import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { Clapperboard, ListVideo, ShieldAlert, Zap } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { ChannelAbout } from '@/components/channel/channel-about';
import { ChannelHeader } from '@/components/channel/channel-header';
import { ChannelTabs } from '@/components/channel/channel-tabs';
import { PlaylistCard } from '@/components/channel/playlist-card';
import { ShortCard } from '@/components/shorts/short-card';
import { VideoGrid } from '@/components/video/video-grid';
import { siteConfig } from '@/config/site';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { isModerator, ownsChannel } from '@/lib/permissions';
import { truncate } from '@/lib/persian';
import {
  CHANNEL_SORTS,
  channelSortLabels,
  getChannelByHandle,
  getChannelPlaylists,
  getChannelStats,
  getChannelVideos,
  parseChannelSort,
  parseChannelTab,
  type ChannelSort,
  type ChannelTab,
} from '@/features/channels/queries';
import { parsePage } from '@/features/discovery/category';
import { JsonLd } from '@/features/discovery/components/json-ld';

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The channel a visitor may see. A suspended channel is a plain 404 for the public (never "forbidden"); its owner and
 * moderators still get the page so they can see what happened.
 */
const loadVisibleChannel = cache(async (handle: string) => {
  const channel = await getChannelByHandle(handle);
  if (!channel) return null;
  if (channel.suspended) {
    const actor = toActor(await getCurrentUser());
    if (!ownsChannel(actor, channel.id) && !isModerator(actor)) return null;
  }
  return channel;
});

const channelHref = (handle: string, tab: ChannelTab, sort: ChannelSort, page: number) => {
  const qs = new URLSearchParams();
  if (tab !== 'videos') qs.set('tab', tab);
  if (sort !== 'new' && (tab === 'videos' || tab === 'shorts')) qs.set('sort', sort);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return `/channel/${handle}${s ? `?${s}` : ''}`;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { handle } = await params;
  const channel = await loadVisibleChannel(handle);
  if (!channel) return { title: 'کانال پیدا نشد', robots: { index: false } };
  const sp = await searchParams;
  const tab = parseChannelTab(sp.tab);
  const description = channel.description
    ? truncate(channel.description.replace(/\s+/g, ' '), 160)
    : `کانال «${channel.name}» در ${siteConfig.name}؛ ویدیوها، شورتس و لیست‌های پخش.`;
  return {
    title: channel.name,
    description,
    alternates: { canonical: channelHref(channel.handle, tab, parseChannelSort(sp.sort), parsePage(sp.page)) },
    robots: channel.suspended ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'website',
      title: `${channel.name} | ${siteConfig.name}`,
      description,
      images: channel.avatarUrl ? [{ url: channel.avatarUrl }] : undefined,
    },
    twitter: { card: 'summary', title: channel.name, description },
  };
}

export default async function ChannelPage({ params, searchParams }: Props) {
  const { handle } = await params;
  const channel = await loadVisibleChannel(handle);
  if (!channel) notFound();

  const sp = await searchParams;
  const tab = parseChannelTab(sp.tab);
  const sort = parseChannelSort(sp.sort);
  const page = parsePage(sp.page);

  const user = await getCurrentUser();
  const isOwner = ownsChannel(toActor(user), channel.id);
  const [stats, follow] = await Promise.all([
    getChannelStats(channel.id),
    user && !isOwner ? db.follow.findUnique({ where: { userId_channelId: { userId: user.id, channelId: channel.id } }, select: { userId: true } }) : null,
  ]);
  const base = env.APP_URL.replace(/\/$/, '');
  const url = `${base}/channel/${channel.handle}`;

  const sortNav = (
    <nav aria-label="مرتب‌سازی" className="flex gap-2">
      {CHANNEL_SORTS.map((s) => (
        <Button key={s} asChild size="sm" shape="pill" variant={sort === s ? 'default' : 'secondary'}>
          <Link href={channelHref(channel.handle, tab, s, 1) as Route} aria-current={sort === s ? 'true' : undefined}>
            {channelSortLabels[s]}
          </Link>
        </Button>
      ))}
    </nav>
  );

  let content: React.ReactNode = null;
  if (channel.suspended) {
    content = (
      <Alert variant="warning">
        <ShieldAlert />
        <AlertDescription>
          این کانال تعلیق شده است و برای عموم نمایش داده نمی‌شود؛ ویدیوهای آن هم در هیچ فهرستی دیده نمی‌شوند.
        </AlertDescription>
      </Alert>
    );
  } else if (tab === 'videos' || tab === 'shorts') {
    const kind = tab === 'videos' ? 'VIDEO' : 'SHORT';
    const result = await getChannelVideos(channel.id, { kind, sort, page });
    content =
      result.videos.length === 0 ? (
        <EmptyState
          icon={tab === 'videos' ? Clapperboard : Zap}
          title={tab === 'videos' ? 'این کانال هنوز ویدیویی منتشر نکرده است' : 'این کانال هنوز شورتسی منتشر نکرده است'}
          description={isOwner ? 'اولین ویدیوی خود را بارگذاری کنید تا اینجا نمایش داده شود.' : 'بعداً دوباره سر بزنید یا کانال را دنبال کنید تا از انتشار ویدیوی تازه باخبر شوید.'}
          action={
            isOwner ? (
              <Button asChild shape="pill">
                <Link href="/studio/upload">بارگذاری ویدیو</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {sortNav}
          {tab === 'videos' ? (
            <VideoGrid videos={result.videos} hideChannel priorityCount={4} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
              {result.videos.map((video, i) => (
                <li key={video.id}>
                  <ShortCard video={video} priority={i < 6} />
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} pageCount={result.pageCount} href={(p) => channelHref(channel.handle, tab, sort, p)} className="pt-2" />
        </div>
      );
  } else if (tab === 'playlists') {
    const playlists = await getChannelPlaylists(channel.ownerId);
    content =
      playlists.length === 0 ? (
        <EmptyState icon={ListVideo} title="لیست پخش عمومی وجود ندارد" description="این کانال هنوز لیست پخش عمومی نساخته است." />
      ) : (
        <ul className="grid gap-x-4 gap-y-8 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
          {playlists.map((p) => (
            <li key={p.id}>
              <PlaylistCard {...p} />
            </li>
          ))}
        </ul>
      );
  } else {
    content = <ChannelAbout channel={channel} stats={stats} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: channel.name,
          url,
          description: channel.description ? truncate(channel.description.replace(/\s+/g, ' '), 300) : undefined,
          logo: channel.avatarUrl ? `${base}${channel.avatarUrl}` : undefined,
          image: channel.bannerUrl ? `${base}${channel.bannerUrl}` : undefined,
          sameAs: channel.links.map((l) => l.url),
        }}
      />
      <ChannelHeader
        channel={{
          id: channel.id,
          handle: channel.handle,
          name: channel.name,
          avatarUrl: channel.avatarUrl,
          bannerUrl: channel.bannerUrl,
          isVerified: channel.isVerified,
          followerCount: channel.followerCount,
          videoCount: stats.videoCount,
          totalViews: stats.totalViews,
        }}
        signedIn={!!user}
        isOwner={isOwner}
        following={!!follow}
      />
      {!channel.suspended && <ChannelTabs handle={channel.handle} active={tab} />}
      <div className="pb-4">{content}</div>
    </div>
  );
}
