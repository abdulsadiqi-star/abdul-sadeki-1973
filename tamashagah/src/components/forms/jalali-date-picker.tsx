'use client';

import { useId, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFormatter } from '@/components/providers/format-provider';
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  fromJalali,
  jalaliMonthLength,
  jalaliWeekday,
  startOfTehranDay,
  tehranWallClock,
  toJalali,
} from '@/lib/jalali';
import { toPersianDigits } from '@/lib/persian';
import { cn } from '@/lib/utils';

type Props = {
  /** The selected day as an instant (start of that Tehran day) or null. */
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Inclusive bounds (any instant inside the allowed first/last day). */
  min?: Date;
  max?: Date;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
};

const WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/**
 * Jalali (Persian) calendar date picker, Saturday-first, Persian digits, RTL.
 * Values are plain `Date` instants fixed at the START of the chosen Tehran day, so they can be stored
 * and compared directly. Month/year are native selects (accessible, keyboard friendly).
 */
export function JalaliDatePicker({ value, onChange, min, max, placeholder = 'انتخاب تاریخ', disabled, clearable = true, id, className, ...rest }: Props) {
  const f = useFormatter();
  const [open, setOpen] = useState(false);
  const todayJ = useMemo(() => toJalali(new Date()), []);
  const selected = value ? toJalali(value) : null;
  const [view, setView] = useState<{ jy: number; jm: number }>(() => {
    const base = selected ?? todayJ;
    return { jy: base.jy, jm: base.jm };
  });
  const uid = useId();

  const minDay = min ? startOfTehranDay(min).getTime() : -Infinity;
  const maxDay = max ? startOfTehranDay(max).getTime() : Infinity;

  const monthLength = jalaliMonthLength(view.jy, view.jm);
  const firstWeekday = jalaliWeekday(fromJalali(view.jy, view.jm, 1, 12)); // 0 = Saturday
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: monthLength }, (_, i) => i + 1)];

  function shiftMonth(delta: number) {
    setView(({ jy, jm }) => {
      const index = jy * 12 + (jm - 1) + delta;
      return { jy: Math.floor(index / 12), jm: (index % 12) + 1 };
    });
  }

  function pick(day: number) {
    onChange(fromJalali(view.jy, view.jm, day));
    setOpen(false);
  }

  const years = Array.from({ length: 31 }, (_, i) => todayJ.jy - 10 + i);
  if (!years.includes(view.jy)) years.push(view.jy);
  years.sort((a, b) => a - b);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const base = selected ?? todayJ;
          setView({ jy: base.jy, jm: base.jm });
        }
        setOpen(next);
      }}
    >
      <div className={cn('relative', className)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={rest['aria-label']}
            className="w-full justify-start gap-2 font-normal"
          >
            <CalendarDays className="text-muted-foreground" />
            {value ? <span className="tabular-nums">{f.date(value, 'long')}</span> : <span className="text-muted-foreground">{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label="پاک‌کردن تاریخ"
            onClick={() => onChange(null)}
            className="absolute end-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-[19rem] p-3" aria-label="تقویم شمسی">
        <div className="mb-2 flex items-center justify-between gap-1">
          <Button type="button" variant="ghost" size="icon-xs" aria-label="ماه قبل" onClick={() => shiftMonth(-1)}>
            <ChevronRight />
          </Button>
          <div className="flex items-center gap-1">
            <select
              aria-label="ماه"
              value={view.jm}
              onChange={(e) => setView((v) => ({ ...v, jm: Number(e.target.value) }))}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {JALALI_MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="سال"
              value={view.jy}
              onChange={(e) => setView((v) => ({ ...v, jy: Number(e.target.value) }))}
              className="h-8 rounded-md border bg-background px-2 text-sm tabular-nums"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {toPersianDigits(y)}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="ماه بعد" onClick={() => shiftMonth(1)}>
            <ChevronLeft />
          </Button>
        </div>

        <div role="grid" aria-labelledby={uid} className="grid grid-cols-7 gap-y-1 text-center text-sm">
          <span id={uid} className="sr-only">
            {JALALI_MONTHS[view.jm - 1]} {toPersianDigits(view.jy)}
          </span>
          {WEEKDAY_SHORT.map((d, i) => (
            <span key={d} role="columnheader" aria-label={JALALI_WEEKDAYS[i]} className={cn('py-1 text-xs font-semibold text-muted-foreground', i === 6 && 'text-destructive')}>
              {d}
            </span>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <span key={`blank-${i}`} role="gridcell" />;
            const instant = fromJalali(view.jy, view.jm, day);
            const disabledDay = instant.getTime() < minDay || instant.getTime() > maxDay;
            const isSelected = selected?.jy === view.jy && selected.jm === view.jm && selected.jd === day;
            const isToday = todayJ.jy === view.jy && todayJ.jm === view.jm && todayJ.jd === day;
            const isFriday = (firstWeekday + day - 1) % 7 === 6;
            return (
              <span key={day} role="gridcell" aria-selected={isSelected}>
                <button
                  type="button"
                  disabled={disabledDay}
                  aria-label={`${toPersianDigits(day)} ${JALALI_MONTHS[view.jm - 1]} ${toPersianDigits(view.jy)}`}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  onClick={() => pick(day)}
                  className={cn(
                    'mx-auto flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-30',
                    isFriday && 'text-destructive',
                    isToday && !isSelected && 'border border-primary',
                    isSelected ? 'bg-primary font-bold text-primary-foreground' : 'hover:bg-accent',
                  )}
                >
                  {toPersianDigits(day)}
                </button>
              </span>
            );
          })}
        </div>

        <div className="mt-2 flex justify-between border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={fromJalali(todayJ.jy, todayJ.jm, todayJ.jd).getTime() < minDay || fromJalali(todayJ.jy, todayJ.jm, todayJ.jd).getTime() > maxDay}
            onClick={() => onChange(fromJalali(todayJ.jy, todayJ.jm, todayJ.jd))}
          >
            امروز
          </Button>
          {clearable && (
            <Button type="button" variant="ghost" size="xs" onClick={() => onChange(null)}>
              پاک کردن
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Date + time (Tehran wall clock, 24h) for scheduling. Value is a full instant.
 * Minutes step in 5s to keep the control compact.
 */
export function JalaliDateTimeInput({
  value,
  onChange,
  min,
  max,
  placeholder = 'تاریخ و ساعت انتشار',
  disabled,
  className,
  ...rest
}: Omit<Props, 'clearable' | 'id'> & { id?: string }) {
  const clock = value ? tehranWallClock(value) : null;
  const hour = clock?.hour ?? 12;
  const minute = clock ? Math.round(clock.minute / 5) * 5 % 60 : 0;

  function withTime(day: Date | null, h: number, m: number) {
    if (!day) return null;
    const { jy, jm, jd } = toJalali(day);
    return fromJalali(jy, jm, jd, h, m);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <JalaliDatePicker
        value={value ? startOfTehranDay(value) : null}
        onChange={(day) => onChange(withTime(day, hour, minute))}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-48 flex-1"
        aria-label={rest['aria-label']}
      />
      <div className="flex items-center gap-1" dir="ltr">
        <select
          aria-label="ساعت"
          disabled={disabled || !value}
          value={hour}
          onChange={(e) => onChange(withTime(value, Number(e.target.value), minute))}
          className="h-10 rounded-lg border bg-background px-2 text-sm tabular-nums disabled:opacity-50"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {toPersianDigits(String(h).padStart(2, '0'))}
            </option>
          ))}
        </select>
        <span aria-hidden="true">:</span>
        <select
          aria-label="دقیقه"
          disabled={disabled || !value}
          value={minute}
          onChange={(e) => onChange(withTime(value, hour, Number(e.target.value)))}
          className="h-10 rounded-lg border bg-background px-2 text-sm tabular-nums disabled:opacity-50"
        >
          {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
            <option key={m} value={m}>
              {toPersianDigits(String(m).padStart(2, '0'))}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
