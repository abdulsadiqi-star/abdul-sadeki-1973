import { Skeleton } from '@/components/ui/skeleton';

/** Same footprint as the feed (full height, centred 9:16 column on desktop) so nothing shifts when it arrives. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="در حال بارگذاری شورتس"
      className="-mx-3 -mt-4 flex h-[calc(100dvh-var(--header-height)-4rem)] items-center justify-center sm:-mx-6 sm:-mt-6 lg:mx-0 lg:h-[calc(100dvh-var(--header-height))]"
    >
      <Skeleton className="h-full max-w-full aspect-[9/16] rounded-none lg:rounded-2xl" />
    </div>
  );
}
