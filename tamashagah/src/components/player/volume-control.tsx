'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Direction } from 'radix-ui';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useFormatter } from '@/components/providers/format-provider';
import { cn } from '@/lib/utils';
import { playerLabels } from './labels';
import { VOLUME_STEP, clamp01, fractionFromPointer } from './player-utils';

type Props = {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  buttonClassName: string;
};

/**
 * Mute button + volume slider. The slider fills from the right in RTL (like the seek bar) and follows the same
 * keyboard rules: ↑/→(RTL: ←) louder, ↓ quieter. On phones only the button is shown (hardware keys control volume).
 */
export function VolumeControl({ volume, muted, onVolumeChange, onToggleMute, buttonClassName }: Props) {
  const f = useFormatter();
  const dir = Direction.useDirection();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [focused, setFocused] = useState(false);

  const effective = muted ? 0 : volume;
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;
  const label = muted || volume === 0 ? playerLabels.unmute : playerLabels.mute;

  const setFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) onVolumeChange(fractionFromPointer(clientX, rect, dir));
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setFromPointer(e.clientX);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current) setFromPointer(e.clientX);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // ←/→ follow the visual direction of the track (RTL: ← is louder), ↑/↓ always louder/quieter
    const towardsEnd = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const towardsStart = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next: number | null = null;
    if (e.key === 'ArrowUp' || e.key === towardsEnd) next = effective + VOLUME_STEP;
    else if (e.key === 'ArrowDown' || e.key === towardsStart) next = effective - VOLUME_STEP;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onVolumeChange(clamp01(next));
  }

  return (
    <div className="group/volume flex items-center">
      <button type="button" onClick={onToggleMute} aria-label={label} title={label} className={buttonClassName}>
        <Icon className="size-5" />
      </button>
      <div
        className={cn(
          'hidden items-center overflow-hidden transition-[width,margin] duration-200 sm:flex',
          focused ? 'me-2 w-20' : 'w-0 group-focus-within/volume:me-2 group-focus-within/volume:w-20 group-hover/volume:me-2 group-hover/volume:w-20',
        )}
      >
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={playerLabels.volume}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(effective * 100)}
          aria-valuetext={`${f.number(Math.round(effective * 100))}٪`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="relative h-6 w-20 shrink-0 cursor-pointer touch-none outline-none select-none"
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/30">
            <div className="absolute inset-y-0 start-0 rounded-full bg-white" style={{ width: `${effective * 100}%` }} />
          </div>
          <div
            aria-hidden="true"
            className="absolute top-1/2 size-3 rounded-full bg-white shadow"
            style={{ insetInlineStart: `${effective * 100}%`, transform: `translate(${dir === 'rtl' ? 50 : -50}%, -50%)` }}
          />
        </div>
      </div>
    </div>
  );
}
