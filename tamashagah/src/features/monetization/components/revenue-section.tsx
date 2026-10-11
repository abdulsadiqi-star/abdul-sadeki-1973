import { Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { getFormatter } from '@/lib/format-server';
import type { Balance, CurrencyCode } from '../billing';
import { NO_REVENUE_RECORDED, PAYMENT_NOT_CONNECTED } from '../labels';

const CURRENCY_LABEL: Record<CurrencyCode, string> = { IRR: 'ریال', IRT: 'تومان' };

/**
 * Revenue. With the shipped `NullBillingProvider` (no payment service connected) this is ALWAYS the honest empty
 * state — no figure of any kind is shown. The "ok" branch only renders what a connected provider reports; nothing
 * here is computed, estimated or illustrative.
 */
export async function RevenueSection({ balance }: { balance: Balance }) {
  const f = await getFormatter();
  return (
    <Card id="revenue" data-testid="revenue">
      <CardHeader>
        <CardTitle className="text-base">درآمد</CardTitle>
        <CardDescription>موجودی و پرداخت‌ها از سرویس پرداخت خوانده می‌شود، نه از آمار بازدید.</CardDescription>
      </CardHeader>
      <CardContent>
        {balance.status === 'ok' ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <dt className="text-sm text-muted-foreground">قابل برداشت</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums">
                {f.number(balance.available.amountMinor)} <span className="text-sm font-normal">{CURRENCY_LABEL[balance.available.currency]}</span>
              </dd>
            </div>
            <div className="rounded-xl border p-4">
              <dt className="text-sm text-muted-foreground">در انتظار تسویه</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums">
                {f.number(balance.pending.amountMinor)} <span className="text-sm font-normal">{CURRENCY_LABEL[balance.pending.currency]}</span>
              </dd>
            </div>
          </dl>
        ) : (
          <EmptyState
            icon={Wallet}
            title={`${NO_REVENUE_RECORDED} — ${PAYMENT_NOT_CONNECTED}`}
            description="تا زمانی که به سرویس پرداخت متصل نشده‌ایم، هیچ مبلغی برای کانال شما ثبت یا نمایش داده نمی‌شود."
          />
        )}
      </CardContent>
    </Card>
  );
}
