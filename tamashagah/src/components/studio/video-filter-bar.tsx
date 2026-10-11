'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { LayoutGrid, List, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { studioListHref } from '@/features/videos-studio/filters';
import { studioSorts } from '@/features/videos-studio/labels';
import type { StudioListParams } from '@/features/videos-studio/schemas';
import { labels } from '@/lib/i18n/fa';
import type { CategoryOption } from './video-metadata-form';

const ALL = '__all__';

/** Search, filters, sort and view mode. Everything lives in the URL, so a filtered list can be shared and survives a reload. */
export function VideoFilterBar({ params, categories }: { params: StudioListParams; categories: CategoryOption[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(params.q);
  const lastNavigated = useRef(params.q);

  function go(overrides: Partial<StudioListParams>, mode: 'push' | 'replace' = 'push') {
    const href = studioListHref(params, { ...overrides, page: 1 }) as Route;
    startTransition(() => (mode === 'push' ? router.push(href, { scroll: false }) : router.replace(href, { scroll: false })));
  }

  // Search as you type, but not on every keystroke.
  useEffect(() => {
    if (query === lastNavigated.current) return;
    const timer = setTimeout(() => {
      lastNavigated.current = query;
      go({ q: query }, 'replace');
    }, 400);
    return () => clearTimeout(timer);
    // `go` closes over the current params on purpose: a stale one would drop a filter chosen in between.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filtered = Boolean(params.q || params.visibility || params.category);

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="جستجو و فیلتر ویدیوها">
      <form
        className="relative min-w-52 flex-1 basis-64"
        onSubmit={(event) => {
          event.preventDefault();
          lastNavigated.current = query;
          go({ q: query }, 'replace');
        }}
      >
        <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="جستجو در ویدیوهای من…"
          aria-label="جستجو در ویدیوهای من"
          maxLength={100}
          className="ps-9"
        />
      </form>

      <Select value={params.visibility ?? ALL} onValueChange={(value) => go({ visibility: value === ALL ? undefined : (value as StudioListParams['visibility']) })}>
        <SelectTrigger aria-label="فیلتر دسترسی" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>همه‌ی دسترسی‌ها</SelectItem>
          {(['PUBLIC', 'UNLISTED', 'PRIVATE'] as const).map((visibility) => (
            <SelectItem key={visibility} value={visibility}>
              {labels.visibility[visibility]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.category ?? ALL} onValueChange={(value) => go({ category: value === ALL ? undefined : value })}>
        <SelectTrigger aria-label="فیلتر دسته‌بندی" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>همه‌ی دسته‌بندی‌ها</SelectItem>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.nameFa}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.sort} onValueChange={(value) => go({ sort: value as StudioListParams['sort'] })}>
        <SelectTrigger aria-label="مرتب‌سازی" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {studioSorts.map((sort) => (
            <SelectItem key={sort.value} value={sort.value}>
              {sort.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery('');
            lastNavigated.current = '';
            go({ q: '', visibility: undefined, category: undefined });
          }}
        >
          <X /> پاک‌کردن فیلترها
        </Button>
      )}

      <ToggleGroup
        type="single"
        value={params.view}
        onValueChange={(value) => value && go({ view: value as StudioListParams['view'], page: 1 })}
        aria-label="نحوه‌ی نمایش"
        className="ms-auto"
      >
        <ToggleGroupItem value="grid" aria-label="نمایش شبکه‌ای">
          <LayoutGrid />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="نمایش فهرستی">
          <List />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
