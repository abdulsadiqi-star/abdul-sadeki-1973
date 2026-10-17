'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Flag, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useFormatter } from '@/components/providers/format-provider';
import { ShortSlide, type SlideMode } from '@/components/shorts/short-slide';
import { useShortsMuted } from '@/components/shorts/use-shorts-muted';
import { loadShortsPageAction } from '@/features/discovery/actions';
import type { ShortItem } from '@/features/discovery/shorts';

/** Keys that must keep working inside text fields, menus and dialogs. */
const INTERACTIVE = 'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], [role="alertdialog"]';
const LOAD_MORE_WHEN_REMAINING = 3;

/**
 * Vertical, full-height shorts feed.
 *  - CSS scroll-snap does the swiping (touch, wheel, trackpad); ↑/↓ (and PageUp/PageDown, j/k) move one short, M mutes,
 *    Space pauses. Keys are ignored while typing or inside menus/dialogs.
 *  - Exactly one `<video>` plays (the short that is ≥ half visible); only the NEXT one is preloaded.
 *  - One global mute switch (remembered in localStorage); autoplay always starts muted unless the viewer chose sound.
 *  - New pages load through a Server Action (keyset cursor) when three shorts from the end are reached.
 *  - The address bar follows the active short (`/shorts?v=<id>`), so a refresh or a shared link starts there.
 */
export function ShortsFeed({ initialItems, initialCursor, signedIn }: { initialItems: ShortItem[]; initialCursor: string | null; signedIn: boolean }) {
  const f = useFormatter();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [preferMuted, setPreferMuted] = useShortsMuted();
  const [soundBlocked, setSoundBlocked] = useState(false);
  const muted = preferMuted || soundBlocked;
  const lastSlide = items.length; // index of the closing slide (end marker / loading indicator)

  const goTo = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const slides = scroller.children.length;
    const target = Math.min(Math.max(0, index), slides - 1);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: target * scroller.clientHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  const toggleMute = useCallback(() => {
    if (muted) {
      setSoundBlocked(false);
      setPreferMuted(false);
    } else {
      setPreferMuted(true);
    }
  }, [muted, setPreferMuted]);

  // The scroll handler below is registered once; it reads the freshest state through this ref.
  const latest = useRef({ itemCount: items.length, cursor, loading, loadFailed, loadMore: async () => {} });

  // --- which slide is active: the one nearest to the scroll position (and load more when close to the end) --------------
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const index = Math.round(scroller.scrollTop / Math.max(1, scroller.clientHeight));
        setActive(index);
        const state = latest.current;
        if (state.cursor && !state.loading && !state.loadFailed && index >= state.itemCount - LOAD_MORE_WHEN_REMAINING) void state.loadMore();
      });
    };
    scroller.addEventListener('scroll', update, { passive: true });
    // keep the same short in view when the viewport changes (rotation, window resize)
    const observer = new ResizeObserver(() => {
      scroller.scrollTo({ top: Math.round(scroller.scrollTop / Math.max(1, scroller.clientHeight)) * scroller.clientHeight, behavior: 'auto' });
    });
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  // --- address bar follows the active short ---------------------------------------------------------------------------
  const activeId = items[active]?.id;
  useEffect(() => {
    if (!activeId) return;
    window.history.replaceState(window.history.state, '', `/shorts?v=${activeId}`);
  }, [activeId]);

  // --- infinite loading ---------------------------------------------------------------------------------------------------
  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setLoadFailed(false);
    const result = await loadShortsPageAction({ cursor });
    if (result.ok) {
      setItems((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...result.data.items.filter((item) => !known.has(item.id))];
      });
      setCursor(result.data.nextCursor);
    } else {
      setLoadFailed(true);
      toast.error(result.message);
    }
    setLoading(false);
  }, [cursor, loading]);

  useEffect(() => {
    latest.current = { itemCount: items.length, cursor, loading, loadFailed, loadMore };
  });

  // --- keyboard -------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE)) return;
      switch (event.key) {
        case 'ArrowDown':
        case 'PageDown':
        case 'j':
          event.preventDefault();
          goTo(active + 1);
          break;
        case 'ArrowUp':
        case 'PageUp':
        case 'k':
          event.preventDefault();
          goTo(active - 1);
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case ' ': {
          // Space activates a focused button/link natively; elsewhere it pauses or resumes the active short.
          if (target?.closest('button, a, summary')) return;
          event.preventDefault();
          scrollerRef.current?.querySelector<HTMLButtonElement>('[data-active="true"] [data-role="toggle-play"]')?.click();
          break;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, goTo, toggleMute]);

  const atEnd = !cursor && !loading;
  const current = items[active];

  return (
    <div className="relative -mx-3 -mt-4 sm:-mx-6 sm:-mt-6 lg:mx-0">
      <h1 className="sr-only">شورتس</h1>
      <div
        ref={scrollerRef}
        role="feed"
        aria-label="شورتس"
        aria-busy={loading}
        tabIndex={0}
        className="scrollbar-hide h-[calc(100dvh-var(--header-height)-4rem)] snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring motion-reduce:scroll-auto lg:h-[calc(100dvh-var(--header-height))]"
      >
        {items.map((item, index) => {
          const mode: SlideMode = index === active ? 'active' : index === active + 1 ? 'preload' : 'idle';
          return (
            <ShortSlide
              key={item.id}
              item={item}
              index={index}
              mode={mode}
              muted={muted}
              signedIn={signedIn}
              onToggleMute={toggleMute}
              onSoundBlocked={() => setSoundBlocked(true)}
              onSkip={() => goTo(index + 1)}
            />
          );
        })}

        <section aria-label={atEnd ? 'پایان شورتس' : 'در حال بارگذاری شورتس بیشتر'} className="flex h-full snap-start snap-always flex-col items-center justify-center gap-4 p-6 text-center">
          {atEnd ? (
            <>
              <span className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Flag aria-hidden="true" className="size-8" />
              </span>
              <h2 className="text-lg font-bold">به انتهای شورتس رسیدید</h2>
              <p className="max-w-xs text-sm text-muted-foreground">همه‌ی شورتس‌های موجود را دیدید. بعداً دوباره سر بزنید یا ویدیوهای بلندتر را تماشا کنید.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" shape="pill" onClick={() => goTo(0)}>
                  بازگشت به اولین شورت
                </Button>
                <Button asChild variant="outline" shape="pill">
                  <Link href="/">صفحه‌ی اصلی</Link>
                </Button>
              </div>
            </>
          ) : loadFailed ? (
            <>
              <p className="text-sm text-muted-foreground">بارگذاری شورتس بیشتر ممکن نشد.</p>
              <Button type="button" variant="outline" shape="pill" onClick={() => void loadMore()}>
                تلاش دوباره
              </Button>
            </>
          ) : (
            <Loader2 aria-hidden="true" className="size-8 animate-spin text-muted-foreground" />
          )}
        </section>
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {current ? `شورت ${f.number(active + 1)}: ${current.title}` : ''}
      </div>

      <div className="absolute end-4 top-1/2 hidden -translate-y-1/2 flex-col gap-2 lg:flex">
        <Button type="button" variant="outline" size="icon" shape="pill" aria-label="شورت قبلی" disabled={active <= 0} onClick={() => goTo(active - 1)}>
          <ChevronUp />
        </Button>
        <Button type="button" variant="outline" size="icon" shape="pill" aria-label="شورت بعدی" disabled={active >= lastSlide} onClick={() => goTo(active + 1)}>
          <ChevronDown />
        </Button>
      </div>
    </div>
  );
}
