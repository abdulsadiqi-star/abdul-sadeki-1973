'use client';

import { useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bookmark, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { removeFromPlaylistAction } from '@/features/library/actions';
import { LibraryVideoItem } from '@/features/library/components/library-video-item';
import type { VideoCardData } from '@/features/videos/card';

const GRID = 'grid gap-x-4 gap-y-8 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]';

/** "Watch later": remove a video from the list (optimistic). `playlistId` is the system list of the signed-in user. */
export function WatchLaterView({ videos, playlistId }: { videos: VideoCardData[]; playlistId: string }) {
  const [visible, removeLocally] = useOptimistic(videos, (state, videoId: string) => state.filter((v) => v.id !== videoId));
  const [, startTransition] = useTransition();

  function remove(videoId: string) {
    startTransition(async () => {
      removeLocally(videoId);
      const result = await removeFromPlaylistAction({ playlistId, videoId });
      if (result.ok) toast.success('از «بعداً تماشا می‌کنم» حذف شد.');
      else toast.error(result.message);
    });
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Bookmark}
        title="لیست «بعداً تماشا می‌کنم» خالی است"
        description="روی دکمه‌ی «ذخیره» زیر هر ویدیو بزنید تا برای بعد در همین‌جا بماند."
        action={
          <Button asChild shape="pill">
            <Link href="/search?sort=popular">پیدا کردن ویدیو</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className={GRID}>
      {visible.map((video, i) => (
        <li key={video.id}>
          <LibraryVideoItem video={video} removeLabel="حذف از بعداً تماشا می‌کنم" onRemove={() => remove(video.id)} priority={i < 4} />
        </li>
      ))}
    </ul>
  );
}

/** Liked videos: a plain grid (unliking happens on the watch page). */
export function LikedView({ videos }: { videos: VideoCardData[] }): ReactNode {
  if (videos.length === 0) {
    return (
      <EmptyState
        icon={ThumbsUp}
        title="هنوز ویدیویی را نپسندیده‌اید"
        description="ویدیوهایی را که می‌پسندید اینجا جمع می‌شوند تا هر وقت خواستید دوباره سراغشان بروید."
        action={
          <Button asChild shape="pill">
            <Link href="/">مرور ویدیوها</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className={GRID}>
      {videos.map((video, i) => (
        <li key={video.id}>
          <LibraryVideoItem video={video} priority={i < 4} />
        </li>
      ))}
    </ul>
  );
}
