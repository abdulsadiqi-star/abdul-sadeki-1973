'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/forms/form-error';
import { checkHandleAction, createChannelAction } from '@/features/auth/actions';
import { createChannelSchema, handleSchema, type CreateChannelInput } from '@/features/auth/schemas';
import { applyServerErrors } from '@/lib/form-utils';
import { suggestHandle } from '@/lib/persian';

type HandleState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function CreateChannelForm({ suggestedFrom }: { suggestedFrom?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ handle: string; available: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CreateChannelInput>({
    resolver: zodResolver(createChannelSchema),
    defaultValues: { name: '', handle: suggestedFrom ? suggestHandle(suggestedFrom) : '', description: '' },
  });

  // Availability is derived: only the async answer for the *current* handle is stored.
  const handle = useWatch({ control: form.control, name: 'handle' }) ?? '';
  const parsedHandle = handleSchema.safeParse(handle);
  const validHandle = parsedHandle.success ? parsedHandle.data : null;
  const handleState: HandleState = !handle
    ? 'idle'
    : !validHandle
      ? 'invalid'
      : checked?.handle === validHandle
        ? checked.available
          ? 'available'
          : 'taken'
        : 'checking';

  useEffect(() => {
    if (!validHandle || checked?.handle === validHandle) return;
    const timer = setTimeout(async () => {
      const res = await checkHandleAction(validHandle);
      if (res.ok) setChecked({ handle: validHandle, available: res.data.available });
    }, 450);
    return () => clearTimeout(timer);
  }, [validHandle, checked?.handle]);

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await createChannelAction(values);
      if (!res.ok) {
        setFormError(applyServerErrors(form, res));
        return;
      }
      toast.success('کانال شما ساخته شد!');
      router.replace('/studio');
      router.refresh();
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={formError} />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>نام کانال</FormLabel>
              <FormControl>
                <Input placeholder="مثلاً: آشپزی با مریم" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="handle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>شناسه‌ی کانال</FormLabel>
              {/* FormControl must wrap the <input> itself so the label/aria wiring reaches it. */}
              <div className="relative">
                <FormControl>
                  <Input dir="ltr" className="pe-10 text-start" placeholder="my-channel" autoCapitalize="none" autoCorrect="off" spellCheck={false} {...field} />
                </FormControl>
                <span className="absolute end-3 top-1/2 -translate-y-1/2" aria-live="polite">
                  {handleState === 'checking' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  {handleState === 'available' && <CheckCircle2 className="size-4 text-success" aria-label="آزاد است" />}
                  {(handleState === 'taken' || handleState === 'invalid') && <XCircle className="size-4 text-destructive" aria-label="قابل استفاده نیست" />}
                </span>
              </div>
              <FormDescription>
                نشانی کانال شما: <bdi className="ltr-isolate font-medium">/channel/{handle || 'my-channel'}</bdi>
                {handleState === 'taken' && <span className="ms-2 text-destructive">این شناسه قبلاً گرفته شده است.</span>}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>توضیحات (اختیاری)</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder="کانال شما درباره‌ی چیست؟" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" className="w-full" disabled={pending || handleState === 'taken'}>
          {pending && <Loader2 className="animate-spin" />}
          ساخت کانال
        </Button>
      </form>
    </Form>
  );
}
