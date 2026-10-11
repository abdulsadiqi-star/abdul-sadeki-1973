'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Globe, Link2, Loader2, Lock, Plus, Radio, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useFormatter } from '@/components/providers/format-provider';
import { bulkVideosAction, deleteVideoAction, retryProcessingAction } from '@/features/videos-studio/actions';
import { isInFlight, useVideoStatuses } from '@/features/videos-studio/client/use-video-statuses';
import { studioMessages } from '@/features/videos-studio/labels';
import type { StudioVideoItem } from '@/features/videos-studio/queries';
import { labels } from '@/lib/i18n/fa';
import type { Visibility } from '@/generated/prisma/enums';
import { VideoGridCard } from './video-grid-card';
import { VideoListRow } from './video-list-row';

const visibilityIcons = { PUBLIC: Globe, UNLISTED: Link2, PRIVATE: Lock } as const;

/**
 * The videos of the current page as a grid or a list, with selection and bulk actions, and live processing state:
 * videos that are still being processed are polled (one request for all of them) and the page data is refreshed
 * when one of them finishes, so counters, posters and durations catch up.
 */
export function VideoLibrary({ items, view, showUploadTile }: { items: StudioVideoItem[]; view: 'grid' | 'list'; showUploadTile: boolean }) {
  const f = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<{ ids: string[]; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // --- live status -----------------------------------------------------------------------------------------------
  const inFlightIds = useMemo(() => items.filter((video) => isInFlight(video)).map((video) => video.id), [items]);
  const { statuses } = useVideoStatuses(inFlightIds);
  const live = useMemo(() => items.map((video) => statuses.get(video.id) ?? video), [items, statuses]);

  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    let finished = false;
    for (const id of inFlightIds) {
      const status = statuses.get(id);
      if (status && !isInFlight(status) && !refreshed.current.has(id)) {
        refreshed.current.add(id);
        finished = true;
      }
    }
    if (finished) router.refresh();
  }, [inFlightIds, statuses, router]);

  // --- selection ------------------------------------------------------------------------------------------------
  // Keep only ids that are still on the page (after a refresh, delete or filter change).
  const effectiveSelected = useMemo(() => new Set(items.filter((video) => selected.has(video.id)).map((video) => video.id)), [items, selected]);
  const allSelected = items.length > 0 && effectiveSelected.size === items.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // --- actions --------------------------------------------------------------------------------------------------
  async function deleteVideos(ids: string[]) {
    const results = await Promise.all(ids.map((id) => deleteVideoAction({ id })));
    const failed = results.filter((r) => !r.ok);
    const deleted = results.length - failed.length;
    if (deleted > 0) toast.success(ids.length === 1 ? studioMessages.deleted : `${f.number(deleted)} ویدیو حذف شد.`);
    const firstFailure = failed.find((r) => !r.ok);
    if (firstFailure && !firstFailure.ok) toast.error(firstFailure.message);
    setSelected(new Set());
    router.refresh();
    return failed.length === 0;
  }

  async function bulk(request: { action: 'publish' } | { action: 'visibility'; visibility: Visibility }) {
    setBusy(true);
    try {
      const result = await bulkVideosAction({ ...request, ids: [...effectiveSelected] });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const { done, skipped } = result.data;
      if (done.length > 0) {
        toast.success(request.action === 'publish' ? `${f.number(done.length)} ویدیو منتشر شد.` : `دسترسی ${f.number(done.length)} ویدیو تغییر کرد.`);
      }
      if (skipped.length > 0) toast.warning(`${f.number(skipped.length)} ویدیو تغییر نکرد: ${skipped[0]!.reason}`);
      setSelected(new Set());
      router.refresh();
    } catch {
      toast.error('ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    const result = await retryProcessingAction({ id });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(studioMessages.retryQueued);
    refreshed.current.delete(id);
    await queryClient.invalidateQueries({ queryKey: ['studio', 'video-statuses'] });
    router.refresh();
  }

  const Item = view === 'grid' ? VideoGridCard : VideoListRow;

  return (
    <div className="space-y-4">
      <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2" data-testid="library-toolbar">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={allSelected ? true : effectiveSelected.size > 0 ? 'indeterminate' : false}
            onCheckedChange={(value) => setSelected(value === true ? new Set(items.map((video) => video.id)) : new Set())}
            aria-label="انتخاب همه‌ی ویدیوهای این صفحه"
          />
          {effectiveSelected.size > 0 ? <span data-testid="selected-count">{f.number(effectiveSelected.size)} ویدیو انتخاب شده</span> : <span className="text-muted-foreground">انتخاب همه</span>}
        </label>

        {effectiveSelected.size > 0 && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => bulk({ action: 'publish' })}>
              {busy ? <Loader2 className="animate-spin" /> : <Radio />} انتشار
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  <Globe /> تغییر دسترسی
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(['PUBLIC', 'UNLISTED', 'PRIVATE'] as const).map((visibility) => {
                  const Icon = visibilityIcons[visibility];
                  return (
                    <DropdownMenuItem key={visibility} onSelect={() => bulk({ action: 'visibility', visibility })}>
                      <Icon /> {labels.visibility[visibility]}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleting({ ids: [...effectiveSelected], title: '' })}
            >
              <Trash2 /> حذف
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="لغو انتخاب" onClick={() => setSelected(new Set())}>
              <X />
            </Button>
          </div>
        )}
      </div>

      <ul
        data-testid="video-collection"
        data-view={view}
        className={view === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}
      >
        {view === 'grid' && showUploadTile && (
          <li>
            <Link
              href="/studio/upload"
              className="flex h-full min-h-56 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card/50 p-6 text-center text-muted-foreground transition-colors outline-none hover:border-primary hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Plus aria-hidden="true" className="size-6" />
              </span>
              <span className="text-sm font-semibold">بارگذاری ویدیوی جدید</span>
            </Link>
          </li>
        )}
        {live.map((video) => (
          <Item
            key={video.id}
            video={video}
            selected={effectiveSelected.has(video.id)}
            onSelectedChange={(on) => toggle(video.id, on)}
            onDelete={() => setDeleting({ ids: [video.id], title: video.title })}
            onRetry={() => retry(video.id)}
          />
        ))}
      </ul>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={deleting && deleting.ids.length > 1 ? `حذف ${f.number(deleting.ids.length)} ویدیو؟` : 'این ویدیو حذف شود؟'}
        description={
          deleting && deleting.ids.length > 1
            ? 'ویدیوهای انتخاب‌شده همراه با فایل‌ها، دیدگاه‌ها و آمارشان برای همیشه حذف می‌شوند. این کار قابل بازگشت نیست.'
            : `«${deleting?.title ?? ''}» همراه با فایل‌ها، دیدگاه‌ها و آمارش برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.`
        }
        confirmLabel="حذف برای همیشه"
        onConfirm={async () => {
          if (!deleting) return false;
          return deleteVideos(deleting.ids);
        }}
      />
    </div>
  );
}
