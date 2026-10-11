'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { deleteVideoAction } from '@/features/videos-studio/actions';
import { studioMessages } from '@/features/videos-studio/labels';

/** Hard delete of the video (rows immediately, files in the background) after an explicit confirmation. */
export function VideoDeleteButton({ videoId, title }: { videoId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 /> حذف ویدیو
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title="این ویدیو حذف شود؟"
        description={`«${title}» همراه با فایل‌ها، دیدگاه‌ها و آمارش برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.`}
        confirmLabel="حذف برای همیشه"
        onConfirm={async () => {
          const result = await deleteVideoAction({ id: videoId });
          if (!result.ok) {
            toast.error(result.message);
            return false;
          }
          toast.success(studioMessages.deleted);
          router.push('/studio/videos');
          router.refresh();
        }}
      />
    </>
  );
}
