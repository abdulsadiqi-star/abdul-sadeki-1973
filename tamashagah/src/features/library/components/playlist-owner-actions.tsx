'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { deletePlaylistAction } from '@/features/library/actions';
import { PlaylistFormDialog } from '@/features/library/components/playlist-form-dialog';

/** Rename / change visibility / delete — shown to the owner only (the server re-checks ownership on every call). */
export function PlaylistOwnerActions({
  playlist,
}: {
  playlist: { id: string; title: string; description: string; visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' };
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function remove() {
    const result = await deletePlaylistAction({ id: playlist.id });
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success('لیست پخش حذف شد.');
    router.replace('/library/playlists');
    return true;
  }

  return (
    <>
      <PlaylistFormDialog playlist={playlist}>
        <Button type="button" variant="outline" shape="pill" size="sm">
          <Pencil /> ویرایش
        </Button>
      </PlaylistFormDialog>
      <Button type="button" variant="outline" shape="pill" size="sm" className="text-destructive" onClick={() => setConfirmOpen(true)}>
        <Trash2 /> حذف لیست
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title={`لیست «${playlist.title}» حذف شود؟`}
        description="فقط خود لیست حذف می‌شود؛ ویدیوهای داخل آن سر جایشان می‌مانند. این کار قابل بازگشت نیست."
        confirmLabel="حذف لیست"
        onConfirm={remove}
      />
    </>
  );
}
