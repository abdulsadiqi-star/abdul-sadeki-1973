import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getFormatter } from '@/lib/format-server';
import { jalaliMonthName } from '@/lib/analytics/time';
import type { MonetizationHistory } from '../queries';

/**
 * Real, monthly statistics of the last 12 Jalali months: views, watch hours and net follower growth. REAL events
 * only (synthetic SEED rows are never shown here — they are mentioned in a note when they exist).
 */
export async function HistoryTable({ history, showSampleNote }: { history: MonetizationHistory; showSampleNote: boolean }) {
  const f = await getFormatter();
  const maxViews = Math.max(1, ...history.months.map((m) => m.views));
  // newest first: the current month is what most people look at
  const months = [...history.months].reverse();

  return (
    <Card id="history" data-testid="history">
      <CardHeader>
        <CardTitle className="text-base">آمار ماهانه‌ی کانال</CardTitle>
        <CardDescription>۱۲ ماه شمسی اخیر، فقط از رویدادهای واقعی ثبت‌شده. ماه جاری تا امروز حساب شده است.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <caption className="sr-only">آمار ماهانه‌ی کانال در ۱۲ ماه شمسی اخیر</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="ps-5">
                ماه
              </TableHead>
              <TableHead scope="col">بازدید</TableHead>
              <TableHead scope="col">ساعت تماشا</TableHead>
              <TableHead scope="col" className="pe-5">
                رشد خالص دنبال‌کنندگان
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((month) => (
              <TableRow key={month.key} data-testid="history-row" data-month={month.key}>
                <TableHead scope="row" className="ps-5 font-medium text-foreground">
                  {jalaliMonthName(month.jm)} {f.number(month.jy, { useGrouping: false })}
                  {month.partial && <span className="ms-1.5 text-xs font-normal text-muted-foreground">(تا امروز)</span>}
                </TableHead>
                <TableCell>
                  <div className="flex min-w-24 items-center gap-2.5">
                    <span className="w-14 shrink-0 tabular-nums">{f.number(month.views)}</span>
                    <span aria-hidden="true" className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-muted sm:block">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${month.views === 0 ? 0 : Math.max(3, Math.round((month.views / maxViews) * 100))}%` }} />
                    </span>
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{f.number(month.watchHours, { maximumFractionDigits: 1 })}</TableCell>
                <TableCell className="pe-5 tabular-nums">
                  <bdi dir="ltr">
                    {month.netFollowers > 0 ? '+' : month.netFollowers < 0 ? '−' : ''}
                    {f.number(Math.abs(month.netFollowers))}
                  </bdi>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {showSampleNote && history.sampleEvents > 0 && (
          <p className="mx-5 mt-4 rounded-lg bg-muted/60 px-3.5 py-2.5 text-[13px] text-muted-foreground" data-testid="history-sample-note">
            {f.number(history.sampleEvents)} رویداد نمونه‌ی آزمایشی در این ماه‌ها وجود دارد که در این جدول و در شرایط درآمدزایی محاسبه نمی‌شود.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
