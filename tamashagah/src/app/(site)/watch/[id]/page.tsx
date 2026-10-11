import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { Eye, Info, Lock, ShieldAlert, Clock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { VideoPlayer } from '@/components/player';
import { getCurrentUser, toActor } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { getFormatter } from '@/lib/format-server';
import { isVideoId } from '@/lib/ids';
import { parseTimeParam } from '@/components/player/player-utils';
import { cn } from '@/lib/utils';
import { getViewerState } from '@/features/engagement/service';
import { LikeButton } from '@/features/engagement/components/like-button';
import { SaveButton } from '@/features/engagement/components/save-button';
import { ShareButton } from '@/features/engagement/components/share-button';
import { PlaylistMenu } from '@/features/engagement/components/playlist-menu';
import { ReportVideoButton } from '@/features/reports/components/report-video-button';
import { CommentSection, CommentsSkeleton } from '@/features/comments/components/comment-section';
import { getCommentPage } from '@/features/comments/queries';
import { buildVideoJsonLd, buildVideoMetadata, hiddenVideoMetadata, jsonLdString } from '@/features/watch/metadata';
import { getProcessingInfo, getResumePosition, getWatchVideo, type WatchVideo } from '@/features/watch/queries';
import { ChannelRow } from '@/features/watch/components/channel-row';
import { ExpandableDescription } from '@/features/watch/components/expandable-description';
import { LinkifiedText } from '@/features/watch/components/linkified-text';
import { ProcessingPanel } from '@/features/watch/components/processing-panel';
import { RelatedVideos, RelatedVideosSkeleton } from '@/features/watch/components/related-videos';
import { hashtagSearchHref } from '@/features/watch/linkify';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const video = isVideoId(id) ? await getWatchVideo(id) : null;
  return video ? buildVideoMetadata(video, env.APP_URL) : hiddenVideoMetadata;
}

/** Notices for the people who can see a video that is not (fully) public: the owner and moderators. */
function staffNotices(video: WatchVideo): Array<{ key: string; variant: 'warning' | 'info' | 'destructive'; icon: React.ReactNode; text: string }> {
  if (!video.access.isOwner && !video.access.isModerator) return [];
  const notices: ReturnType<typeof staffNotices> = [];
  const who = video.access.isOwner ? 'شما' : 'شما (به‌عنوان ناظر)';
  if (video.takedownAt) {
    notices.push({
      key: 'takedown',
      variant: 'destructive',
      icon: <ShieldAlert />,
      text: `این ویدیو توسط تیم نظارت مسدود شده و برای بیننده‌های دیگر نمایش داده نمی‌شود${video.takedownReason ? `؛ دلیل: ${video.takedownReason}` : '.'}`,
    });
  }
  if (video.publishStatus === 'DRAFT') notices.push({ key: 'draft', variant: 'warning', icon: <Eye />, text: `این ویدیو هنوز منتشر نشده است و فقط ${who} آن را می‌بینید.` });
  else if (video.publishStatus === 'SCHEDULED') notices.push({ key: 'scheduled', variant: 'warning', icon: <Clock />, text: `انتشار این ویدیو زمان‌بندی شده است و تا آن زمان فقط ${who} آن را می‌بینید.` });
  else if (video.visibility === 'PRIVATE') notices.push({ key: 'private', variant: 'info', icon: <Lock />, text: `این ویدیو خصوصی است و فقط ${who} آن را می‌بینید.` });
  else if (video.visibility === 'UNLISTED') notices.push({ key: 'unlisted', variant: 'info', icon: <Info />, text: 'این ویدیو «فقط با لینک» است: در جستجو و فهرست‌ها دیده نمی‌شود، ولی هر کسی لینک را داشته باشد می‌تواند ببیند.' });
  return notices;
}

export default async function WatchPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!isVideoId(id)) notFound();
  const video = await getWatchVideo(id);
  if (!video) notFound(); // private, draft, taken down, unfinished or unknown: indistinguishable on purpose

  const rawStart = (await searchParams).t;
  const startAt = parseTimeParam(Array.isArray(rawStart) ? rawStart[0] : rawStart);
  const [user, f] = await Promise.all([getCurrentUser(), getFormatter()]);
  const [viewerState, resume, processing] = await Promise.all([
    getViewerState(user?.id ?? null, video.id, video.channel.id),
    getResumePosition(user?.id ?? null, video.id, video.durationSeconds),
    video.processingStatus === 'READY' ? Promise.resolve(null) : getProcessingInfo(video.id),
  ]);

  const playable = video.processingStatus === 'READY';
  const canEdit = video.access.isOwner || video.access.isModerator;
  const studioHref = `/studio/videos/${video.id}/edit`;
  const jsonLd = buildVideoJsonLd(video, env.APP_URL);
  const portrait = !!video.width && !!video.height && video.height > video.width;
  const aspect = video.width && video.height ? `${video.width} / ${video.height}` : '16 / 9';

  return (
    <div className="mx-auto w-full max-w-[100rem]">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
          {/* Player (sticky under the header on phones and tablets so it stays visible while reading / commenting). */}
          <div className="sticky top-(--header-height) z-30 -mx-3 bg-black sm:-mx-6 lg:static lg:mx-0 lg:overflow-hidden lg:rounded-xl">
            {playable ? (
              <div
                className={cn('mx-auto w-full', portrait && 'max-w-[calc(78dvh*var(--ratio))]')}
                style={{ aspectRatio: portrait ? aspect : '16 / 9', ...(portrait ? { '--ratio': `${video.width! / video.height!}` } : {}) } as React.CSSProperties}
              >
                <VideoPlayer
                  key={video.id}
                  videoId={video.id}
                  title={video.title}
                  src={video.hlsUrl}
                  poster={video.posterUrl}
                  durationSeconds={video.durationSeconds}
                  subtitles={video.subtitles}
                  startAt={startAt}
                  resume={resume}
                  signedIn={!!user}
                  autoPlay
                  className="aspect-auto size-full rounded-none sm:rounded-none"
                />
              </div>
            ) : processing ? (
              <ProcessingPanel
                videoId={video.id}
                initial={{ processingStatus: video.processingStatus, progress: processing.progress, stage: processing.stage, failureReason: video.failureReason ?? processing.error }}
                editHref={studioHref}
              />
            ) : null}
          </div>

          {staffNotices(video).map((notice) => (
            <Alert key={notice.key} variant={notice.variant}>
              {notice.icon}
              <AlertDescription className="text-foreground">{notice.text}</AlertDescription>
            </Alert>
          ))}

          <h1 dir="auto" className="user-text text-lg leading-8 font-bold sm:text-xl">
            {video.title}
          </h1>

          <ChannelRow
            channel={video.channel}
            initialFollowing={viewerState.following}
            signedIn={!!user}
            isOwner={video.access.isOwner}
            studioHref={canEdit ? studioHref : undefined}
          />

          {playable && (
            <div role="toolbar" aria-label="اقدام‌های ویدیو" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-hide sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">
              <LikeButton videoId={video.id} initialLiked={viewerState.liked} initialCount={video.likeCount} signedIn={!!user} />
              <ShareButton videoId={video.id} title={video.title} />
              <SaveButton videoId={video.id} initialSaved={viewerState.saved} signedIn={!!user} />
              <PlaylistMenu videoId={video.id} signedIn={!!user} />
              <ReportVideoButton videoId={video.id} signedIn={!!user} verified={user?.emailVerified ?? false} isOwner={video.access.isOwner} />
            </div>
          )}

          <section aria-label="درباره‌ی این ویدیو" className="rounded-xl bg-muted/60 p-3 sm:p-4">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold" suppressHydrationWarning>
              <span data-testid="view-count">{f.views(video.viewCount)}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={video.publishedAt}>{f.date(video.publishedAt, 'long')}</time>
              {video.category && (
                <>
                  <span aria-hidden="true">·</span>
                  <Link href={`/category/${video.category.slug}` as Route} className="text-primary hover:underline">
                    {video.category.nameFa}
                  </Link>
                </>
              )}
            </p>
            {video.description.trim() ? (
              <div className="mt-2">
                <ExpandableDescription id="video-description">
                  <LinkifiedText text={video.description} />
                </ExpandableDescription>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">برای این ویدیو توضیحاتی نوشته نشده است.</p>
            )}
            {video.tags.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="برچسب‌ها">
                {video.tags.map((tag) => (
                  <li key={tag}>
                    <Link href={hashtagSearchHref(tag) as Route} className="inline-block rounded-full bg-background px-3 py-1 text-xs transition-colors hover:bg-accent focus-visible:bg-accent" dir="auto">
                      #{tag}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {playable && (
            <Suspense fallback={<CommentsSkeleton />}>
              <Comments video={video} />
            </Suspense>
          )}
        </div>

        {playable && (
          <aside aria-labelledby="related-heading" className="min-w-0">
            <h2 id="related-heading" className="mb-3 text-base font-bold">
              ویدیوهای مرتبط
            </h2>
            <Suspense fallback={<RelatedVideosSkeleton />}>
              <RelatedVideos videoId={video.id} viewerId={user?.id ?? null} />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  );
}

/** Streams in after the main content: the first page of comments for this viewer. */
async function Comments({ video }: { video: WatchVideo }) {
  const user = await getCurrentUser();
  const page = await getCommentPage(video.id, toActor(user));
  return (
    <CommentSection
      videoId={video.id}
      initialPage={page}
      viewer={user ? { id: user.id, name: user.channel?.name ?? user.displayName, avatarUrl: user.avatarUrl } : null}
      verified={user?.emailVerified ?? false}
      commentsMode={video.commentsMode}
      commentsEnabled={video.commentsEnabled}
      viewerIsOwner={video.access.isOwner}
    />
  );
}
