import Link from 'next/link';
import { Lightbulb, Zap } from 'lucide-react';
import { ChevronEnd } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { SHORTS_MAX_SECONDS } from '@/config/site';
import { getFormatter } from '@/lib/format-server';

/**
 * Two static creator tips (reference: the two info cards under the stats). Plain, truthful guidance that matches how
 * the product works (search reads title, description and tags; shorts have a length limit) with real links — no
 * promotions, no invented features.
 */
export async function TipCards() {
  const f = await getFormatter();
  return (
    <section aria-label="نکته‌هایی برای سازندگان" className="grid gap-4 md:grid-cols-2">
      <article className="flex gap-4 rounded-2xl border bg-card p-5 shadow-xs">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Lightbulb className="size-6" />
        </span>
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-bold">ویدیوهای شما چطور پیدا می‌شوند؟</h2>
          <p className="text-sm text-muted-foreground">
            جستجوی تماشاگاه روی عنوان، توضیحات و برچسب‌ها کار می‌کند؛ عنوان روشن، توضیحات کامل و دسته‌بندی درست شانس دیده‌شدن را بیشتر می‌کند.
          </p>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href="/help">
              راهنمای سازندگان <ChevronEnd />
            </Link>
          </Button>
        </div>
      </article>

      <article className="flex gap-4 rounded-2xl border bg-card p-5 shadow-xs">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
          <Zap className="size-6" />
        </span>
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-bold">شورتس را امتحان کنید</h2>
          <p className="text-sm text-muted-foreground">
            ویدیوهای کوتاه تا {f.number(SHORTS_MAX_SECONDS)} ثانیه در بخش شورتس نمایش داده می‌شوند. اولین ویدیوی کوتاه خود را بارگذاری کنید.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href="/studio/upload">
                بارگذاری ویدیو <ChevronEnd />
              </Link>
            </Button>
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href="/shorts">
                مشاهده‌ی شورتس <ChevronEnd />
              </Link>
            </Button>
          </div>
        </div>
      </article>
    </section>
  );
}
