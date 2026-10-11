import { PageHeader } from '@/components/page-header';
import { requirePageChannelUser } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { getBillingProvider } from '@/features/monetization/billing';
import { ApplicationPanel } from '@/features/monetization/components/application-panel';
import { EligibilityCard } from '@/features/monetization/components/eligibility-card';
import { HistoryTable } from '@/features/monetization/components/history-table';
import { RevenueSection } from '@/features/monetization/components/revenue-section';
import { computeEligibility } from '@/features/monetization/eligibility';
import { getMonetizationHistory, getMonetizationStats, listApplications } from '@/features/monetization/queries';

export const metadata = { title: 'درآمدزایی' };

/**
 * Monetization: eligibility from real data, the application flow (creator side), real monthly history and an honest
 * revenue section. No amount is ever invented: while no payment service is connected, revenue is an empty state.
 */
export default async function MonetizationPage() {
  const user = await requirePageChannelUser('/studio/monetization');
  const channelId = user.channel.id;

  const [stats, history, applications, balance] = await Promise.all([
    getMonetizationStats(channelId),
    getMonetizationHistory(channelId),
    listApplications(channelId),
    getBillingProvider().getBalance(channelId),
  ]);
  const eligibility = computeEligibility({ followers: stats.followers, watchHours: stats.watchHours, publicVideos: stats.publicVideos });
  const showSamples = env.SHOW_SEED_DATA_NOTICE;

  return (
    <>
      <PageHeader title="درآمدزایی" description="شرایط ورود به برنامه، وضعیت درخواست شما و آمار واقعی کانال." />
      <div className="space-y-6">
        <EligibilityCard eligibility={eligibility} suspended={stats.channelSuspended} sampleHours={showSamples ? stats.sampleWatchHours : 0} />
        <ApplicationPanel applications={applications} eligible={eligibility.eligible} suspended={stats.channelSuspended} defaultEmail={user.email} />
        <HistoryTable history={history} showSampleNote={showSamples} />
        <RevenueSection balance={balance} />
      </div>
    </>
  );
}
