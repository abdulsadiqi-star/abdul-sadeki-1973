'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFormatter } from '@/components/providers/format-provider';
import { getPlayerTime } from '@/components/player/player-bridge';
import { buildShareUrl } from '@/components/player/player-utils';

const subscribeNothing = () => () => undefined;

/**
 * Share dialog: copy the link (with a toast), the Web Share sheet when the browser has one, and an optional
 * "start at the current time" (adds `?t=`). The position is captured when the dialog opens.
 */
export function ShareButton({ videoId, title, className }: { videoId: string; title: string; className?: string }) {
  const f = useFormatter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [time, setTime] = useState<number | null>(null);
  const [withTime, setWithTime] = useState(false);
  const [copied, setCopied] = useState(false);
  const canNativeShare = useSyncExternalStore(
    subscribeNothing,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  );

  const seconds = time !== null && time >= 1 ? Math.floor(time) : null;
  const url = origin ? buildShareUrl(origin, videoId, withTime ? seconds : null) : '';

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setOrigin(window.location.origin);
      setTime(getPlayerTime(videoId));
      setWithTime(false);
      setCopied(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (insecure context / permissions): fall back to selecting the text and copying it.
      const input = inputRef.current;
      input?.focus();
      input?.select();
      if (!document.execCommand?.('copy')) {
        toast.error('کپی خودکار انجام نشد؛ پیوند را انتخاب و دستی کپی کنید.');
        return;
      }
    }
    setCopied(true);
    toast.success('پیوند ویدیو کپی شد.');
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, url });
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== 'AbortError') toast.error('اشتراک‌گذاری انجام نشد.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" shape="pill" className={className}>
          <Share2 />
          اشتراک‌گذاری
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>اشتراک‌گذاری ویدیو</DialogTitle>
          <DialogDescription>پیوند را کپی کنید یا مستقیم برای دوستانتان بفرستید.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={url}
            aria-label="پیوند ویدیو"
            dir="ltr"
            className="ltr-isolate"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" onClick={copy} disabled={!url} aria-label="کپی پیوند" className="shrink-0">
            {copied ? <Check /> : <Copy />}
            {copied ? 'کپی شد' : 'کپی'}
          </Button>
        </div>

        {seconds !== null && (
          <div className="flex items-center gap-2">
            <Checkbox id={`share-time-${videoId}`} checked={withTime} onCheckedChange={(v) => setWithTime(v === true)} />
            <Label htmlFor={`share-time-${videoId}`} className="cursor-pointer leading-6">
              شروع از زمان فعلی (<bdi className="tabular-nums">{f.duration(seconds)}</bdi>)
            </Label>
          </div>
        )}

        {canNativeShare && (
          <Button type="button" variant="outline" onClick={nativeShare} disabled={!url}>
            <Share2 />
            ارسال با برنامه‌های دیگر
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
