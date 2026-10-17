'use client';

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const MAX_TAGS = 15;
export const MAX_TAG_LENGTH = 32;

const SEPARATORS = /[,،\n]/;

/** Same rules as the server's `normalizeTags`, applied while typing so the creator sees the final result. */
export function addTags(current: readonly string[], raw: string, max = MAX_TAGS): string[] {
  const next = [...current];
  for (const part of raw.split(SEPARATORS)) {
    const tag = part.trim().replace(/^#+/, '').slice(0, MAX_TAG_LENGTH).trim();
    if (!tag || next.length >= max) continue;
    if (!next.some((t) => t.toLowerCase() === tag.toLowerCase())) next.push(tag);
  }
  return next;
}

/**
 * Chip input: Enter, comma or the Persian comma add the typed tag, Backspace in the empty field removes the last one,
 * pasted lists are split. Controlled (`value` / `onChange`).
 */
export function VideoTagInput({
  value,
  onChange,
  id,
  disabled,
  invalid,
  describedBy,
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const full = value.length >= MAX_TAGS;

  function commit(raw: string) {
    if (raw.trim()) onChange(addTags(value, raw));
    setDraft('');
  }

  return (
    <div
      className={cn(
        'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40',
        invalid && 'border-destructive ring-destructive/20',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent py-0.5 ps-2.5 pe-1 text-[13px] text-accent-foreground">
          <span className="truncate" dir="auto">
            {tag}
          </span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`حذف برچسب «${tag}»`}
            onClick={(event) => {
              event.stopPropagation();
              onChange(value.filter((t) => t !== tag));
            }}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        disabled={disabled || full}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={MAX_TAG_LENGTH * 4}
        placeholder={full ? `حداکثر ${MAX_TAGS} برچسب` : value.length === 0 ? 'برچسب را بنویسید و Enter بزنید' : ''}
        onChange={(event) => {
          const text = event.target.value;
          // A separator typed (or pasted) in the middle of the text completes the tags before it.
          if (SEPARATORS.test(text)) commit(text);
          else setDraft(text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(draft);
          } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        dir="auto"
        className="min-w-32 flex-1 bg-transparent px-1 py-0.5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}
