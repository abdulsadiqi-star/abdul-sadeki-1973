'use client';

import { FastForward, Loader2, Play, RotateCcw, Rewind, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { playerLabels } from './labels';

/** Large centre button shown before playback starts, and as "replay" once the video ended. */
export function BigPlayButton({ onClick, replay }: { onClick: () => void; replay?: boolean }) {
  const label = replay ? playerLabels.replay : playerLabels.play;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="absolute inset-0 z-10 m-auto flex size-16 items-center justify-center rounded-full bg-black/60 text-white shadow-lg outline-none backdrop-blur-sm transition hover:scale-105 hover:bg-black/75 focus-visible:ring-4 focus-visible:ring-white/60 sm:size-20"
    >
      {replay ? <RotateCcw className="size-8 sm:size-9" /> : <Play className="size-8 fill-current sm:size-9" />}
    </button>
  );
}

/** Buffering / initial loading indicator (announced politely to screen readers). */
export function BufferingSpinner({ visible }: { visible: boolean }) {
  return (
    <div role="status" aria-live="polite" className={cn('pointer-events-none absolute inset-0 z-10 flex items-center justify-center', !visible && 'hidden')}>
      <Loader2 aria-hidden="true" className="size-12 animate-spin text-white drop-shadow-lg" />
      <span className="sr-only">{visible ? playerLabels.buffering : ''}</span>
    </div>
  );
}

/** Friendly failure state with a retry. Replaces the picture; never leaves a broken-looking player behind. */
export function ErrorOverlay({ message, onRetry, retryable = true }: { message: string; onRetry: () => void; retryable?: boolean }) {
  return (
    <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 text-center text-white">
      <TriangleAlert aria-hidden="true" className="size-9 text-amber-400" />
      <p className="text-base font-bold">{playerLabels.errorTitle}</p>
      <p className="max-w-md text-sm text-white/80">{message}</p>
      {retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black outline-none transition hover:bg-white/90 focus-visible:ring-4 focus-visible:ring-white/50"
        >
          {playerLabels.retry}
        </button>
      )}
    </div>
  );
}

export type SeekRippleState = { id: number; side: 'start' | 'end'; text: string; forward: boolean };

/** Brief "۱۰ ثانیه جلو" hint on the side that was double-tapped. */
export function SeekRipple({ ripple }: { ripple: SeekRippleState | null }) {
  if (!ripple) return null;
  const Icon = ripple.forward ? FastForward : Rewind;
  return (
    <div
      key={ripple.id}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-y-0 z-10 flex w-1/3 animate-in items-center justify-center fade-in-0 zoom-in-90',
        ripple.side === 'start' ? 'start-0 rounded-e-[50%]' : 'end-0 rounded-s-[50%]',
        'bg-white/15',
      )}
    >
      <div className="flex flex-col items-center gap-1 text-white drop-shadow">
        <Icon className="size-7" />
        <span className="text-xs font-semibold">{ripple.text}</span>
      </div>
    </div>
  );
}

/** Subtitle line, drawn by us (not the browser) so it can sit above the control bar and use the page font. */
export function CaptionsOverlay({ text, raised }: { text: string; raised: boolean }) {
  if (!text) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4 transition-[bottom] duration-200',
        raised ? 'bottom-16 sm:bottom-20' : 'bottom-3 sm:bottom-6',
      )}
    >
      <p dir="auto" className="user-text max-w-[90%] rounded-md bg-black/75 px-3 py-1 text-center text-sm leading-7 font-medium whitespace-pre-line text-white sm:text-lg">
        {text}
      </p>
    </div>
  );
}
