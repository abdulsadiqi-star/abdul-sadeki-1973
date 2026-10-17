'use client';

import { useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ChannelAvatar } from '@/components/channel-avatar';
import { useFormatter } from '@/components/providers/format-provider';
import { cn } from '@/lib/utils';
import { COMMENT_MAX_LENGTH } from '../limits';

export type ComposerViewer = { id: string; name: string; avatarUrl: string | null };
export type SubmitResult = { ok: true } | { ok: false; message: string };

/**
 * Comment / reply editor. It clears right away (the parent inserts the comment optimistically) and puts the text
 * back with an inline error when the server refuses. Ctrl/⌘ + Enter sends. Limits are mirrored from the server
 * (1000 characters) for feedback only — the server is what enforces them.
 */
export function CommentComposer({
  viewer,
  label,
  placeholder,
  submitLabel = 'ارسال',
  autoFocus = false,
  compact = false,
  replyingTo,
  onSubmit,
  onCancel,
  id,
}: {
  viewer: ComposerViewer;
  /** Accessible name of the text box. */
  label: string;
  placeholder: string;
  submitLabel?: string;
  autoFocus?: boolean;
  compact?: boolean;
  /** Shown above a reply editor ("در پاسخ به …"). */
  replyingTo?: string | null;
  onSubmit: (text: string) => Promise<SubmitResult>;
  /** When given, a cancel button is offered (reply editors). */
  onCancel?: () => void;
  id?: string;
}) {
  const f = useFormatter();
  const uid = useId();
  const fieldId = id ?? `${uid}-text`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(autoFocus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const length = Array.from(text.trim()).length;
  const over = length > COMMENT_MAX_LENGTH;
  const canSubmit = length > 0 && !over && !pending;
  const expanded = focused || text.length > 0 || !!onCancel;

  async function submit() {
    if (!canSubmit) return;
    const draft = text;
    setText('');
    setError(null);
    setPending(true);
    const result = await onSubmit(draft);
    setPending(false);
    if (result.ok) {
      if (!onCancel) setFocused(false);
    } else {
      setText(draft); // keep what the person wrote
      setError(result.message);
      ref.current?.focus();
    }
  }

  return (
    <div className="flex gap-3">
      <ChannelAvatar name={viewer.name} src={viewer.avatarUrl} size={compact ? 'sm' : 'md'} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {replyingTo && (
          <p className="text-xs text-muted-foreground">
            در پاسخ به <span className="font-semibold text-foreground">{replyingTo}</span>
          </p>
        )}
        <label htmlFor={fieldId} className="sr-only">
          {label}
        </label>
        <Textarea
          id={fieldId}
          ref={ref}
          value={text}
          autoFocus={autoFocus}
          rows={1}
          dir="auto"
          placeholder={placeholder}
          aria-invalid={over || !!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          className={cn('field-sizing-content max-h-52 min-h-10 resize-none rounded-none border-0 border-b bg-transparent px-0 shadow-none focus-visible:ring-0', expanded ? 'min-h-16' : '')}
        />
        {error && (
          <p id={`${fieldId}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {expanded && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn('text-xs tabular-nums', over ? 'font-semibold text-destructive' : 'text-muted-foreground', length < COMMENT_MAX_LENGTH * 0.8 && !over && 'invisible')} aria-live="polite">
              {f.number(length)} / {f.number(COMMENT_MAX_LENGTH)}
            </span>
            <div className="flex items-center gap-2">
              {onCancel && (
                <Button type="button" variant="ghost" size="sm" shape="pill" onClick={onCancel} disabled={pending}>
                  انصراف
                </Button>
              )}
              {!onCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  shape="pill"
                  onClick={() => {
                    setText('');
                    setError(null);
                    setFocused(false);
                  }}
                  disabled={pending || text.length === 0}
                >
                  انصراف
                </Button>
              )}
              <Button type="button" size="sm" shape="pill" onClick={() => void submit()} disabled={!canSubmit}>
                {pending && <Loader2 className="animate-spin" />}
                {submitLabel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
