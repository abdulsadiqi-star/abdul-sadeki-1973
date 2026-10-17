'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { ArrowRight, Mic, Search, UserRound, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { normalizeSearchText } from '@/lib/persian';
import { cn } from '@/lib/utils';
import type { Suggestion } from '@/features/search/queries';

/** Minimal typing for the (vendor-prefixed) Web Speech API. */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => undefined;
/** True only in browsers that really implement speech recognition (false during SSR). */
function useVoiceSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, () => getSpeechRecognition() !== null, () => false);
}

const SUGGEST_DEBOUNCE_MS = 180;
const SUGGEST_MIN_CHARS = 2;

/**
 * Header search. Submits to /search?q=… (a plain GET form: it works without JavaScript). With JavaScript it becomes an
 * ARIA 1.2 combobox: after two characters it offers up to 8 suggestions (public video titles and channels) from
 * /api/search/suggest. Keys: ↓/↑ move through the list, Enter opens the highlighted suggestion (or submits the typed query
 * when none is highlighted), Esc closes the list. The microphone button only appears when the browser really supports
 * speech recognition. On small screens the box collapses into an icon that opens a full-width bar.
 */
export function SearchBox({ className }: { className?: string }) {
  const params = useSearchParams();
  // `key` resets the input whenever the URL query changes (e.g. back/forward navigation).
  return <SearchBoxInner key={params.get('q') ?? ''} initial={params.get('q') ?? ''} className={className} />;
}

function SearchBoxInner({ initial, className }: { initial: string; className?: string }) {
  const router = useRouter();
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  const [value, setValue] = useState(initial);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [announcement, setAnnouncement] = useState('');
  const voiceSupported = useVoiceSupported();
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new Map<string, Suggestion[]>());

  function cancelPending() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function closeList() {
    setOpen(false);
    setActive(-1);
  }

  function show(list: Suggestion[]) {
    setItems(list);
    setActive(-1);
    setOpen(list.length > 0);
    setAnnouncement(
      list.length > 0
        ? `${new Intl.NumberFormat('fa-IR').format(list.length)} پیشنهاد در دسترس است. برای حرکت از کلیدهای بالا و پایین استفاده کنید.`
        : 'پیشنهادی پیدا نشد.',
    );
  }

  function scheduleSuggestions(text: string) {
    cancelPending();
    const q = text.trim();
    if (normalizeSearchText(q).length < SUGGEST_MIN_CHARS) {
      setItems([]);
      closeList();
      setAnnouncement('');
      return;
    }
    const cached = cacheRef.current.get(q);
    if (cached) {
      show(cached);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!res.ok) {
          // rate limited or failed: stay quiet, the plain search still works
          closeList();
          return;
        }
        const data = (await res.json()) as { items?: Suggestion[] };
        const list = Array.isArray(data.items) ? data.items.slice(0, 8) : [];
        cacheRef.current.set(q, list);
        show(list);
      } catch {
        /* aborted or offline */
      }
    }, SUGGEST_DEBOUNCE_MS);
  }

  function submit(query: string) {
    const q = query.trim();
    cancelPending();
    closeList();
    setMobileOpen(false);
    router.push((q ? `/search?q=${encodeURIComponent(q)}` : '/search') as Route);
  }

  function choose(item: Suggestion) {
    cancelPending();
    closeList();
    setMobileOpen(false);
    router.push(item.href as Route);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length === 0) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === 'ArrowDown' ? 0 : items.length - 1);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + items.length) % items.length);
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        choose(items[active]!);
      }
      // otherwise the form's own submit handler sends the typed query
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        closeList();
      } else if (value) {
        setValue('');
        setItems([]);
      }
    } else if (e.key === 'Tab') {
      closeList();
    }
  }

  function openMobile() {
    setMobileOpen(true);
    // The input mounts in the same commit; focus it right after.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function startVoice() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = 'fa-IR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setValue(transcript);
        submit(transcript);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <>
      {/* Mobile trigger */}
      <Button variant="ghost" size="icon" shape="pill" className="md:hidden" aria-label="جستجو" onClick={openMobile}>
        <Search className="size-5" />
      </Button>

      <form
        role="search"
        action="/search"
        method="get"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className={cn(
          'items-center gap-2',
          // Desktop: inline. Mobile: overlay that covers the header when open.
          mobileOpen ? 'absolute inset-x-0 top-0 z-50 flex h-(--header-height) bg-background px-3' : 'hidden md:flex',
          className,
        )}
      >
        {mobileOpen && (
          <Button type="button" variant="ghost" size="icon" shape="pill" aria-label="بستن جستجو" onClick={() => setMobileOpen(false)}>
            <ArrowRight className="size-5 ltr:rotate-180" />
          </Button>
        )}
        <div
          className="relative flex min-w-0 flex-1 items-center"
          onBlur={(e) => {
            // close when focus leaves the whole widget (input, buttons, listbox)
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeList();
          }}
        >
          <label htmlFor={`${baseId}-input`} className="sr-only">
            جستجوی ویدیو
          </label>
          <input
            ref={inputRef}
            id={`${baseId}-input`}
            name="q"
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            enterKeyHint="search"
            autoComplete="off"
            maxLength={120}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              scheduleSuggestions(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (items.length > 0 && normalizeSearchText(value).length >= SUGGEST_MIN_CHARS) setOpen(true);
            }}
            placeholder="جستجوی ویدیو در تماشاگاه"
            className="h-10 w-full rounded-full border border-input bg-muted/50 ps-11 pe-12 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="submit"
            aria-label="جستجو"
            className="absolute start-1 top-1 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Search className="size-4" />
          </button>
          {value && (
            <button
              type="button"
              aria-label="پاک‌کردن عبارت جستجو"
              onClick={() => {
                cancelPending();
                setValue('');
                setItems([]);
                closeList();
                setAnnouncement('');
                inputRef.current?.focus();
              }}
              className={cn(
                'absolute top-1 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                voiceSupported ? 'end-10' : 'end-1',
              )}
            >
              <X className="size-4" />
            </button>
          )}
          {voiceSupported && (
            <button
              type="button"
              aria-label={listening ? 'توقف جستجوی صوتی' : 'جستجوی صوتی'}
              aria-pressed={listening}
              onClick={startVoice}
              className={cn(
                'absolute end-1 top-1 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                listening && 'bg-destructive/10 text-destructive',
              )}
            >
              <Mic className={cn('size-4', listening && 'animate-pulse')} />
            </button>
          )}

          <ul
            id={listboxId}
            role="listbox"
            aria-label="پیشنهادهای جستجو"
            hidden={!open}
            className="absolute inset-x-0 top-full z-50 mt-2 max-h-[min(70dvh,26rem)] overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
          >
            {open &&
              items.map((item, i) => (
                <li
                  key={`${item.type}:${item.id}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  // keep focus in the input while clicking
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                  onMouseMove={() => active !== i && setActive(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm',
                    i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                >
                  {item.type === 'channel' ? (
                    <UserRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Video aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate font-medium">
                      {item.text}
                    </span>
                    <span dir="auto" className="block truncate text-xs text-muted-foreground">
                      {item.type === 'channel' ? <span className="ltr-isolate">{item.subtitle}</span> : item.subtitle}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {item.type === 'channel' ? 'کانال' : 'ویدیو'}
                  </span>
                </li>
              ))}
          </ul>
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </div>
      </form>
    </>
  );
}
