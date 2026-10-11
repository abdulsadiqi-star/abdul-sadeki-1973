'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { withdrawApplicationAction } from '../actions';

/** Withdraw a submitted application that no reviewer has started on (it becomes an editable draft again). */
export function WithdrawButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function withdraw(): Promise<boolean> {
    const result = await withdrawApplicationAction();
    if (!result.ok) {
      toast.error(result.message);
      router.refresh(); // the state may have changed under us (a reviewer picked it up)
      return false;
    }
    toast.success('درخواست به پیش‌نویس برگشت.');
    router.refresh();
    return true;
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="withdraw-application">
        <Undo2 /> انصراف از درخواست
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="انصراف از درخواست؟"
        description="درخواست شما از صف بررسی خارج و به پیش‌نویس برمی‌گردد. هر زمان که خواستید می‌توانید دوباره آن را ارسال کنید."
        confirmLabel="انصراف از درخواست"
        onConfirm={withdraw}
      />
    </>
  );
}
