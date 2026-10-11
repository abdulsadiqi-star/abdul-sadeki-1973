'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JalaliDatePicker } from '@/components/forms/jalali-date-picker';
import { NativeSelect } from '@/components/admin/native-select';
import { TEHRAN_OFFSET_MINUTES, tehranDayKey } from '@/lib/jalali';

export type FilterField =
  | { kind: 'search'; name: string; label: string; placeholder?: string; className?: string }
  | { kind: 'select'; name: string; label: string; defaultValue: string; options: { value: string; label: string; group?: string }[] }
  | { kind: 'date'; name: string; label: string };

type Values = Record<string, string>;

const dayFromKey = (key: string | undefined): Date | null => {
  const m = key ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - TEHRAN_OFFSET_MINUTES * 60_000) : null;
};

/**
 * URL-driven filter bar for the admin lists. The URL is the single source of truth (shareable, back-button friendly,
 * server-rendered results): selects and dates apply immediately, search text applies on submit. Defaults are kept out
 * of the URL and every change returns to page 1.
 */
export function FilterBar({ label, fields, values }: { label: string; fields: FilterField[]; values: Values }) {
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [draft, setDraft] = useState<Values>(values);
  const [pending, startTransition] = useTransition();

  const defaults = Object.fromEntries(fields.map((f) => [f.name, f.kind === 'select' ? f.defaultValue : '']));
  const isDirty = fields.some((f) => (values[f.name] ?? defaults[f.name]) !== defaults[f.name]);

  function apply(next: Values) {
    const params = new URLSearchParams();
    for (const f of fields) {
      const value = (next[f.name] ?? '').trim();
      if (value && value !== defaults[f.name]) params.set(f.name, value);
    }
    const query = params.toString();
    startTransition(() => router.push((query ? `${pathname}?${query}` : pathname) as Route));
  }

  function change(name: string, value: string) {
    const next = { ...draft, [name]: value };
    setDraft(next);
    apply(next);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    apply(draft);
  }

  function reset() {
    setDraft(defaults);
    apply(defaults);
  }

  return (
    <form
      role="search"
      aria-label={label}
      aria-busy={pending}
      onSubmit={onSubmit}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4"
    >
      {fields.map((field) => {
        const fieldId = `${id}-${field.name}`;
        if (field.kind === 'search') {
          return (
            <div key={field.name} className={`grid min-w-0 flex-1 basis-56 gap-1.5 ${field.className ?? ''}`}>
              <Label htmlFor={fieldId}>{field.label}</Label>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={fieldId}
                  name={field.name}
                  type="search"
                  value={draft[field.name] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => setDraft((d) => ({ ...d, [field.name]: e.target.value }))}
                  className="ps-9"
                  dir="auto"
                  autoComplete="off"
                />
              </div>
            </div>
          );
        }
        if (field.kind === 'select') {
          const groups = [...new Set(field.options.map((o) => o.group).filter(Boolean))] as string[];
          return (
            <div key={field.name} className="grid min-w-36 flex-1 basis-40 gap-1.5 sm:flex-none">
              <Label htmlFor={fieldId}>{field.label}</Label>
              <NativeSelect id={fieldId} name={field.name} value={draft[field.name] ?? field.defaultValue} onChange={(e) => change(field.name, e.target.value)}>
                {field.options.filter((o) => !o.group).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {field.options.filter((o) => o.group === g).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </div>
          );
        }
        const current = dayFromKey(draft[field.name]);
        return (
          <div key={field.name} className="grid min-w-40 flex-1 basis-44 gap-1.5 sm:flex-none">
            <Label htmlFor={fieldId}>{field.label}</Label>
            <JalaliDatePicker
              id={fieldId}
              aria-label={field.label}
              value={current}
              onChange={(date) => change(field.name, date ? tehranDayKey(date) : '')}
              placeholder="انتخاب تاریخ"
            />
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        {fields.some((f) => f.kind === 'search') && (
          <Button type="submit" variant="default" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Search />}
            جستجو
          </Button>
        )}
        {isDirty && (
          <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
            <X />
            پاک‌کردن فیلترها
          </Button>
        )}
      </div>
    </form>
  );
}
