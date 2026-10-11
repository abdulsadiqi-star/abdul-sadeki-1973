'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { createPlaylistAction, updatePlaylistAction } from '@/features/library/actions';
import { playlistVisibilityHint } from '@/features/library/labels';
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX, createPlaylistSchema, type CreatePlaylistInput } from '@/features/library/schemas';
import { applyServerErrors } from '@/lib/form-utils';
import { labels } from '@/lib/i18n/fa';

type Props = {
  /** The element that opens the dialog (a Button). */
  children: ReactNode;
  /** Present → edit that playlist; absent → create a new one. */
  playlist?: { id: string; title: string; description: string; visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' };
};

/** Create or edit a playlist. Validation runs in the browser AND again on the server (Zod). */
export function PlaylistFormDialog({ children, playlist }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = !!playlist;

  const form = useForm<CreatePlaylistInput>({
    resolver: zodResolver(createPlaylistSchema),
    defaultValues: { title: playlist?.title ?? '', description: playlist?.description ?? '', visibility: playlist?.visibility ?? 'PRIVATE' },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      if (playlist) {
        const result = await updatePlaylistAction({ id: playlist.id, ...values });
        if (!result.ok) {
          setFormError(applyServerErrors(form, result));
          return;
        }
        toast.success('تغییرات لیست پخش ذخیره شد.');
        setOpen(false);
        router.refresh();
      } else {
        const result = await createPlaylistAction(values);
        if (!result.ok) {
          setFormError(applyServerErrors(form, result));
          return;
        }
        toast.success('لیست پخش ساخته شد.');
        setOpen(false);
        router.push(`/playlist/${result.data.id}` as Route);
      }
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFormError(null);
          form.reset({ title: playlist?.title ?? '', description: playlist?.description ?? '', visibility: playlist?.visibility ?? 'PRIVATE' });
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'ویرایش لیست پخش' : 'ساخت لیست پخش'}</DialogTitle>
          <DialogDescription>
            {editing ? 'عنوان، توضیح و وضعیت نمایش لیست را تغییر دهید.' : 'برای دسته‌بندی ویدیوهای موردعلاقه‌تان یک لیست بسازید.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <FormError message={formError} />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>عنوان لیست</FormLabel>
                  <FormControl>
                    <Input maxLength={PLAYLIST_TITLE_MAX} placeholder="مثلاً: آموزش‌های برنامه‌نویسی" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>توضیح (اختیاری)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={PLAYLIST_DESCRIPTION_MAX} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="visibility"
              render={({ field }) => (
                <FormItem>
                  <FormLabel id="playlist-visibility-label">وضعیت نمایش</FormLabel>
                  <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby="playlist-visibility-label" className="gap-2">
                    {(['PRIVATE', 'UNLISTED', 'PUBLIC'] as const).map((value) => (
                      <label
                        key={value}
                        htmlFor={`playlist-visibility-${value}`}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40"
                      >
                        <RadioGroupItem id={`playlist-visibility-${value}`} value={value} className="mt-1" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{labels.visibility[value]}</span>
                          <span className="block text-[13px] leading-5 text-muted-foreground">{playlistVisibilityHint[value]}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                انصراف
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {editing ? 'ذخیره' : 'ساخت لیست'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
