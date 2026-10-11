import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Eye, ExternalLink, MessageSquare, ThumbsUp, UserX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { PageHeader } from '@/components/page-header';
import { PosterPlaceholder } from '@/components/video/video-card';
import { VerifiedBadge } from '@/components/verified-badge';
import { ActivityList } from '@/components/admin/activity-list';
import { CommentStatusBadge, ReportStatusBadge, UserStatusBadge, VideoStateBadges } from '@/components/admin/badges';
import { ChannelLink, DefList, Section, UserLink, UserText } from '@/components/admin/layout-bits';
import { MarkReviewing } from '@/components/admin/mark-reviewing';
import { ReportActions, type ReportActionTarget } from '@/components/admin/report-actions';
import { adminLabels } from '@/features/admin/labels';
import { requireStaffPage } from '@/features/admin/guard';
import { checkTargetUser, isReportOpen } from '@/features/admin/policy';
import { getReportDetail, type ReportDetail } from '@/features/admin/queries/reports';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';
import type { Formatter } from '@/lib/format';

export const metadata = { title: 'بررسی گزارش' };
export const dynamic = 'force-dynamic';

function VideoPreview({ target, f }: { target: Extract<NonNullable<ReportDetail['target']>, { type: 'VIDEO' }>; f: Formatter }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <Link href={`/watch/${target.id}`} target="_blank" rel="noopener" className="group relative block aspect-video overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        {target.posterUrl ? <img src={target.posterUrl} alt="" className="size-full object-cover transition-transform group-hover:scale-[1.03]" /> : <PosterPlaceholder />}
        {target.durationSeconds != null && (
          <span className="absolute end-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">{f.duration(target.durationSeconds)}</span>
        )}
        <span className="sr-only">باز کردن صفحه‌ی پخش در برگه‌ی جدید</span>
      </Link>
      <div className="min-w-0 space-y-3">
        <h3 className="text-lg leading-8 font-bold" dir="auto">
          {target.title}
        </h3>
        <VideoStateBadges
          processingStatus={target.processingStatus}
          publishStatus={target.publishStatus}
          visibility={target.visibility}
          takenDown={!!target.takedownAt}
          channelSuspended={target.channel.suspended}
        />
        <ChannelLink id={target.channel.id} name={target.channel.name} handle={target.channel.handle} avatarUrl={target.channel.avatarUrl} isVerified={target.channel.isVerified} />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Eye aria-hidden="true" className="size-3.5" />
            {f.views(target.viewCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <ThumbsUp aria-hidden="true" className="size-3.5" />
            {f.number(target.likeCount)} پسند
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare aria-hidden="true" className="size-3.5" />
            {f.number(target.commentCount)} دیدگاه
          </span>
          <span>بارگذاری‌شده {f.relative(target.createdAt)}</span>
        </p>
        {target.takedownAt && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <strong>خارج‌شده از دسترس</strong> ({f.dateTime(target.takedownAt)}){target.takedownReason ? <>؛ دلیل: <span dir="auto">{target.takedownReason}</span></> : null}
          </p>
        )}
        {target.description && (
          <p className="line-clamp-3 text-sm leading-7 text-muted-foreground" dir="auto">
            {target.description}
          </p>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={`/watch/${target.id}`} target="_blank" rel="noopener">
            <ExternalLink />
            صفحه‌ی ویدیو در سایت
            <span className="sr-only"> (در برگه‌ی جدید)</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}

function CommentPreview({ target, f }: { target: Extract<NonNullable<ReportDetail['target']>, { type: 'COMMENT' }>; f: Formatter }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <UserLink id={target.author.id} name={target.author.name} role={target.author.role} email={target.author.email} />
        <CommentStatusBadge status={target.status} />
        {target.isReply && <Badge variant="outline">پاسخ</Badge>}
        {target.authorBlockedOnChannel && (
          <Badge variant="warning">
            <UserX />
            در این کانال مسدود است
          </Badge>
        )}
        <time className="text-xs text-muted-foreground" dateTime={target.createdAt.toISOString()} suppressHydrationWarning>
          {f.dateTime(target.createdAt)}
        </time>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">متن دیدگاه و زمینه‌ی گفت‌وگو</h3>
        <ol className="space-y-2" aria-label="دیدگاه‌های اطراف">
          {target.context.map((c) => (
            <li
              key={c.id}
              aria-current={c.isTarget ? 'true' : undefined}
              className={c.isTarget ? 'rounded-lg border-2 border-primary/50 bg-accent/40 p-3' : 'rounded-lg bg-muted/50 p-3 opacity-80'}
            >
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground" dir="auto">
                  {c.authorName}
                </span>
                {c.isTarget && <Badge>دیدگاه گزارش‌شده</Badge>}
                <time dateTime={c.createdAt.toISOString()} suppressHydrationWarning>
                  {f.relative(c.createdAt)}
                </time>
                {c.status !== 'APPROVED' && <CommentStatusBadge status={c.status} />}
              </p>
              <p className="text-sm leading-7 break-words whitespace-pre-line" dir="auto">
                {c.body}
              </p>
            </li>
          ))}
        </ol>
      </div>

      {target.moderationNote && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          یادداشت آخرین مدیریت: <span dir="auto">{target.moderationNote}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t pt-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted">
            {target.video.posterUrl ? <img src={target.video.posterUrl} alt="" loading="lazy" className="size-full object-cover" /> : <PosterPlaceholder className="[&_svg]:size-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">زیر ویدیوی</p>
            <Link href={`/watch/${target.video.id}`} target="_blank" rel="noopener" className="line-clamp-1 text-sm font-medium hover:text-primary hover:underline" dir="auto">
              {target.video.title}
            </Link>
          </div>
        </div>
        <ChannelLink id={target.channel.id} name={target.channel.name} handle={target.channel.handle} />
      </div>
    </div>
  );
}

function ChannelPreview({ target, f }: { target: Extract<NonNullable<ReportDetail['target']>, { type: 'CHANNEL' }>; f: Formatter }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <ChannelAvatar name={target.name} src={target.avatarUrl} size="lg" />
      <div className="min-w-0 flex-1 basis-52 space-y-2">
        <h3 className="flex items-center gap-1.5 text-lg font-bold" dir="auto">
          <span className="truncate">{target.name}</span>
          {target.isVerified && <VerifiedBadge />}
        </h3>
        <p className="ltr-isolate w-fit max-w-full truncate text-sm text-muted-foreground">@{target.handle}</p>
        <div className="flex flex-wrap gap-1.5">
          {target.suspended ? <Badge variant="destructive">تعلیق‌شده</Badge> : <Badge variant="success">فعال</Badge>}
          {target.isVerified && <Badge variant="info">تیک تأیید</Badge>}
        </div>
        {target.description && (
          <p className="line-clamp-4 text-sm leading-7 text-muted-foreground" dir="auto">
            {target.description}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {f.followers(target.followerCount)} · {f.count(target.videoCount, 'ویدیو')} · ساخته‌شده در {f.date(target.createdAt)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/channel/${target.handle}`} target="_blank" rel="noopener">
              <ExternalLink />
              صفحه‌ی کانال در سایت
              <span className="sr-only"> (در برگه‌ی جدید)</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/admin/channels/${target.id}`}>مدیریت کانال</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const { id } = await params;
  const f = await getFormatter();
  const detail = await getReportDetail(id, viewer, f);
  if (!detail) notFound();
  const { report, target, owner, others, history } = detail;
  const open = isReportOpen(report.status);

  // The same rule the server applies: nobody handles reports about themselves, moderators never about administrators.
  const verdict = checkTargetUser(viewer, owner, 'reports.handle');
  const denial = verdict.ok ? null : verdict.message;
  const otherOpen = others.filter((o) => isReportOpen(o.status)).length;

  let actionTarget: ReportActionTarget | null = null;
  if (target?.type === 'VIDEO') {
    actionTarget = { type: 'VIDEO', id: target.id, takenDown: !!target.takedownAt, channelId: target.channel.id, channelName: target.channel.name, channelSuspended: target.channel.suspended };
  } else if (target?.type === 'COMMENT') {
    actionTarget = {
      type: 'COMMENT',
      id: target.id,
      status: target.status,
      // A comment removed by its own author cannot be restored by staff; the server rejects it, the UI simply does not offer it.
      deletedByAuthor: target.deletedByAuthor,
      channelId: target.channel.id,
      channelName: target.channel.name,
      authorId: target.author.id,
      authorBlocked: target.authorBlockedOnChannel,
    };
  } else if (target?.type === 'CHANNEL') {
    actionTarget = { type: 'CHANNEL', id: target.id, name: target.name, suspended: target.suspended };
  }

  return (
    <div>
      <MarkReviewing kind="report" id={report.id} pending={report.status === 'OPEN'} />
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2">
        <Link href="/admin/reports">
          <ArrowRight className="ltr:rotate-180" />
          بازگشت به صف گزارش‌ها
        </Link>
      </Button>
      <PageHeader
        title={`گزارش درباره‌ی ${adminLabels.reportTarget[report.targetType]}`}
        description={`ثبت‌شده ${f.relative(report.createdAt)} — دلیل گزارش: ${labels.reportReason[report.reason]}`}
        actions={<ReportStatusBadge status={report.status} />}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Section id="target" title="مورد گزارش‌شده" className="lg:col-start-1">
          {!target ? (
            <p className="text-sm text-muted-foreground">این مورد دیگر وجود ندارد (احتمالاً حذف شده است).</p>
          ) : target.type === 'VIDEO' ? (
            <VideoPreview target={target} f={f} />
          ) : target.type === 'COMMENT' ? (
            <CommentPreview target={target} f={f} />
          ) : (
            <ChannelPreview target={target} f={f} />
          )}
          {owner && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm">
              <span className="text-muted-foreground">{target?.type === 'COMMENT' ? 'نویسنده:' : 'صاحب:'}</span>
              <UserLink id={owner.id} name={owner.name} role={owner.role} email={owner.email} />
              {owner.status === 'SUSPENDED' && <UserStatusBadge status={owner.status} />}
            </div>
          )}
        </Section>

        <div className="lg:col-start-2 lg:row-span-4 lg:row-start-1">
          <div className="space-y-6 lg:sticky lg:top-[calc(var(--header-height)+1rem)]">
            <Section id="decision" title="تصمیم">
              {report.status === 'ACTIONED' || report.status === 'DISMISSED' ? (
                <div className="mb-4 space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
                  <p className="font-semibold">این گزارش بررسی شده است.</p>
                  <DefList
                    className="sm:grid-cols-1"
                    items={[
                      { label: 'نتیجه', value: <ReportStatusBadge status={report.status} /> },
                      { label: 'تصمیم‌گیرنده', value: report.handler ? <UserLink id={report.handler.id} name={report.handler.name} /> : '—' },
                      { label: 'زمان تصمیم', value: report.handledAt ? f.dateTime(report.handledAt) : '—' },
                      { label: 'توضیح', value: report.resolution ? <span dir="auto">{report.resolution}</span> : '—' },
                    ]}
                  />
                </div>
              ) : null}
              {actionTarget ? (
                <ReportActions reportId={report.id} reportOpen={open} otherOpenReports={open ? otherOpen : 0} denial={denial} target={actionTarget} />
              ) : (
                <p className="text-sm text-muted-foreground">مورد گزارش‌شده وجود ندارد؛ فقط می‌توانید گزارش را رد کنید.</p>
              )}
            </Section>
          </div>
        </div>

        <Section id="report" title="جزئیات گزارش" className="lg:col-start-1">
          <DefList
            items={[
              { label: 'دلیل', value: <Badge variant="secondary">{labels.reportReason[report.reason]}</Badge> },
              { label: 'گزارش‌دهنده', value: report.reporter ? <UserLink id={report.reporter.id} name={report.reporter.name} role={report.reporter.role} email={report.reporter.email} /> : 'حساب حذف‌شده' },
              { label: 'زمان ثبت', value: f.dateTime(report.createdAt) },
              { label: 'وضعیت', value: <ReportStatusBadge status={report.status} /> },
            ]}
          />
          {report.details ? (
            <div className="mt-4">
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">توضیح گزارش‌دهنده</h3>
              <UserText>{report.details}</UserText>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">گزارش‌دهنده توضیحی ننوشته است.</p>
          )}
        </Section>

        <Section id="others" title="گزارش‌های دیگر درباره‌ی همین مورد" description={others.length ? `${f.number(others.length)} گزارش دیگر` : undefined} className="lg:col-start-1">
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">گزارش دیگری برای این مورد ثبت نشده است.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {others.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 text-sm">
                  <Badge variant="secondary">{labels.reportReason[o.reason]}</Badge>
                  <ReportStatusBadge status={o.status} />
                  <span className="min-w-0 flex-1 basis-40 text-muted-foreground" dir="auto">
                    {o.details ? `«${o.details}»` : 'بدون توضیح'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {o.reporterName ?? 'حساب حذف‌شده'} · {f.relative(o.createdAt)}
                  </span>
                  <Link href={`/admin/reports/${o.id}`} className="text-xs font-medium text-primary hover:underline">
                    مشاهده
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="history" title="سابقه‌ی اقدام‌ها" description="تصمیم‌های پیشین درباره‌ی همین مورد" className="lg:col-start-1">
          {history.length === 0 ? <p className="text-sm text-muted-foreground">تاکنون اقدامی روی این مورد ثبت نشده است.</p> : <ActivityList items={history} f={f} label="سابقه‌ی اقدام‌ها" compact />}
        </Section>
      </div>
    </div>
  );
}
