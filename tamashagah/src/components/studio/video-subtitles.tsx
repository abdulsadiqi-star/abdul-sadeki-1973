'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Captions, Loader2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useFormatter } from '@/components/providers/format-provider';
import { deleteSubtitleAction } from '@/features/videos-studio/actions';
import { postForm } from '@/features/videos-studio/client/post-form';
import { languageLabel, studioMessages, videoLanguages } from '@/features/videos-studio/labels';
import type { SubtitleDto } from '@/features/videos-studio/service';
import { MAX_SUBTITLE_BYTES } from '@/features/videos-studio/subtitles';

/** Subtitle tracks of a video: one per language (uploading the same language again replaces it). SRT or WebVTT. */
export function VideoSubtitles({ videoId, subtitles }: { videoId: string; subtitles: SubtitleDto[] }) {
  const f = useFormatter();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState('fa');
  const [label, setLabel] = useState('فارسی');
  const [labelTouched, setLabelTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<SubtitleDto | null>(null);

  async function add() {
    setProblem(null);
    if (!file) return setProblem('فایل زیرنویس (SRT یا VTT) را انتخاب کنید.');
    if (!label.trim()) return setProblem('نام زیرنویس را وارد کنید.');
    if (file.size > MAX_SUBTITLE_BYTES) return setProblem(`حجم فایل (${f.bytes(file.size)}) بیشتر از ۱ مگابایت است.`);
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('language', language);
      form.set('label', label.trim());
      const result = await postForm<{ id: string; cues: number }>(`/api/studio/videos/${videoId}/subtitles`, form);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      toast.success(studioMessages.subtitleAdded);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>زیرنویس</CardTitle>
        <CardDescription>فایل SRT یا VTT اضافه کنید؛ بیننده‌ها می‌توانند زیرنویس را در پخش‌کننده روشن کنند.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {subtitles.length > 0 ? (
          <ul className="divide-y rounded-lg border" data-testid="subtitle-list">
            {subtitles.map((subtitle) => (
              <li key={subtitle.id} className="flex items-center gap-3 p-3" data-testid="subtitle-item">
                <Captions aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {subtitle.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {languageLabel(subtitle.language)}
                    {subtitle.cues != null && ` · ${f.number(subtitle.cues)} خط`}
                  </p>
                </div>
                {subtitle.isDefault && <Badge variant="secondary">پیش‌فرض</Badge>}
                <Button size="icon-sm" variant="ghost" aria-label={`حذف زیرنویس «${subtitle.label}»`} onClick={() => setRemoving(subtitle)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">هنوز زیرنویسی اضافه نشده است.</p>
        )}

        <form
          className="space-y-3 rounded-lg border bg-muted/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <p className="text-sm font-medium">افزودن زیرنویس</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${videoId}-sub-lang`}>زبان</Label>
              <Select
                value={language}
                onValueChange={(value) => {
                  setLanguage(value);
                  if (!labelTouched) setLabel(languageLabel(value));
                }}
              >
                <SelectTrigger id={`${videoId}-sub-lang`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {videoLanguages.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${videoId}-sub-label`}>نامی که بیننده می‌بیند</Label>
              <Input
                id={`${videoId}-sub-label`}
                value={label}
                maxLength={40}
                dir="auto"
                onChange={(event) => {
                  setLabel(event.target.value);
                  setLabelTouched(true);
                }}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${videoId}-sub-file`}>فایل زیرنویس</Label>
            <Input
              ref={fileRef}
              id={`${videoId}-sub-file`}
              type="file"
              accept=".srt,.vtt,text/vtt,application/x-subrip"
              data-testid="subtitle-input"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} افزودن زیرنویس
          </Button>
        </form>
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        destructive
        title="زیرنویس حذف شود؟"
        description={removing ? `زیرنویس «${removing.label}» از این ویدیو برداشته می‌شود.` : undefined}
        confirmLabel="حذف زیرنویس"
        onConfirm={async () => {
          if (!removing) return false;
          const result = await deleteSubtitleAction({ id: videoId, assetId: removing.id });
          if (!result.ok) {
            toast.error(result.message);
            return false;
          }
          toast.success(studioMessages.subtitleRemoved);
          router.refresh();
        }}
      />
    </Card>
  );
}
