'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Direction } from 'radix-ui';
import { useFormatter } from '@/components/providers/format-provider';
import { cn } from '@/lib/utils';
import { playerLabels } from './labels';
import { fractionFromPointer, fractionFromTime, seekBarKeyTarget, timeFromFraction } from './player-utils';

export type SeekBarProps = {
  currentTime: number;
  duration: number;
  /** Buffered time ranges in seconds. */
  buffered: ReadonlyArray<readonly [number, number]>;
  /** Commit a position (pointer release or keyboard). */
  onSeek: (time: number) => void;
  /** Live preview while dragging; `null` when the drag ends. */
  onScrub?: (time: number | null) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Seek slider (`role="slider"`). In RTL it fills from the RIGHT edge towards the left; pointer, touch and
 * keyboard all follow that visual direction (← forward, → backward). Hovering shows the time under the pointer,
 * dragging scrubs and commits on release.
 */
export function SeekBar({ currentTime, duration, buffered, onSeek, onScrub, disabled, className }: SeekBarProps) {
  const f = useFormatter();
  const dir = Direction.useDirection();
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [barWidth, setBarWidth] = useState(0);

  const hasDuration = Number.isFinite(duration) && duration > 0;
  const progress = drag ?? fractionFromTime(currentTime, duration);
  const previewFraction = drag ?? hover;

  const fractionAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    setBarWidth((w) => (w === rect.width ? w : rect.width)); // measured in event handlers only, never during render
    return fractionFromPointer(clientX, rect, dir);
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled || !hasDuration || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const fraction = fractionAt(e.clientX);
    setDrag(fraction);
    onScrub?.(timeFromFraction(fraction, duration));
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (disabled || !hasDuration) return;
    const fraction = fractionAt(e.clientX);
    if (dragging.current) {
      setDrag(fraction);
      onScrub?.(timeFromFraction(fraction, duration));
    } else if (e.pointerType === 'mouse') {
      setHover(fraction);
    }
  }

  function endDrag(e: PointerEvent<HTMLDivElement>, commit: boolean) {
    if (!dragging.current) return;
    dragging.current = false;
    const fraction = fractionAt(e.clientX);
    setDrag(null);
    onScrub?.(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (commit) onSeek(timeFromFraction(fraction, duration));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !hasDuration || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = seekBarKeyTarget(e.key, currentTime, duration, dir);
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation(); // the player-wide shortcuts must not seek a second time
    onSeek(target);
  }

  // The label is centred on its anchor; keep it inside the bar near both ends.
  const half = barWidth > 0 ? Math.min(50, (28 / barWidth) * 100) : 0;
  const tipPercent = previewFraction === null ? 0 : Math.min(100 - half, Math.max(half, previewFraction * 100));
  const shift = dir === 'rtl' ? 50 : -50;

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={playerLabels.seek}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={hasDuration ? Math.round(duration) : 0}
      aria-valuenow={hasDuration ? Math.round(Math.min(currentTime, duration)) : 0}
      aria-valuetext={hasDuration ? playerLabels.seekValue(f.duration(currentTime), f.duration(duration)) : undefined}
      aria-disabled={disabled || !hasDuration || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        'group/seek relative h-6 w-full cursor-pointer touch-none outline-none select-none',
        (disabled || !hasDuration) && 'cursor-default opacity-60',
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-white/25 transition-[height] duration-150',
          previewFraction !== null || focused ? 'h-1.5' : 'h-1 group-hover/seek:h-1.5',
        )}
      >
        {buffered.map(([start, end], i) => (
          <div
            key={i}
            aria-hidden="true"
            className="absolute inset-y-0 rounded-full bg-white/35"
            style={{ insetInlineStart: `${fractionFromTime(start, duration) * 100}%`, width: `${(fractionFromTime(end, duration) - fractionFromTime(start, duration)) * 100}%` }}
          />
        ))}
        <div
          aria-hidden="true"
          className={cn('absolute inset-y-0 start-0 rounded-full bg-[oklch(0.72_0.17_293)]', drag === null && 'transition-[width] duration-200 ease-linear')}
          style={{ width: `${progress * 100}%` }}
        />
        <div
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-[oklch(0.72_0.17_293)] transition-opacity duration-150',
            previewFraction !== null || focused ? 'opacity-100' : 'opacity-0 group-hover/seek:opacity-100',
          )}
          style={{ insetInlineStart: `${progress * 100}%`, transform: `translate(${shift}%, -50%)` }}
        />
      </div>

      {previewFraction !== null && hasDuration && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full mb-1 rounded-md bg-black/85 px-2 py-0.5 text-xs font-medium text-white tabular-nums shadow"
          style={{ insetInlineStart: `${tipPercent}%`, transform: `translateX(${shift}%)` }}
        >
          {f.duration(timeFromFraction(previewFraction, duration))}
        </div>
      )}
    </div>
  );
}
