'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { common } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 8 * 1024 * 1024;

type Props = {
  /** Route Handler of the slot, e.g. `/api/studio/channel/banner`. */
  endpoint: string;
  variant: 'avatar' | 'banner';
  /** Accessible name of the thing being uploaded: «تصویر نمایه», «بنر کانال». */
  label: string;
  /** Size / format hint under the buttons. */
  hint: string;
  /** Used for the initials fallback of avatars. */
  name: string;
  initialUrl: string | null;
};

/**
 * Upload / replace / remove one image. The server is the authority (magic bytes, decoding, size, rate limit):
 * the checks here only save a round trip. Status is announced through a live region; the file input is a real,
 * labelled control (`getByLabel`) that is also reachable by keyboard.
 */
export function ImageUploader({ endpoint, variant, label, hint, name, initialUrl }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function send(init: RequestInit, kind: 'upload' | 'remove'): Promise<{ url: string | null } | null> {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(endpoint, init);
      const json = (await res.json().catch(() => null)) as { url?: string | null; error?: { message?: string } } | null;
      if (!res.ok) throw new Error(json?.error?.message ?? common.genericError);
      return { url: json?.url ?? null };
    } catch (err) {
      const message = err instanceof TypeError ? common.networkError : err instanceof Error ? err.message : common.genericError;
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = ''; // picking the same file again must fire `change`
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('فقط تصویر JPG، PNG یا WebP پذیرفته می‌شود.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('حجم تصویر نباید بیشتر از ۸ مگابایت باشد.');
      return;
    }
    const body = new FormData();
    body.set('file', file);
    const result = await send({ method: 'POST', body }, 'upload');
    if (result) {
      setUrl(result.url);
      setSaved(true);
      toast.success('تصویر ذخیره شد.');
      router.refresh(); // the header and menu read the new image from the server
    }
  }

  async function onRemove() {
    const result = await send({ method: 'DELETE' }, 'remove');
    if (result) {
      setUrl(null);
      setSaved(true);
      toast.success('تصویر حذف شد.');
      router.refresh();
    }
  }

  return (
    <div className={cn('flex gap-4', variant === 'avatar' ? 'flex-wrap items-center' : 'flex-col')}>
      {variant === 'avatar' ? (
        <ChannelAvatar name={name} src={url} size="2xl" className="shrink-0 ring-4 ring-muted" />
      ) : (
        <div className="aspect-[4/1] w-full overflow-hidden rounded-xl border bg-muted">
          {url ? (
            <img src={url} alt="" className="size-full object-cover" data-testid="banner-preview" />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-muted-foreground">بنری انتخاب نشده است</div>
          )}
        </div>
      )}

      <div className="min-w-0 space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={`انتخاب ${label}`}
          onChange={(event) => void onPick(event.target.files?.[0])}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
            {busy === 'upload' ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            {url ? `تغییر ${label}` : `بارگذاری ${label}`}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy !== null} onClick={() => void onRemove()}>
              {busy === 'remove' ? <Loader2 className="animate-spin" /> : <Trash2 />}
              حذف
            </Button>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground">{hint}</p>
        <p role="status" aria-live="polite" className="min-h-5 text-[13px]">
          {busy === 'upload' && <span className="text-muted-foreground">در حال بارگذاری…</span>}
          {busy === 'remove' && <span className="text-muted-foreground">در حال حذف…</span>}
          {saved && !busy && <span className="text-success">انجام شد.</span>}
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
