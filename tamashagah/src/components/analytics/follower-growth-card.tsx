import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getFormatter } from '@/lib/format-server';
import { metricLabels } from '@/features/analytics/labels';
import type { RangeChanges, RangeTotals } from '@/features/analytics/types';
import { ChangeBadge } from './change-badge';
import { SampleChip } from './seed-data-notice';

/** Follower growth of the range: new, lost and net (from the append-only FollowEvent log). */
export async function FollowerGrowthCard({
  totals,
  changes,
  followers,
  seedEvents,
}: {
  totals: RangeTotals;
  changes: RangeChanges;
  followers: number;
  /** Synthetic follow/unfollow events inside the range (0 on real data). */
  seedEvents: number;
}) {
  const f = await getFormatter();
  const net = totals.netFollowers;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          رشد دنبال‌کنندگان
          {seedEvents > 0 && <SampleChip />}
        </CardTitle>
        <CardDescription>
          اکنون {f.number(followers)} دنبال‌کننده دارید. اعداد زیر مربوط به بازه‌ی انتخاب‌شده است.
          {seedEvents > 0 && <> {f.number(seedEvents)} رویداد از آن‌ها نمونه‌ی آزمایشی است و در شمار دنبال‌کنندگان فعلی لحاظ نشده.</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-muted/60 px-2 py-4">
            <dt className="text-xs text-muted-foreground">{metricLabels.newFollowers}</dt>
            <dd className="mt-1">
              <span className="block text-2xl font-extrabold tabular-nums" data-testid="growth-new">
                {f.number(totals.newFollowers)}
              </span>
              <span className="mt-1.5 flex justify-center">
                <ChangeBadge value={changes.newFollowers} />
              </span>
            </dd>
          </div>
          <div className="rounded-xl bg-muted/60 px-2 py-4">
            <dt className="text-xs text-muted-foreground">{metricLabels.unfollows}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums" data-testid="growth-lost">
              {f.number(totals.unfollows)}
            </dd>
          </div>
          <div className="rounded-xl bg-accent px-2 py-4 text-accent-foreground">
            <dt className="text-xs">{metricLabels.netFollowers}</dt>
            <dd className="mt-1">
              <span className="block text-2xl font-extrabold tabular-nums" data-testid="growth-net">
                <bdi dir="ltr">
                  {net > 0 ? '+' : net < 0 ? '\u2212' : ''}
                  {f.number(Math.abs(net))}
                </bdi>
              </span>
              <span className="mt-1.5 flex justify-center">
                <ChangeBadge value={changes.netFollowers} />
              </span>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
