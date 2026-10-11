'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, ImagePlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormatter } from '@/components/providers/format-provider';
import { selectThumbnailAction } from '@/features/videos-studio/actions';
import { postForm } from '@/features/videos-studio/client/post-form';
import { studioMessages } from '@/features/videos-studio/labels';
import type { ThumbnailOption } from '@/features/videos-studio/queries';
import { cn } from '@/lib/utils';

const MAX_BYTES = 8 * 1024 * 1024;

/** Pick one of the generated frames or upload your own image. Disabled until the video is processed. */
export function VideoThumbnailPicker({
  videoId,
  thumbnails,
  posterUrl,
  customPoster,
  ready,
}: {
  videoId: string;
  thumbnails: ThumbnailOption[];
  posterUrl: string | null;
  customPoster: boolean;
  ready: boolean;
}) {
  const f = useFormatter();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<number | null>(thumbnails.find((t) => t.selected)?.index ?? null);
  const [custom, setCustom] = useState<{ url: string } | null>(customPoster && posterUrl ? { url: posterUrl } : null);
  const [busy, setBusy] = useState<number | 'custom' | null>(null);

  async function choose(index: number) {
    if (busy !== null || index === selected) return;
    setBusy(index);
    try {
      const result = await selectThumbnailAction({ id: videoId, index });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSelected(index);
      setCustom(null);
      toast.success(studioMessages.thumbnailChanged);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error(`حجم تصویر (${f.bytes(file.size)}) بیشتر از ۸ مگابایت است.`);
      return;
    }
    setBusy('custom');
    try {
      const form = new FormData();
      form.set('file', file);
      const result = await postForm<{ posterUrl: string }>(`/api/studio/videos/${videoId}/thumbnail`, form);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setCustom({ url: result.data.posterUrl });
      setSelected(null);
      toast.success(studioMessages.thumbnailChanged);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>تصویر بندانگشتی</CardTitle>
        <CardDescription>تصویری که پیش از پخش، در فهرست‌ها و نتایج جستجو نمایش داده می‌شود.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!ready ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">پس از پایان پردازش ویدیو، چند تصویر پیشنهادی ساخته می‌شود و می‌توانید یکی را انتخاب کنید.</p>
        ) : (
          <>
            <div role="radiogroup" aria-label="تصاویر پیشنهادی" className="grid gap-3 sm:grid-cols-3">
              {thumbnails.map((thumbnail) => {
                const active = selected === thumbnail.index;
                return (
                  <button
                    key={thumbnail.index}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`تصویر پیشنهادی ${f.number(thumbnail.index)}`}
                    data-testid="thumbnail-option"
                    disabled={busy !== null}
                    onClick={() => choose(thumbnail.index)}
                    className={cn(
                      'group relative aspect-video overflow-hidden rounded-lg border-2 bg-muted outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      active ? 'border-primary' : 'border-transparent hover:border-border',
                    )}
                  >
                    <img src={thumbnail.url} alt="" loading="lazy" className="size-full object-cover" />
                    {active && (
                      <span className="absolute start-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check className="size-4" />
                      </span>
                    )}
                    {busy === thumbnail.index && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                        <Loader2 className="size-6 animate-spin" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
              {custom && (
                <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md border-2 border-primary">
                  <img src={custom.url} alt="تصویر دلخواه شما" className="size-full object-cover" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{custom ? 'تصویر دلخواه شما در حال استفاده است' : 'تصویر دلخواه'}</p>
                <p className="text-xs text-muted-foreground">JPG، PNG یا WebP؛ حداکثر ۸ مگابایت. نسبت ۱۶ به ۹ بهترین نتیجه را می‌دهد.</p>
              </div>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
                {busy === 'custom' ? <Loader2 className="animate-spin" /> : <ImagePlus />} بارگذاری تصویر
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-label="انتخاب تصویر بندانگشتی"
                data-testid="thumbnail-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
