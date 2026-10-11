'use client';

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { playerLabels } from './labels';

/**
 * The "?" dialog listing the keyboard shortcuts. Rendered inside the player (so it also shows in fullscreen) as a
 * modal dialog: focus moves in, Tab stays inside, Esc / the close button / a click on the backdrop close it.
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation(); // no player shortcut may fire behind the dialog
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the close button is the only focusable element: keep focus trapped on it
      closeRef.current?.focus();
    }
  }

  const { help } = playerLabels;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl bg-neutral-900 p-4 text-white shadow-2xl ring-1 ring-white/10"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-bold">
            {help.title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={help.close}
            className="rounded-md p-1 text-white/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="size-5" />
          </button>
        </div>
        <p id={descId} className="mb-3 text-xs text-white/70">
          {help.description}
        </p>
        <ul className="divide-y divide-white/10 text-sm">
          {help.rows.map((row) => (
            <li key={row.text} className="flex items-center justify-between gap-4 py-1.5">
              <span>{row.text}</span>
              <span className="flex shrink-0 items-center gap-1" dir="ltr">
                {row.keys.map((k, i) =>
                  k === '…' ? (
                    <span key={i} aria-hidden="true" className="text-white/50">
                      …
                    </span>
                  ) : (
                    <kbd key={i} className="min-w-6 rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-center font-mono text-xs">
                      {k}
                    </kbd>
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
