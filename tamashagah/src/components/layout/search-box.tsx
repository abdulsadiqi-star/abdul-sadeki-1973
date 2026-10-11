'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Mic, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

/**
 * Header search. Submits to /search?q=… (works without JS). The microphone
 * button only appears when the browser really supports speech recognition.
 * On small screens the box collapses into an icon that opens a full-width bar.
 */
export function SearchBox({ className }: { className?: string }) {
  const params = useSearchParams();
  // `key` resets the input whenever the URL query changes (e.g. back/forward navigation).
  return <SearchBoxInner key={params.get('q') ?? ''} initial={params.get('q') ?? ''} className={className} />;
}

function SearchBoxInner({ initial, className }: { initial: string; className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const voiceSupported = useVoiceSupported();
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function submit(query: string) {
    const q = query.trim();
    setMobileOpen(false);
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
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
        <div className="relative flex min-w-0 flex-1 items-center">
          <label htmlFor="global-search" className="sr-only">
            جستجوی ویدیو
          </label>
          <input
            ref={inputRef}
            id="global-search"
            name="q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={120}
            value={value}
            onChange={(e) => setValue(e.target.value)}
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
                setValue('');
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
        </div>
      </form>
    </>
  );
}
