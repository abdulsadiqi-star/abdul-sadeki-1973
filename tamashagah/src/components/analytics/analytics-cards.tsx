import { Bell, CalendarDays, Clock, Eye, Timer, TrendingUp, UserRound, Users } from 'lucide-react';
import { StatCard } from '@/components/stat-card';
import { StatCell } from '@/components/studio/stat-cell';
import { getFormatter } from '@/lib/format-server';
import { dayKeyToJalali, jalaliMonthName, todayKey } from '@/lib/analytics/time';
import { metricLabels } from '@/features/analytics/labels';
import type { AnalyticsOverview } from '@/features/analytics/types';
import { ChangeBadge } from './change-badge';
import { SampleChip } from './seed-data-notice';
import { describePeriod } from './chart-model';

/** The metric cards of the analytics page (reference: seven tiles above the chart). */
export async function AnalyticsCards({ overview, showSample, now = new Date() }: { overview: AnalyticsOverview; showSample: boolean; now?: Date }) {
  const f = await getFormatter();
  const { totals, changes, cards, video } = overview;
  const period = describePeriod(overview.range.fromKey, overview.range.toKey, f);
  const monthName = jalaliMonthName(dayKeyToJalali(todayKey(now)).jm);
  const channelLevel = video === null;

  return (
    <section aria-label="شاخص‌های کلیدی" className={channelLevel ? 'grid grid-cols-2 gap-3 lg:grid-cols-4' : 'grid grid-cols-2 gap-3 lg:grid-cols-3'}>
      <StatCell id="today">
        <StatCard label="بازدید امروز" icon={TrendingUp} value={f.number(cards.todayViews)} badge={showSample && cards.seedToday ? <SampleChip /> : undefined} />
      </StatCell>
      <StatCell id="watch-minutes">
        <StatCard
          label={`${metricLabels.watchMinutes} در بازه`}
          icon={Clock}
          value={f.number(Math.round(totals.watchSeconds / 60))}
          badge={<ChangeBadge value={changes.watchSeconds} />}
          hint={period}
        />
      </StatCell>
      <StatCell id="views">
        <StatCard label="بازدید در این بازه" icon={Eye} value={f.number(totals.views)} badge={<ChangeBadge value={changes.views} />} hint={period} />
      </StatCell>
      {channelLevel && (
        <StatCell id="followers">
          <StatCard label="دنبال‌کنندگان" icon={Users} value={f.number(cards.followers ?? 0)} />
        </StatCell>
      )}
      <StatCell id="unique">
        <StatCard label={`${metricLabels.uniqueViewers} در بازه`} icon={UserRound} value={f.number(totals.uniqueViewers)} badge={<ChangeBadge value={changes.uniqueViewers} />} />
      </StatCell>
      <StatCell id="avg-duration">
        <StatCard
          label={metricLabels.avgViewDuration}
          icon={Timer}
          value={totals.views > 0 ? f.duration(totals.avgViewSeconds) : '—'}
          badge={totals.views > 0 ? <ChangeBadge value={changes.avgViewSeconds} /> : undefined}
        />
      </StatCell>
      {channelLevel && (
        <StatCell id="notify">
          <StatCard label="فعال‌کنندگان اعلان" icon={Bell} value={f.number(cards.notifySubscribers ?? 0)} hint="کاربرانی که اعلان ویدیوی جدید را روشن کرده‌اند" />
        </StatCell>
      )}
      <StatCell id="month">
        <StatCard
          label="بازدید این ماه"
          icon={CalendarDays}
          value={f.number(cards.monthViews)}
          hint={`${monthName} ${f.number(dayKeyToJalali(todayKey(now)).jy, { useGrouping: false })}`}
          badge={showSample && cards.seedMonth ? <SampleChip /> : undefined}
        />
      </StatCell>
    </section>
  );
}
