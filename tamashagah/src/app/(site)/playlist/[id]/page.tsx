import { cache } from 'react';
import Link from 'next/link';
import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Info, ListVideo, Play } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { PosterImage } from '@/components/video/video-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { getCurrentUser } from '@/lib/auth/session';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import { parsePage } from '@/features/discovery/category';
import { PlaylistItems } from '@/features/library/components/playlist-items';
import { PlaylistOwnerActions } from '@/features/library/components/playlist-owner-actions';
import { PLAYLIST_PAGE_SIZE, getPlaylistView } from '@/features/library/queries';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const load = cache(async (id: string, page: number) => {
  const user = await getCurrentUser();
  return { user, view: await getPlaylistView(id, user ? { id: user.id, channelId: user.channel?.id ?? null } : null, page) };
});

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const { view } = await load(id, parsePage((await searchParams).page, 200));
  if (!view) return { title: 'لیست پخش پیدا نشد', robots: { index: false } };
  return {
    title: view.title,
    description: view.description || `لیست پخش «${view.title}» در تماشاگاه`,
    // only public lists belong in search engines; unlisted/private ones are reachable by link / owner only
    robots: view.visibility === 'PUBLIC' ? undefined : { index: false, follow: false },
    alternates: { canonical: `/playlist/${view.id}` },
  };
}

export default async function PlaylistPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = parsePage((await searchParams).page, 200);
  const { view } = await load(id, page);
  // 404 for "does not exist" AND "private and not yours": the two are indistinguishable on purpose
  if (!view) notFound();
  if (view.kind === 'WATCH_LATER') redirect('/library/watch-later');

  const f = await getFormatter();
  const first = view.items[0]?.video;
  const startIndex = (page - 1) * PLAYLIST_PAGE_SIZE + 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-5 sm:flex-row">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-2xl bg-muted sm:w-80">
          <PosterImage src={view.coverUrl} priority />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 dir="auto" className="user-text text-2xl font-extrabold">
              {view.title}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground" suppressHydrationWarning>
              {view.owner.channel ? (
                <Link href={`/channel/${view.owner.channel.handle}` as Route} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <ChannelAvatar name={view.owner.channel.name} src={view.owner.channel.avatarUrl} size="xs" />
                  <span dir="auto">{view.owner.channel.name}</span>
                  {view.owner.channel.isVerified && <VerifiedBadge className="size-3.5" />}
                </Link>
              ) : (
                <span dir="auto">{view.owner.displayName}</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{f.count(view.total, 'ویدیو')}</span>
              <span aria-hidden="true">·</span>
              <span>به‌روزرسانی {f.relative(view.updatedAt)}</span>
              {view.isOwner && (
                <Badge variant={view.visibility === 'PUBLIC' ? 'success' : 'muted'} className="ms-1">
                  {labels.visibility[view.visibility]}
                </Badge>
              )}
            </p>
          </div>
          {view.description && (
            <p dir="auto" className="user-text text-sm leading-7 whitespace-pre-line text-muted-foreground">
              {view.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {first && (
              <Button asChild shape="pill">
                <Link href={(first.kind === 'SHORT' ? `/shorts?v=${first.id}` : `/watch/${first.id}?list=${view.id}`) as Route}>
                  <Play className="fill-current" /> پخش همه
                </Link>
              </Button>
            )}
            {view.isOwner && <PlaylistOwnerActions playlist={{ id: view.id, title: view.title, description: view.description, visibility: view.visibility }} />}
          </div>
        </div>
      </header>

      {view.isOwner && view.unavailable > 0 && (
        <Alert variant="info">
          <Info />
          <AlertDescription>
            {f.count(view.unavailable, 'ویدیو')} از این لیست دیگر در دسترس نیست (خصوصی، حذف‌شده یا در حال بررسی) و نمایش داده نمی‌شود.
          </AlertDescription>
        </Alert>
      )}

      {view.items.length === 0 ? (
        <EmptyState
          icon={ListVideo}
          title="این لیست ویدیوی قابل نمایشی ندارد"
          description={view.isOwner ? 'ویدیوها را از صفحه‌ی هر ویدیو به این لیست اضافه کنید.' : 'سازنده‌ی لیست هنوز ویدیویی به آن اضافه نکرده است.'}
        />
      ) : (
        <section aria-label="ویدیوهای لیست">
          <PlaylistItems playlistId={view.id} items={view.items} isOwner={view.isOwner} startIndex={startIndex} />
        </section>
      )}

      <Pagination page={page} pageCount={view.pageCount} href={(p) => `/playlist/${view.id}${p > 1 ? `?page=${p}` : ''}`} />
    </div>
  );
}
