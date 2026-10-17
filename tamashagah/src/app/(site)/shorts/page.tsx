import Link from 'next/link';
import type { Metadata } from 'next';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ShortsFeed } from '@/components/shorts/shorts-feed';
import { getCurrentUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { VIDEO_ID_REGEX } from '@/lib/ids';
import { hlsMasterUrl, mediaUrl } from '@/lib/media-url';
import { JsonLd } from '@/features/discovery/components/json-ld';
import { getShortsPage } from '@/features/discovery/shorts';
import { videoObjectJsonLd } from '@/features/discovery/video-object';
import { linkableVideoWhere, publicVideoWhere } from '@/features/videos/visibility';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const deepLinkId = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return v && VIDEO_ID_REGEX.test(v) ? v : null;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const id = deepLinkId((await searchParams).v);
  const base: Metadata = { title: 'شورتس', description: 'ویدیوهای کوتاه عمودی؛ با یک کشیدن انگشت به ویدیوی بعدی بروید.' };
  if (!id) return base;
  const short = await db.video.findFirst({
    where: { ...linkableVideoWhere, id, kind: 'SHORT' },
    select: { title: true, posterKey: true },
  });
  if (!short) return base;
  return {
    title: short.title,
    description: base.description,
    // the watch page is the canonical home of every video; this feed is just another way to open it
    alternates: { canonical: `/watch/${id}` },
    openGraph: { title: short.title, type: 'video.other', images: short.posterKey ? [{ url: mediaUrl(short.posterKey)! }] : undefined },
  };
}

export default async function ShortsPage({ searchParams }: Props) {
  const firstId = deepLinkId((await searchParams).v);
  const user = await getCurrentUser();
  const page = await getShortsPage({ userId: user?.id ?? null, channelId: user?.channel?.id ?? null, firstId });

  if (page.items.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <h1 className="sr-only">شورتس</h1>
        <EmptyState
          icon={Zap}
          title="هنوز شورتسی منتشر نشده است"
          description="ویدیوهای کوتاه عمودی به‌محض انتشار اینجا نمایش داده می‌شوند. شما هم می‌توانید اولین شورت را بارگذاری کنید."
          action={
            <Button asChild shape="pill">
              <Link href="/studio/upload">بارگذاری ویدیو</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // A deep link to a PUBLIC short carries VideoObject structured data (unlisted shorts are reachable by link but not indexable).
  const pinned = firstId
    ? await db.video.findFirst({
        where: { ...publicVideoWhere, id: firstId, kind: 'SHORT' },
        select: {
          id: true,
          title: true,
          description: true,
          posterKey: true,
          hlsMasterKey: true,
          publishedAt: true,
          createdAt: true,
          durationSeconds: true,
          viewCount: true,
          channel: { select: { name: true, handle: true } },
        },
      })
    : null;

  return (
    <>
      {pinned && (
        <JsonLd
          data={videoObjectJsonLd({
            base: env.APP_URL.replace(/\/$/, ''),
            id: pinned.id,
            title: pinned.title,
            description: pinned.description,
            posterUrl: mediaUrl(pinned.posterKey),
            hlsUrl: pinned.hlsMasterKey ? hlsMasterUrl(pinned.id) : null,
            uploadDate: pinned.publishedAt ?? pinned.createdAt,
            durationSeconds: pinned.durationSeconds,
            viewCount: pinned.viewCount,
            channel: pinned.channel,
          })}
        />
      )}
      <ShortsFeed initialItems={page.items} initialCursor={page.nextCursor} signedIn={!!user} />
    </>
  );
}
