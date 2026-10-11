import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight, Eye, ExternalLink, Flag, MessageSquare, ShieldAlert, Users, Video as VideoIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { ActivityList } from '@/components/admin/activity-list';
import { RequestStatusBadge, VideoStateBadges } from '@/components/admin/badges';
import { ChannelActions } from '@/components/admin/channel-actions';
import { DefList, Section, UserLink } from '@/components/admin/layout-bits';
import { requireStaffPage } from '@/features/admin/guard';
import { checkTargetUser } from '@/features/admin/policy';
import { getAdminChannel } from '@/features/admin/queries/channels';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'کانال' };
export const dynamic = 'force-dynamic';

export default async function AdminChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const { id } = await params;
  const f = await getFormatter();
  const channel = await getAdminChannel(id, viewer, f);
  if (!channel) notFound();
  const verdict = checkTargetUser(viewer, { id: channel.owner.id, role: channel.owner.role }, 'channel.suspend');

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2">
        <Link href="/admin/channels">
          <ArrowRight className="ltr:rotate-180" />
          بازگشت به فهرست کانال‌ها
        </Link>
      </Button>

      <PageHeader
        title={channel.name}
        description={`@${channel.handle} — ساخته‌شده ${f.relative(channel.createdAt)}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/channel/${channel.handle}`} target="_blank" rel="noopener">
              <ExternalLink />
              صفحه‌ی کانال در سایت
              <span className="sr-only"> (در برگه‌ی جدید)</span>
            </Link>
          </Button>
        }
      />

      <div className="space-y-6">
        <section aria-label="آمار کانال" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="دنبال‌کننده" value={f.number(channel.stats.followers)} icon={Users} />
          <StatCard label="ویدیو" value={f.number(channel.stats.totalVideos)} icon={VideoIcon} hint={`${f.number(channel.stats.publicVideos)} عمومی`} />
          <StatCard label="بازدید کل" value={f.compact(channel.stats.totalViews)} icon={Eye} />
          <StatCard label="دیدگاه تأییدشده" value={f.number(channel.stats.approvedComments)} icon={MessageSquare} />
          <StatCard label="گزارش باز" value={f.number(channel.reports.open)} icon={Flag} hint={`${f.number(channel.reports.total)} گزارش در کل`} />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section id="status" title="وضعیت و اقدام‌ها">
            <div className="mb-4 flex items-start gap-4">
              <ChannelAvatar name={channel.name} src={channel.avatarUrl} size="lg" />
              <div className="min-w-0 space-y-2">
                <p className="flex items-center gap-1.5 text-lg font-bold" dir="auto">
                  <span className="truncate">{channel.name}</span>
                  {channel.isVerified && <VerifiedBadge />}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {channel.suspendedAt ? <Badge variant="destructive">تعلیق‌شده</Badge> : <Badge variant="success">فعال</Badge>}
                  {channel.isVerified ? <Badge variant="info">تیک تأیید</Badge> : <Badge variant="muted">بدون تیک</Badge>}
                </div>
              </div>
            </div>
            {channel.suspendedAt && (
              <p className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <ShieldAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-destructive" />
                <span>
                  تعلیق‌شده در {f.dateTime(channel.suspendedAt)}
                  {channel.suspensionReason ? <>؛ دلیل: <span dir="auto">{channel.suspensionReason}</span></> : null}
                </span>
              </p>
            )}
            <ChannelActions channelId={channel.id} name={channel.name} isVerified={channel.isVerified} suspended={!!channel.suspendedAt} openReports={channel.reports.open} denial={verdict.ok ? null : verdict.message} />
          </Section>

          <Section id="info" title="مشخصات">
            <DefList
              items={[
                { label: 'صاحب کانال', value: <UserLink id={channel.owner.id} name={channel.owner.name} role={channel.owner.role} email={channel.owner.email} /> },
                { label: 'نمایش‌دادن تیک از', value: channel.verifiedAt ? f.date(channel.verifiedAt) : '—' },
                { label: 'درخواست درآمدزایی', value: channel.monetization ? <RequestStatusBadge kind="monetization" status={channel.monetization.status} /> : 'ثبت نشده' },
                { label: 'درخواست تیک تأیید', value: channel.verification ? <RequestStatusBadge kind="verification" status={channel.verification.status} /> : 'ثبت نشده' },
                { label: 'ویدیوهای خارج‌شده از دسترس', value: f.number(channel.stats.takenDownVideos) },
                { label: 'دیدگاه‌نویسان مسدود', value: f.number(channel.stats.blockedCommenters) },
              ]}
            />
            {channel.description && (
              <p className="mt-4 line-clamp-4 border-t pt-3 text-sm leading-7 text-muted-foreground" dir="auto">
                {channel.description}
              </p>
            )}
          </Section>
        </div>

        <Section id="videos" title="ویدیوهای اخیر" description="پنج ویدیوی تازه‌ی کانال">
          {channel.recentVideos.length === 0 ? (
            <p className="text-sm text-muted-foreground">این کانال هنوز ویدیویی ندارد.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {channel.recentVideos.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
                  <Link href={`/watch/${v.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 basis-56 font-medium hover:text-primary hover:underline" dir="auto">
                    {v.title}
                  </Link>
                  <VideoStateBadges processingStatus={v.processingStatus} publishStatus={v.publishStatus} visibility={v.visibility} takenDown={!!v.takedownAt} />
                  <span className="text-xs text-muted-foreground">{f.views(v.viewCount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            وضعیت پردازش:{' '}
            {Object.entries(channel.stats.videosByProcessing)
              .map(([k, n]) => `${labels.processing[k as keyof typeof labels.processing]}: ${f.number(n ?? 0)}`)
              .join(' · ') || '—'}
          </p>
        </Section>

        <Section id="history" title="سابقه‌ی اقدام‌ها" description="تصمیم‌های ثبت‌شده درباره‌ی این کانال و محتوای آن">
          {channel.history.length === 0 ? <p className="text-sm text-muted-foreground">تاکنون اقدامی ثبت نشده است.</p> : <ActivityList items={channel.history} f={f} label="سابقه‌ی اقدام‌های کانال" compact />}
          <p className="mt-3 text-xs">
            <Link href={`/admin/activity?target=${encodeURIComponent(channel.handle)}` as Route} className="text-primary hover:underline">
              مشاهده‌ی همه‌ی اقدام‌های مرتبط در گزارش فعالیت‌ها
            </Link>
          </p>
        </Section>
      </div>
    </div>
  );
}
