'use client';

import { useId, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Loader2 } from 'lucide-react';
import { useFormatter } from '@/components/providers/format-provider';
import { searchDateLabels, searchDurationLabels, searchSortLabels } from '@/features/search/labels';
import {
  SEARCH_DATES,
  SEARCH_DURATIONS,
  SEARCH_SORTS,
  searchHref,
  type SearchParams,
} from '@/features/search/schemas';
import { cn } from '@/lib/utils';

const selectClass =
  'h-9 min-w-0 rounded-lg border border-input bg-background px-3 pe-8 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60';

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/**
 * URL-driven filters. It is a real GET form (works without JavaScript: the apply button is shown inside <noscript>);
 * with JavaScript every change navigates immediately. Native <select> elements keep the controls accessible and RTL-correct.
 */
export function SearchFilters({
  params,
  categories,
  showSort = true,
}: {
  params: SearchParams;
  categories: { slug: string; nameFa: string }[];
  showSort?: boolean;
}) {
  const router = useRouter();
  const f = useFormatter();
  const [pending, startTransition] = useTransition();
  const durationLabels = searchDurationLabels(f);
  const sorts = params.q ? SEARCH_SORTS : SEARCH_SORTS.filter((s) => s !== 'relevance');
  const isVideos = params.type !== 'channel';

  function apply(patch: Partial<SearchParams>) {
    startTransition(() => router.push(searchHref(params, patch) as Route));
  }

  return (
    <form action="/search" method="get" aria-label="فیلتر نتایج جستجو" className="flex flex-wrap items-end gap-x-3 gap-y-2" aria-busy={pending}>
      {params.q && <input type="hidden" name="q" value={params.q} />}
      {params.type !== 'all' && <input type="hidden" name="type" value={params.type} />}

      {isVideos && (
        <>
          <Field label="تاریخ بارگذاری">
            {(id) => (
              <select id={id} name="date" value={params.date} onChange={(e) => apply({ date: e.target.value as SearchParams['date'] })} className={selectClass}>
                {SEARCH_DATES.map((d) => (
                  <option key={d} value={d}>
                    {searchDateLabels[d]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="مدت ویدیو">
            {(id) => (
              <select id={id} name="duration" value={params.duration} onChange={(e) => apply({ duration: e.target.value as SearchParams['duration'] })} className={selectClass}>
                {SEARCH_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {durationLabels[d]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {categories.length > 0 && (
            <Field label="دسته‌بندی">
              {(id) => (
                <select id={id} name="category" value={params.category ?? ''} onChange={(e) => apply({ category: e.target.value || null })} className={selectClass}>
                  <option value="">همه‌ی دسته‌ها</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.nameFa}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </>
      )}

      {showSort && isVideos && (
        <Field label="مرتب‌سازی">
          {(id) => (
            <select id={id} name="sort" value={params.sort} onChange={(e) => apply({ sort: e.target.value as SearchParams['sort'] })} className={selectClass}>
              {sorts.map((s) => (
                <option key={s} value={s}>
                  {searchSortLabels[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Loader2 aria-hidden="true" className={cn('mb-2 size-4 animate-spin text-muted-foreground', !pending && 'invisible')} />
      <noscript>
        <button type="submit" className="mb-0.5 h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          اعمال فیلترها
        </button>
      </noscript>
    </form>
  );
}
