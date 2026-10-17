'use client';

import { useId, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ListPlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { useFormatter } from '@/components/providers/format-provider';
import { labels } from '@/lib/i18n/fa';
import type { Visibility } from '@/generated/prisma/enums';
import { createPlaylistAction, deletePlaylistAction, renamePlaylistAction, setPlaylistMembershipAction } from '../playlist-actions';
import type { PlaylistMenuItem } from '../playlists';

type Data = { playlists: PlaylistMenuItem[] };

async function fetchPlaylists(videoId: string): Promise<Data> {
  const res = await fetch(`/api/videos/${videoId}/playlists`, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error('playlists'), { status: res.status });
  return res.json();
}

/** "ذخیره در فهرست پخش": the watch page's add-to-playlist menu (create, rename, delete, add / remove this video). */
export function PlaylistMenu({ videoId, signedIn, className }: { videoId: string; signedIn: boolean; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function onClick() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <Button type="button" variant="outline" shape="pill" onClick={onClick} aria-haspopup="dialog" className={className}>
        <ListPlus />
        فهرست پخش
      </Button>
      {signedIn && <PlaylistDialog videoId={videoId} open={open} onOpenChange={setOpen} />}
    </>
  );
}

function PlaylistDialog({ videoId, open, onOpenChange }: { videoId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const f = useFormatter();
  const uid = useId();
  const queryClient = useQueryClient();
  const key = ['playlists', videoId] as const;

  const list = useQuery({ queryKey: key, queryFn: () => fetchPlaylists(videoId), enabled: open, staleTime: 0 });
  const patch = (fn: (items: PlaylistMenuItem[]) => PlaylistMenuItem[]) =>
    queryClient.setQueryData<Data>(key, (data) => (data ? { playlists: fn(data.playlists) } : data));

  // --- membership -------------------------------------------------------------------------------------
  const toggle = useMutation({
    mutationFn: async ({ playlist, present }: { playlist: PlaylistMenuItem; present: boolean }) => {
      const res = await setPlaylistMembershipAction({ playlistId: playlist.id, videoId, present });
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async ({ playlist, present }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Data>(key);
      patch((items) => items.map((p) => (p.id === playlist.id ? { ...p, contains: present, itemCount: Math.max(0, p.itemCount + (present ? 1 : -1)) } : p)));
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(error.message);
    },
    onSuccess: (data, { playlist, present }) => {
      patch((items) => items.map((p) => (p.id === playlist.id ? { ...p, contains: data.present, itemCount: data.itemCount } : p)));
      toast.success(present ? `به «${playlist.title}» اضافه شد.` : `از «${playlist.title}» برداشته شد.`);
    },
  });

  // --- create -----------------------------------------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newVisibility, setNewVisibility] = useState<Visibility>('PRIVATE');
  const [createError, setCreateError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const res = await createPlaylistAction({ title: newTitle, visibility: newVisibility, videoId });
      if (!res.ok) throw Object.assign(new Error(res.message), { field: res.fieldErrors?.title?.[0] });
      return res.data;
    },
    onSuccess: (item) => {
      patch((items) => [item, ...items]);
      setNewTitle('');
      setCreating(false);
      setCreateError(null);
      toast.success(`فهرست «${item.title}» ساخته شد و ویدیو به آن اضافه شد.`);
    },
    onError: (error: Error & { field?: string }) => setCreateError(error.field ?? error.message),
  });

  // --- rename / delete --------------------------------------------------------------------------------
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await renamePlaylistAction({ playlistId: id, title });
      if (!res.ok) throw new Error(res.fieldErrors?.title?.[0] ?? res.message);
      return res.data;
    },
    onSuccess: (data) => {
      patch((items) => items.map((p) => (p.id === data.id ? { ...p, title: data.title } : p)));
      setRenamingId(null);
      toast.success('نام فهرست تغییر کرد.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const [deleting, setDeleting] = useState<PlaylistMenuItem | null>(null);

  async function confirmDelete() {
    if (!deleting) return false;
    const res = await deletePlaylistAction({ playlistId: deleting.id });
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    patch((items) => items.filter((p) => p.id !== deleting.id));
    toast.success(`فهرست «${deleting.title}» حذف شد.`);
    return true;
  }

  const playlists = list.data?.playlists ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ذخیره در فهرست پخش</DialogTitle>
            <DialogDescription>ویدیو را به فهرست‌های خودتان اضافه یا از آن‌ها برداشته کنید.</DialogDescription>
          </DialogHeader>

          <div className="max-h-72 min-h-16 overflow-y-auto" aria-busy={list.isPending}>
            {list.isPending && (
              <div className="space-y-2" role="status" aria-label="در حال بارگذاری فهرست‌ها">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            )}
            {list.isError && <ErrorState title="بارگذاری فهرست‌ها ممکن نشد" onRetry={() => list.refetch()} className="py-6" />}
            {list.data && playlists.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">هنوز فهرست پخشی نساخته‌اید. اولین فهرست را بسازید.</p>
            )}
            {playlists.length > 0 && (
              <ul className="space-y-0.5" aria-label="فهرست‌های پخش شما">
                {playlists.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/40">
                    {renamingId === p.id ? (
                      <form
                        className="flex flex-1 items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          rename.mutate({ id: p.id, title: renameValue });
                        }}
                      >
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setRenamingId(null))}
                          aria-label="نام جدید فهرست"
                          maxLength={100}
                          dir="auto"
                          className="h-9"
                        />
                        <Button type="submit" size="icon-sm" variant="ghost" aria-label="ذخیره‌ی نام" disabled={rename.isPending}>
                          {rename.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                        </Button>
                        <Button type="button" size="icon-sm" variant="ghost" aria-label="انصراف از تغییر نام" onClick={() => setRenamingId(null)}>
                          <X />
                        </Button>
                      </form>
                    ) : (
                      <>
                        <Checkbox
                          id={`${uid}-${p.id}`}
                          checked={p.contains}
                          disabled={toggle.isPending && toggle.variables?.playlist.id === p.id}
                          onCheckedChange={(v) => toggle.mutate({ playlist: p, present: v === true })}
                        />
                        <Label htmlFor={`${uid}-${p.id}`} className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-0 leading-6 font-normal">
                          <span className="w-full truncate text-[15px]" dir="auto">
                            {p.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {f.number(p.itemCount)} ویدیو · {labels.visibility[p.visibility]}
                          </span>
                        </Label>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`تغییر نام «${p.title}»`}
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameValue(p.title);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button type="button" size="icon-sm" variant="ghost" aria-label={`حذف «${p.title}»`} onClick={() => setDeleting(p)}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t pt-3">
            {creating ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-new`}>نام فهرست پخش</Label>
                  <Input
                    id={`${uid}-new`}
                    autoFocus
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    maxLength={100}
                    dir="auto"
                    aria-invalid={!!createError}
                    aria-describedby={createError ? `${uid}-new-error` : undefined}
                  />
                  {createError && (
                    <p id={`${uid}-new-error`} role="alert" className="text-sm text-destructive">
                      {createError}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <span id={`${uid}-vis`} className="text-sm font-medium">
                    چه کسانی ببینند؟
                  </span>
                  <ToggleGroup type="single" value={newVisibility} onValueChange={(v) => v && setNewVisibility(v as Visibility)} aria-labelledby={`${uid}-vis`}>
                    {(['PRIVATE', 'UNLISTED', 'PUBLIC'] as const).map((v) => (
                      <ToggleGroupItem key={v} value={v}>
                        {labels.visibility[v]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => (setCreating(false), setCreateError(null))} disabled={create.isPending}>
                    انصراف
                  </Button>
                  <Button type="submit" disabled={create.isPending || newTitle.trim() === ''}>
                    {create.isPending && <Loader2 className="animate-spin" />}
                    ساخت و افزودن ویدیو
                  </Button>
                </div>
              </form>
            ) : (
              <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => setCreating(true)}>
                <Plus />
                ساخت فهرست پخش جدید
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        destructive
        title="حذف فهرست پخش؟"
        description={deleting ? `فهرست «${deleting.title}» با همه‌ی ویدیوهای داخلش از فهرست‌های شما حذف می‌شود؛ خود ویدیوها حذف نمی‌شوند.` : undefined}
        confirmLabel="حذف فهرست"
        onConfirm={confirmDelete}
      />
    </>
  );
}
