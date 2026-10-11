import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="در حال بارگذاری دیدگاه‌ها">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          {[28, 32, 26, 20].map((w, i) => (
            <Skeleton key={i} className="h-9 rounded-full" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        <Skeleton className="h-9 w-40 rounded-full" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 rounded-xl border bg-card p-4">
            <Skeleton className="mt-1.5 size-4 rounded-[5px]" />
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="hidden aspect-video w-28 rounded-md md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
