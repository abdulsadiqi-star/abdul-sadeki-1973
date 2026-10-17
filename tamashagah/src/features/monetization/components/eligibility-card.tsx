import { CheckCircle2, CircleDashed, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { monetizationRequirements } from '@/config/site';
import { getFormatter } from '@/lib/format-server';
import { ceilTo, floorTo, type Eligibility, type RequirementProgress } from '../eligibility';

function describe(item: RequirementProgress, f: Awaited<ReturnType<typeof getFormatter>>) {
  const hours = { maximumFractionDigits: 1 } as const;
  switch (item.key) {
    case 'followers':
      return {
        title: 'دنبال‌کنندگان',
        reached: `${f.number(item.current)} از ${f.number(item.required)} دنبال‌کننده`,
        missing: `${f.number(item.remaining)} دنبال‌کننده‌ی دیگر لازم است`,
      };
    case 'watchHours':
      return {
        title: `ساعت تماشا در ${f.number(monetizationRequirements.windowDays)} روز گذشته`,
        reached: `${f.number(floorTo(item.current, 1), hours)} از ${f.number(item.required)} ساعت`,
        missing: `${f.number(ceilTo(item.remaining, 1), hours)} ساعت تماشای دیگر لازم است`,
      };
    case 'publicVideos':
      return {
        title: 'ویدیوهای عمومی',
        reached: `${f.number(item.current)} از ${f.number(item.required)} ویدیو`,
        missing: `${f.number(item.remaining)} ویدیوی عمومی دیگر لازم است`,
      };
  }
}

/**
 * Eligibility versus the program thresholds, computed from real data (see `queries.ts`): progress bars with a text
 * statement next to each (the bar is never the only carrier of the information) and an honest explanation of how
 * every number is obtained.
 */
export async function EligibilityCard({
  eligibility,
  suspended,
  sampleHours,
}: {
  eligibility: Eligibility;
  suspended: boolean;
  /** Hours of synthetic SEED events inside the window that were NOT counted (0 on real data). */
  sampleHours: number;
}) {
  const f = await getFormatter();
  return (
    <Card id="eligibility" data-testid="eligibility">
      <CardHeader>
        <CardTitle className="text-base">شرایط ورود به برنامه</CardTitle>
        <CardDescription>
          این اعداد همین حالا از اطلاعات واقعی کانال شما محاسبه شده‌اند. برای ارسال درخواست باید هر سه شرط برقرار باشد.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {suspended ? (
          <Alert variant="destructive">
            <Info />
            <AlertTitle>کانال شما مسدود شده است</AlertTitle>
            <AlertDescription>تا رفع انسداد کانال امکان ارسال درخواست درآمدزایی وجود ندارد.</AlertDescription>
          </Alert>
        ) : eligibility.eligible ? (
          <Alert variant="success" data-testid="eligible-banner">
            <CheckCircle2 />
            <AlertTitle>همه‌ی شرایط برقرار است</AlertTitle>
            <AlertDescription>می‌توانید درخواست خود را در بخش پایین ارسال کنید. تأیید نهایی با بررسی تیم تماشاگاه است.</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="info" data-testid="not-eligible-banner">
            <Info />
            <AlertTitle>هنوز همه‌ی شرایط برقرار نیست</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-5">
                {eligibility.missing.map((item) => (
                  <li key={item.key}>{describe(item, f).missing}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <ul className="grid gap-5 md:grid-cols-3">
          {eligibility.items.map((item) => {
            const text = describe(item, f);
            return (
              <li key={item.key} className="space-y-2.5 rounded-xl border p-4" data-testid={`requirement-${item.key}`} data-met={item.met}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">{text.title}</h3>
                  {item.met ? (
                    <Badge variant="success">
                      <CheckCircle2 aria-hidden="true" /> برقرار
                    </Badge>
                  ) : (
                    <Badge variant="muted">
                      <CircleDashed aria-hidden="true" /> در حال پیشرفت
                    </Badge>
                  )}
                </div>
                <Progress
                  value={item.progress * 100}
                  aria-label={`پیشرفت: ${text.title}`}
                  aria-valuetext={text.reached}
                  indicatorClassName={item.met ? 'bg-success' : undefined}
                />
                <p className="text-sm tabular-nums">{text.reached}</p>
                {!item.met && <p className="text-[13px] text-muted-foreground">{text.missing}</p>}
              </li>
            );
          })}
        </ul>

        {sampleHours > 0 && (
          <p className="rounded-lg bg-muted/60 px-3.5 py-2.5 text-[13px] text-muted-foreground" data-testid="sample-excluded">
            حدود {f.number(Math.round(sampleHours))} ساعت از رویدادهای نمونه‌ی آزمایشی در این بازه وجود دارد که در محاسبه‌ی شرایط به‌هیچ‌وجه لحاظ نشده است.
          </p>
        )}

        <details className="group rounded-xl border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">این اعداد چگونه محاسبه می‌شوند؟</summary>
          <ul className="mt-3 list-disc space-y-1.5 ps-5 text-muted-foreground">
            <li>دنبال‌کنندگان: تعداد فعلی دنبال‌کنندگان کانال شما.</li>
            <li>
              ساعت تماشا: مجموع مدت تماشای واقعی بینندگان که پخش‌کننده ثبت کرده است، در {f.number(monetizationRequirements.windowDays)} روز گذشته (روزِ جاری هم
              حساب می‌شود).
            </li>
            <li>ویدیوهای عمومی: ویدیوهای آماده‌ی پخش، منتشرشده و عمومی که ناظران از دسترس خارجشان نکرده‌اند.</li>
            <li>داده‌های نمونه‌ی آزمایشی (در محیط‌های آزمایشی) هرگز در این محاسبه نمی‌آیند.</li>
            <li>برقراری شرایط به‌معنای تأیید خودکار نیست؛ درخواست شما را تیم تماشاگاه بررسی می‌کند و نتیجه همین‌جا اعلام می‌شود.</li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
