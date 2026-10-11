import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

export const metadata = { title: 'پیدا نشد' };

/** Unknown report / user / channel / ticket ids inside the admin shell. */
export default function AdminNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="مورد موردنظر پیدا نشد"
      description="ممکن است حذف شده باشد یا نشانی را اشتباه وارد کرده باشید."
      action={
        <Button asChild>
          <Link href="/admin">بازگشت به نمای کلی</Link>
        </Button>
      }
    />
  );
}
