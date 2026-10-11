import { notFound } from 'next/navigation';
import { isVideoId } from '@/lib/ids';
import { getWatchVideo } from '@/features/watch/queries';

/**
 * Gate for everything under /watch/[id].
 *
 * The visibility rule (private, draft, scheduled, taken-down, unfinished or unknown videos are all "not found")
 * runs HERE and not only in page.tsx: page.tsx sits behind loading.tsx's Suspense boundary, so by the time it ran
 * the response would already be streaming with status 200. A layout renders before that boundary, which makes
 * hidden videos answer with a real HTTP 404. `getWatchVideo` is memoized per request, so the page, the metadata
 * and this gate share a single database query.
 */
export default async function WatchLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isVideoId(id) || !(await getWatchVideo(id))) notFound();
  return children;
}
