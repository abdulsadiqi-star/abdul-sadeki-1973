'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch, type FieldErrors, type Resolver, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { ChevronDown, Globe, Link2, Loader2, Lock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { JalaliDateTimeInput } from '@/components/forms/jalali-date-picker';
import { useFormatter } from '@/components/providers/format-provider';
import { updateVideoAction } from '@/features/videos-studio/actions';
import { kindChoices, publishModes, studioMessages, videoLanguages } from '@/features/videos-studio/labels';
import type { MetadataFormValues } from '@/features/videos-studio/metadata';
import { videoMetadataSchema } from '@/features/videos-studio/schemas';
import type { UpdateResult } from '@/features/videos-studio/service';
import type { ActionFailure } from '@/lib/errors';
import { applyServerErrors } from '@/lib/form-utils';
import { labels } from '@/lib/i18n/fa';
import { cn } from '@/lib/utils';
import type { ProcessingStatus, PublishStatus } from '@/generated/prisma/enums';
import { VideoTagInput } from './video-tag-input';

export type { MetadataFormValues };

export type CategoryOption = { id: string; nameFa: string };

const NO_CATEGORY = '__none__';

/** A schedule needs a few minutes of lead time (the scheduler runs every minute). Evaluated on submit, not on render. */
const tooSoon = (iso: string): boolean => new Date(iso).getTime() < Date.now() + 60_000;
const scheduleBounds = () => ({ min: new Date(), max: new Date(Date.now() + 365 * 24 * 3_600_000) });

/**
 * Validate with the SAME schema the server uses, but hand the raw values on (the schema's transforms are for the
 * server: dates, normalized text). Only the first message per field is kept.
 */
const metadataResolver: Resolver<MetadataFormValues> = async (values) => {
  const parsed = videoMetadataSchema.safeParse(values);
  if (parsed.success) return { values, errors: {} };
  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'root');
    errors[field] ??= { type: issue.code, message: issue.message };
  }
  return { values: {}, errors: errors as FieldErrors<MetadataFormValues> };
};

/** The action receives `{ id, metadata }`, so its field errors come back as `metadata.title`; the form knows `title`. */
function stripMetadataPrefix(failure: ActionFailure): ActionFailure {
  if (!failure.fieldErrors) return failure;
  const fieldErrors = Object.fromEntries(Object.entries(failure.fieldErrors).map(([key, messages]) => [key.replace(/^metadata\./, ''), messages]));
  return { ...failure, fieldErrors };
}

function Counter({ length, max }: { length: number; max: number }) {
  const f = useFormatter();
  return (
    <span className={cn('ms-auto shrink-0 text-xs tabular-nums', length > max ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true">
      {f.number(length)} / {f.number(max)}
    </span>
  );
}

const visibilityIcons = { PUBLIC: Globe, UNLISTED: Link2, PRIVATE: Lock } as const;

function OptionCard({ htmlFor, children, className }: { htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <Label
      htmlFor={htmlFor}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border bg-background p-3 font-normal transition-colors hover:bg-accent/40',
        'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
        className,
      )}
    >
      {children}
    </Label>
  );
}

// ---------------------------------------------------------------------------
// Field groups
// ---------------------------------------------------------------------------

function BasicFields({ form }: { form: UseFormReturn<MetadataFormValues> }) {
  return (
    <>
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              عنوان ویدیو <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Input {...field} dir="auto" autoComplete="off" placeholder="عنوانی که بیننده‌ها می‌بینند" />
            </FormControl>
            <div className="flex gap-2">
              <FormMessage />
              <Counter length={field.value.length} max={100} />
            </div>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>توضیحات</FormLabel>
            <FormControl>
              <Textarea {...field} dir="auto" rows={5} placeholder="درباره‌ی ویدیو بنویسید…" />
            </FormControl>
            <div className="flex gap-2">
              <FormMessage />
              <Counter length={field.value.length} max={5000} />
            </div>
          </FormItem>
        )}
      />
    </>
  );
}

function DiscoveryFields({ form, categories, showLanguage }: { form: UseFormReturn<MetadataFormValues>; categories: CategoryOption[]; showLanguage: boolean }) {
  return (
    <>
      <FormField
        control={form.control}
        name="tags"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>برچسب‌ها</FormLabel>
            <FormControl>
              <VideoTagInput value={field.value} onChange={field.onChange} invalid={!!fieldState.error} />
            </FormControl>
            <FormDescription>تا ۱۵ برچسب؛ با Enter یا ویرگول جدا کنید. برچسب‌ها به پیدا شدن ویدیو کمک می‌کنند.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className={cn('grid gap-4', showLanguage && 'sm:grid-cols-2')}>
        <FormField
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>دسته‌بندی</FormLabel>
              <Select value={field.value ?? NO_CATEGORY} onValueChange={(v) => field.onChange(v === NO_CATEGORY ? null : v)}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="انتخاب دسته‌بندی" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>بدون دسته‌بندی</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.nameFa}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {showLanguage && (
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>زبان ویدیو</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {videoLanguages.map((language) => (
                      <SelectItem key={language.code} value={language.code}>
                        {language.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>
    </>
  );
}

function PublishingFields({
  form,
  ids,
  context,
}: {
  form: UseFormReturn<MetadataFormValues>;
  ids: string;
  context: { publishStatus: PublishStatus };
}) {
  const f = useFormatter();
  // A live video is either published or taken back to a draft; scheduling it again makes no sense.
  const modes = publishModes.filter((mode) => mode.value !== 'SCHEDULE' || context.publishStatus !== 'PUBLISHED');
  const mode = useWatch({ control: form.control, name: 'publishMode' });
  const [bounds] = useState(scheduleBounds);

  return (
    <>
      <FormField
        control={form.control}
        name="visibility"
        render={({ field }) => (
          <FormItem>
            <Label id={`${ids}-visibility-label`}>چه کسانی ببینند؟</Label>
            <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby={`${ids}-visibility-label`} className="grid gap-2 sm:grid-cols-3">
              {(['PUBLIC', 'UNLISTED', 'PRIVATE'] as const).map((value) => {
                const Icon = visibilityIcons[value];
                return (
                  <OptionCard key={value} htmlFor={`${ids}-vis-${value}`}>
                    <RadioGroupItem id={`${ids}-vis-${value}`} value={value} className="mt-1" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="size-4 text-muted-foreground" /> {labels.visibility[value]}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{labels.visibilityHint[value]}</span>
                    </span>
                  </OptionCard>
                );
              })}
            </RadioGroup>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="publishMode"
        render={({ field }) => (
          <FormItem>
            <Label id={`${ids}-publish-label`}>زمان انتشار</Label>
            <RadioGroup
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value);
                if (value === 'SCHEDULE' && !form.getValues('scheduledFor')) {
                  // A sensible starting point: tomorrow, same time, on a 5-minute mark.
                  const start = new Date(Date.now() + 24 * 3_600_000);
                  start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5, 0, 0);
                  form.setValue('scheduledFor', start.toISOString(), { shouldDirty: true });
                }
              }}
              aria-labelledby={`${ids}-publish-label`}
              className={cn('grid gap-2', modes.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}
            >
              {modes.map((item) => (
                <OptionCard key={item.value} htmlFor={`${ids}-mode-${item.value}`}>
                  <RadioGroupItem id={`${ids}-mode-${item.value}`} value={item.value} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.hint}</span>
                  </span>
                </OptionCard>
              ))}
            </RadioGroup>
            <FormMessage />
          </FormItem>
        )}
      />

      {mode === 'SCHEDULE' && (
        <FormField
          control={form.control}
          name="scheduledFor"
          render={({ field }) => (
            <FormItem>
              <FormLabel>تاریخ و ساعت انتشار</FormLabel>
              <JalaliDateTimeInput
                value={field.value ? new Date(field.value) : null}
                onChange={(date) => field.onChange(date ? date.toISOString() : null)}
                min={bounds.min}
                max={bounds.max}
                aria-label="تاریخ انتشار"
              />
              <FormDescription>
                {field.value ? `منتشر می‌شود: ${f.dateTime(field.value)} (به وقت تهران)` : 'تاریخ و ساعت را انتخاب کنید (به وقت تهران).'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
}

function OptionFields({ form, ids }: { form: UseFormReturn<MetadataFormValues>; ids: string }) {
  return (
    <>
      <FormField
        control={form.control}
        name="kindChoice"
        render={({ field }) => (
          <FormItem>
            <Label id={`${ids}-kind-label`}>نوع ویدیو</Label>
            <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby={`${ids}-kind-label`} className="grid gap-2 sm:grid-cols-3">
              {kindChoices.map((choice) => (
                <OptionCard key={choice.value} htmlFor={`${ids}-kind-${choice.value}`}>
                  <RadioGroupItem id={`${ids}-kind-${choice.value}`} value={choice.value} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{choice.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{choice.hint}</span>
                  </span>
                </OptionCard>
              ))}
            </RadioGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="commentsEnabled"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0">
                <FormLabel>دیدگاه‌ها</FormLabel>
                <FormDescription>بیننده‌ها بتوانند زیر ویدیو دیدگاه بگذارند.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ageRestricted"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0">
                <FormLabel>محدودیت سنی (۱۸+)</FormLabel>
                <FormDescription>این ویدیو مناسب کودکان و نوجوانان نیست.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

type Props = {
  /** The video to save to; `null` until the server created it (the form can be filled in already). */
  videoId: string | null;
  initial: MetadataFormValues;
  categories: CategoryOption[];
  context: { processingStatus: ProcessingStatus; publishStatus: PublishStatus };
  /**
   * `inline`: title and description, the rest behind "more settings" (one card per uploading file).
   * `cards`: everything visible in sections with a sticky save bar (edit page).
   */
  layout: 'inline' | 'cards';
  onSaved?: (result: UpdateResult, values: MetadataFormValues) => void;
  /** Called with `true` while the form has unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
};

export function VideoMetadataForm({ videoId, initial, categories, context, layout, onSaved, onDirtyChange, className }: Props) {
  const router = useRouter();
  const ids = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const form = useForm<MetadataFormValues>({ resolver: metadataResolver, defaultValues: initial, mode: 'onTouched' });
  const dirty = form.formState.isDirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = form.handleSubmit(
    async (values) => {
    if (!videoId) return;
    setFormError(null);
    if (values.publishMode === 'SCHEDULE' && values.scheduledFor && tooSoon(values.scheduledFor)) {
      form.setError('scheduledFor', { type: 'validate', message: studioMessages.scheduleInPast });
      return;
    }
    setPending(true);
    try {
      const result = await updateVideoAction({ id: videoId, metadata: values });
      if (!result.ok) {
        setFormError(applyServerErrors(form, stripMetadataPrefix(result)));
        return;
      }
      toast.success(studioMessages.saved);
      form.reset(values);
      onSaved?.(result.data, values);
      if (layout === 'cards') router.refresh();
    } catch {
      setFormError('ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
    } finally {
      setPending(false);
    }
    },
    // Errors in fields that sit behind "more settings" would otherwise be invisible.
    (errors) => {
      if (Object.keys(errors).some((name) => name !== 'title' && name !== 'description')) setMoreOpen(true);
    },
  );

  const saveDisabled = pending || !videoId || !dirty;
  const hint = !videoId ? 'پس از شروع بارگذاری می‌توانید اطلاعات را ذخیره کنید.' : dirty ? 'تغییرات ذخیره‌نشده دارید.' : null;

  const saveButton = (
    <Button type="submit" disabled={saveDisabled} size={layout === 'cards' ? 'default' : 'sm'}>
      {pending && <Loader2 className="animate-spin" />}
      {layout === 'cards' ? 'ذخیره‌ی تغییرات' : 'ذخیره‌ی اطلاعات'}
    </Button>
  );

  if (layout === 'cards') {
    return (
      <Form {...form}>
        <form onSubmit={save} noValidate className={cn('space-y-5', className)} aria-label="ویرایش اطلاعات ویدیو">
          <FormError message={formError} />
          <Card>
            <CardHeader>
              <CardTitle>جزئیات ویدیو</CardTitle>
              <CardDescription>عنوان و توضیحات اولین چیزی است که بیننده‌ها می‌بینند.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <BasicFields form={form} />
              <DiscoveryFields form={form} categories={categories} showLanguage />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>انتشار و دسترسی</CardTitle>
              <CardDescription>تعیین کنید ویدیو چه زمانی و برای چه کسانی نمایش داده شود.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <PublishingFields form={form} ids={ids} context={context} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>گزینه‌های بیشتر</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <OptionFields form={form} ids={ids} />
            </CardContent>
          </Card>
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
            <p className={cn('text-sm', dirty ? 'font-medium text-warning-foreground dark:text-warning' : 'text-muted-foreground')} role="status">
              {hint ?? 'همه‌ی تغییرات ذخیره شده است.'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending || !dirty}
                onClick={() => {
                  form.reset(initial);
                  setFormError(null);
                }}
              >
                <RotateCcw /> بازنشانی
              </Button>
              {saveButton}
            </div>
          </div>
        </form>
      </Form>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={save} noValidate className={cn('space-y-4', className)} aria-label="اطلاعات ویدیو">
        <FormError message={formError} />
        <BasicFields form={form} />
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="-ms-2" aria-expanded={moreOpen}>
              <ChevronDown className={cn('transition-transform', moreOpen && 'rotate-180')} />
              {moreOpen ? 'بستن تنظیمات' : 'تنظیمات بیشتر (برچسب، دسته‌بندی، انتشار، دسترسی)'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-5 pt-3">
            <DiscoveryFields form={form} categories={categories} showLanguage />
            <PublishingFields form={form} ids={ids} context={context} />
            <OptionFields form={form} ids={ids} />
          </CollapsibleContent>
        </Collapsible>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className={cn('text-sm', dirty ? 'font-medium text-warning-foreground dark:text-warning' : 'text-muted-foreground')} role="status">
            {hint}
          </p>
          {saveButton}
        </div>
      </form>
    </Form>
  );
}

