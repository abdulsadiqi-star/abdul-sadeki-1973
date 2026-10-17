'use client';

import { useState, useTransition, type ReactNode } from 'react';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { Check, CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { JalaliDatePicker } from '@/components/forms/jalali-date-picker';
import { useFormatter } from '@/components/providers/format-provider';
import { dayKeyToInstant, instantToDayKey } from '@/lib/analytics/time';
import { analyticsHref, RANGE_QUERY_VALUES, type AnalyticsQuery, type RangeQueryValue } from '@/features/analytics/schemas';
import { rangeLabel } from '@/features/analytics/labels';
import { cn } from '@/lib/utils';

/**
 * Range controls of the analytics page. The URL is the single source of truth (deep links, back button, CSV export
 * all use it): every change navigates to the new query string and the server component re-renders with fresh data.
 * While the navigation is pending the content below is dimmed and `aria-busy`, and a polite live region announces it.
 */
export function AnalyticsFrame({
  query,
  periodText,
  compareText,
  rangeError,
  children,
}: {
  query: AnalyticsQuery;
  /** "۵ مهر تا ۱۱ مهر ۱۴۰۵" */
  periodText: string;
  /** "۲۸ شهریور تا ۴ مهر ۱۴۰۵" */
  compareText: string;
  /** Shown when the requested custom range was invalid (the page fell back to the default). */
  rangeError: string | null;
  children: ReactNode;
}) {
  const f = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<RangeQueryValue>(query.range);
  const [from, setFrom] = useState<Date | null>(query.from ? dayKeyToInstant(query.from) : null);
  const [to, setTo] = useState<Date | null>(query.to ? dayKeyToInstant(query.to) : null);

  const go = (next: Partial<AnalyticsQuery>) => {
    const href = analyticsHref(pathname, { ...query, ...next, page: 1 });
    startTransition(() => router.push(href as Route, { scroll: false }));
  };

  const customInvalid = from !== null && to !== null && from.getTime() > to.getTime();
  const customReady = from !== null && to !== null && !customInvalid;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border bg-card p-3.5 shadow-xs">
        <div className="grid gap-1.5">
          <Label htmlFor="analytics-range" className="text-xs text-muted-foreground">
            بازه‌ی زمانی
          </Label>
          <Select
            value={selected}
            onValueChange={(value) => {
              const next = value as RangeQueryValue;
              setSelected(next);
              if (next !== 'custom') go({ range: next, from: undefined, to: undefined });
            }}
          >
            <SelectTrigger id="analytics-range" className="w-48" aria-label="بازه‌ی زمانی">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_QUERY_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {rangeLabel(f, value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selected === 'custom' && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">از تاریخ</Label>
              <JalaliDatePicker value={from} onChange={setFrom} max={new Date()} placeholder="تاریخ شروع" clearable={false} aria-label="تاریخ شروع" className="w-44" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">تا تاریخ</Label>
              <JalaliDatePicker value={to} onChange={setTo} max={new Date()} placeholder="تاریخ پایان" clearable={false} aria-label="تاریخ پایان" className="w-44" />
            </div>
            <Button
              disabled={!customReady || pending}
              onClick={() => go({ range: 'custom', from: instantToDayKey(from!), to: instantToDayKey(to!) })}
            >
              <Check /> اعمال
            </Button>
            {customInvalid && (
              <p role="alert" className="basis-full text-[13px] text-destructive">
                تاریخ شروع باید پیش از تاریخ پایان باشد.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-1.5">
          <span id="analytics-granularity-label" className="text-xs text-muted-foreground">
            تفکیک
          </span>
          <ToggleGroup
            type="single"
            value={query.granularity}
            aria-labelledby="analytics-granularity-label"
            onValueChange={(value) => value && go({ granularity: value as 'day' | 'month' })}
          >
            <ToggleGroupItem value="day" aria-label="روزانه">
              روزانه
            </ToggleGroupItem>
            <ToggleGroupItem value="month" aria-label="ماهانه">
              ماهانه
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <p className="ms-auto max-w-full text-[13px] text-muted-foreground" data-testid="analytics-period">
          <span className="font-medium text-foreground">{periodText}</span>
          <span className="block sm:inline"> — مقایسه با {compareText}</span>
        </p>
      </div>

      <p role="status" className="sr-only">
        {pending ? 'در حال بارگذاری آمار…' : ''}
      </p>
      {rangeError && (
        <Alert variant="warning">
          <CircleAlert />
          <AlertDescription className="text-foreground">{rangeError} آمار ۳۰ روز اخیر نمایش داده می‌شود.</AlertDescription>
        </Alert>
      )}
      <div aria-busy={pending} className={cn('space-y-6 transition-opacity', pending && 'pointer-events-none opacity-60')}>
        {children}
      </div>
    </div>
  );
}
