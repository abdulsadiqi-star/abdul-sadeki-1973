'use client';

import { useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFormatter } from '@/components/providers/format-provider';
import { ALLOWED_FORMATS_LABEL, VIDEO_ACCEPT } from '@/features/uploads/policy';
import { cn } from '@/lib/utils';

/**
 * Drop target and file picker. It only collects files; validation and uploading belong to the engine.
 * The hidden input stays in the DOM (visually hidden, keyboard reachable through the button).
 */
export function UploadDropzone({
  onFiles,
  maxBytes,
  disabled = false,
  disabledReason,
}: {
  onFiles: (files: File[]) => void;
  maxBytes: number;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const f = useFormatter();
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  return (
    <div
      data-testid="upload-dropzone"
      data-dragging={dragging || undefined}
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        if (disabled) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      }}
      className={cn(
        'flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed bg-card px-5 py-10 text-center transition-colors sm:py-14',
        dragging ? 'border-primary bg-accent/50' : 'border-border',
        disabled && 'opacity-60',
      )}
    >
      <span className={cn('flex size-16 items-center justify-center rounded-full bg-accent text-accent-foreground transition-transform', dragging && 'scale-110')}>
        <UploadCloud aria-hidden="true" className="size-8" />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{dragging ? 'فایل‌ها را رها کنید' : 'ویدیوهای خود را اینجا بکشید و رها کنید'}</h2>
        <p className="text-sm text-muted-foreground">{disabled && disabledReason ? disabledReason : 'یا از دستگاه خود انتخاب کنید؛ می‌توانید چند ویدیو را با هم بارگذاری کنید.'}</p>
      </div>
      <Button size="lg" shape="pill" disabled={disabled} onClick={() => inputRef.current?.click()}>
        انتخاب ویدیو
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={VIDEO_ACCEPT}
        disabled={disabled}
        data-testid="upload-input"
        aria-label="انتخاب فایل ویدیو"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ''; // the same file can be picked again later
          if (files.length > 0) onFiles(files);
        }}
      />
      <p className="max-w-xl text-xs leading-6 text-muted-foreground" dir="auto">
        قالب‌های پشتیبانی‌شده: {ALLOWED_FORMATS_LABEL} · حداکثر حجم هر فایل {f.bytes(maxBytes)}
      </p>
    </div>
  );
}
