import { Check, Circle } from 'lucide-react';
import { getFormatter } from '@/lib/format-server';
import { cn } from '@/lib/utils';
import { verificationRequirements, type RequirementKey, type RequirementState } from '../rules';

const r = verificationRequirements;

const text: Record<RequirementKey, (n: (value: number) => string) => string> = {
  email: () => 'ایمیل حساب شما تأیید شده باشد.',
  profile: (n) => `تصویر نمایه‌ی کانال را گذاشته و توضیح کانال را دست‌کم در ${n(r.minDescriptionLength)} نویسه نوشته باشید.`,
  age: (n) => `دست‌کم ${n(r.minChannelAgeDays)} روز از ساخت کانال گذشته باشد.`,
  videos: (n) => `دست‌کم ${n(r.minPublicVideos)} ویدیوی عمومی منتشر کرده باشید.`,
};

const keys: RequirementKey[] = ['email', 'profile', 'age', 'videos'];

const progressUnit: Partial<Record<RequirementKey, string>> = { age: 'روز', videos: 'ویدیو' };

/**
 * The measurable requirements. With `states` (a channel owner looking at their own channel) every line shows whether it is
 * met and the progress; without, it is the plain list for visitors.
 */
export async function VerificationRequirements({ states }: { states?: RequirementState[] }) {
  const f = await getFormatter();
  const n = (value: number) => f.number(value);
  return (
    <ul className="space-y-2.5">
      {keys.map((key) => {
        const state = states?.find((s) => s.key === key);
        return (
          <li key={key} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                state?.met ? 'border-success bg-success text-white' : 'text-muted-foreground',
              )}
            >
              {state?.met ? <Check className="size-3.5" /> : <Circle className="size-2 fill-current" />}
            </span>
            <span className="min-w-0 leading-7">
              {text[key](n)}
              {state && (
                <span className="ms-2 text-[13px] text-muted-foreground">
                  <span className="sr-only">{state.met ? 'برقرار است. ' : 'هنوز برقرار نیست. '}</span>
                  {progressUnit[key] ? `(${n(state.current)} از ${n(state.target)} ${progressUnit[key]})` : key === 'profile' ? `(${n(state.current)} از ${n(state.target)} مورد)` : null}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
