import { Skeleton } from '@/components/ui/skeleton';

/** Loading placeholders of the studio video routes (shown by `loading.tsx` while the server renders). */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

export function UploadSkeleton() {
  return (
    <div role="status" aria-label="در حال بارگذاری صفحه" className="space-y-6">
      <PageHeaderSkeleton />
      <Skeleton className="h-64 w-full rounded-2xl" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function VideosSkeleton() {
  return (
    <div role="status" aria-label="در حال بارگذاری ویدیوها" className="space-y-4">
      <PageHeaderSkeleton />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditSkeleton() {
  return (
    <div role="status" aria-label="در حال بارگذاری ویدیو" className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <div className="space-y-5">
          <Skeleton className="aspect-video rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
