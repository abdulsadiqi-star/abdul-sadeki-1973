'use client';

import { useRef, useState } from 'react';
import { FileVideo, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useFormatter } from '@/components/providers/format-provider';
import { VIDEO_ACCEPT } from '@/features/uploads/policy';
import type { PendingUpload } from '@/features/videos-studio/queries';

/**
 * Uploads that were started but never finished (closed tab, lost connection, another device). A browser cannot keep a
 * file handle across visits, so continuing means picking the same file again; the server then tells the client how
 * much it already has and only the rest is sent.
 */
export function UploadPendingList({
  items,
  onContinue,
  onDiscard,
  disabled = false,
}: {
  items: PendingUpload[];
  onContinue: (pending: PendingUpload, file: File) => void;
  onDiscard: (pending: PendingUpload) => Promise<void>;
  disabled?: boolean;
}) {
  const f = useFormatter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<PendingUpload | null>(null);
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
  const [discarding, setDiscarding] = useState<PendingUpload | null>(null);

  if (items.length === 0) return null;

  return (
    <Card data-testid="pending-uploads">
      <CardHeader>
        <CardTitle>بارگذاری‌های ناتمام</CardTitle>
        <CardDescription>
          این بارگذاری‌ها کامل نشده‌اند. همان فایل را دوباره انتخاب کنید تا از همان‌جایی که قطع شد ادامه پیدا کند.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((pending) => (
            <li key={pending.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0" data-testid="pending-upload" data-video-id={pending.id}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileVideo aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" dir="auto" title={pending.filename}>
                  {pending.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.bytes(pending.sizeBytes)} · شروع شده <span suppressHydrationWarning>{f.relative(pending.createdAt)}</span>
                </p>
                {problem?.id === pending.id && (
                  <p className="mt-1 text-xs text-destructive" role="alert">
                    {problem.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setProblem(null);
                    setTarget(pending);
                    inputRef.current?.click();
                  }}
                >
                  <Upload /> ادامه با انتخاب فایل
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`حذف بارگذاری ناتمام «${pending.filename}»`} onClick={() => setDiscarding(pending)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          type="file"
          accept={VIDEO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="انتخاب فایل برای ادامه‌ی بارگذاری"
          data-testid="pending-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            const pending = target;
            setTarget(null);
            if (!file || !pending) return;
            // The server's copy is a prefix of the ORIGINAL file; any other file would end up corrupt.
            if (file.size !== pending.sizeBytes) {
              setProblem({ id: pending.id, message: `این فایل با بارگذاری ناتمام یکی نیست (حجم باید ${f.bytes(pending.sizeBytes)} باشد). همان فایل اصلی را انتخاب کنید.` });
              return;
            }
            onContinue(pending, file);
          }}
        />
      </CardContent>

      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => !open && setDiscarding(null)}
        destructive
        title="بارگذاری ناتمام حذف شود؟"
        description={discarding ? `بخشی که از «${discarding.filename}» ارسال شده پاک می‌شود و برای ادامه باید از اول بارگذاری کنید.` : undefined}
        confirmLabel="حذف"
        onConfirm={async () => {
          if (discarding) await onDiscard(discarding);
        }}
      />
    </Card>
  );
}
