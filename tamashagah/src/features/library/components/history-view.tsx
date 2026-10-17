'use client';

import { useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { History, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { useFormatter } from '@/components/providers/format-provider';
import { clearHistoryAction, removeHistoryItemAction } from '@/features/library/actions';
import { LibraryVideoItem } from '@/features/library/components/library-video-item';
import type { HistoryItem } from '@/features/library/queries';

const GRID = 'grid gap-x-4 gap-y-8 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]';

/** Watch history: remove single items (optimistic) or clear everything after a confirmation. */
export function HistoryView({ items, total }: { items: HistoryItem[]; total: number }) {
  const f = useFormatter();
  const [visible, removeLocally] = useOptimistic(items, (state, videoId: string) => state.filter((i) => i.video.id !== videoId));
  const [, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function remove(videoId: string) {
    startTransition(async () => {
      removeLocally(videoId);
      const result = await removeHistoryItemAction({ videoId });
      if (result.ok) toast.success('از تاریخچه حذف شد.');
      else toast.error(result.message);
    });
  }

  async function clearAll() {
    const result = await clearHistoryAction();
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success('تاریخچه‌ی تماشا پاک شد.');
    return true;
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="تاریخچه‌ی تماشا خالی است"
        description="ویدیوهایی که تماشا می‌کنید اینجا می‌مانند تا بتوانید دوباره به آن‌ها برگردید و ادامه‌شان بدهید."
        action={
          <Button asChild shape="pill">
            <Link href="/">مرور ویدیوها</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {total > 0 && `${f.number(Math.max(total - (items.length - visible.length), 0))} ویدیو در تاریخچه`}
        </p>
        <Button type="button" variant="outline" size="sm" shape="pill" onClick={() => setConfirmOpen(true)}>
          <Trash2 /> پاک‌کردن تاریخچه
        </Button>
      </div>
      <ul className={GRID}>
        {visible.map((item, i) => (
          <li key={item.video.id}>
            <LibraryVideoItem
              video={item.video}
              progress={item.progress}
              removeLabel="حذف از تاریخچه"
              onRemove={() => remove(item.video.id)}
              priority={i < 4}
            />
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title="تاریخچه‌ی تماشا پاک شود؟"
        description="همه‌ی ویدیوهای تاریخچه‌ی شما حذف می‌شوند و این کار قابل بازگشت نیست. پیشنهادهای صفحه‌ی اصلی هم دیگر از این تاریخچه استفاده نمی‌کنند."
        confirmLabel="پاک‌کردن همه"
        onConfirm={clearAll}
      />
    </div>
  );
}
