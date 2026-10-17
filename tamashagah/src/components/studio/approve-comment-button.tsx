'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { approveCommentAction } from '@/features/studio/actions';

/** Quick approve for a comment waiting for the creator (the server re-checks that the caller may moderate it). */
export function ApproveCommentButton({ commentId, author }: { commentId: string; author: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function approve() {
    startTransition(async () => {
      const result = await approveCommentAction({ commentId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('دیدگاه تأیید و منتشر شد.');
      router.refresh();
    });
  }

  return (
    <Button variant="soft" size="xs" disabled={pending} onClick={approve} aria-label={`تأیید دیدگاه ${author}`}>
      {pending ? <Loader2 className="animate-spin" /> : <Check />}
      تأیید
    </Button>
  );
}
