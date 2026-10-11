import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { PageHeader } from '@/components/page-header';
import { ActivityList } from '@/components/admin/activity-list';
import { ReportStatusBadge, RoleBadge, UserStatusBadge } from '@/components/admin/badges';
import { ChannelLink, DefList, Section } from '@/components/admin/layout-bits';
import { UserActions } from '@/components/admin/user-actions';
import { adminLabels } from '@/features/admin/labels';
import { requireStaffPage } from '@/features/admin/guard';
import { roleCan } from '@/features/admin/policy';
import { getAdminUser } from '@/features/admin/queries/users';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'کاربر' };
export const dynamic = 'force-dynamic';

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const { id } = await params;
  const f = await getFormatter();
  const user = await getAdminUser(id, viewer, f);
  if (!user) notFound();
  const canManage = roleCan(viewer.role, 'user.role.change');

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ms-2">
        <Link href="/admin/users">
          <ArrowRight className="ltr:rotate-180" />
          بازگشت به فهرست کاربران
        </Link>
      </Button>
      <PageHeader
        title={user.name}
        description={`عضو از ${f.date(user.createdAt)}`}
        actions={
          <>
            <RoleBadge role={user.role} />
            <UserStatusBadge status={user.status} />
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Section id="profile" title="مشخصات حساب">
            <div className="mb-4 flex items-center gap-3">
              <ChannelAvatar name={user.name} size="lg" />
              <div className="min-w-0">
                <p className="font-bold" dir="auto">
                  {user.name}
                </p>
                <p className="ltr-isolate truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <DefList
              items={[
                { label: 'نقش', value: <RoleBadge role={user.role} /> },
                { label: 'وضعیت', value: <UserStatusBadge status={user.status} /> },
                { label: 'تأیید ایمیل', value: user.emailVerified ? 'تأیید شده' : <Badge variant="muted">تأیید نشده</Badge> },
                { label: 'نشست‌های فعال', value: f.number(user.activeSessions) },
                { label: 'آخرین ورود', value: user.lastLoginAt ? f.dateTime(user.lastLoginAt) : 'هرگز' },
                { label: 'گزارش‌های ثبت‌شده توسط او', value: f.number(user.reportsFiled) },
              ]}
            />
          </Section>

          <Section id="channel" title="کانال">
            {user.channel ? (
              <div className="space-y-3">
                <ChannelLink id={user.channel.id} name={user.channel.name} handle={user.channel.handle} isVerified={user.channel.isVerified} size="md" />
                <div className="flex flex-wrap gap-1.5">
                  {user.channel.suspendedAt ? <Badge variant="destructive">تعلیق‌شده</Badge> : <Badge variant="success">فعال</Badge>}
                  {user.channel.isVerified && <Badge variant="info">تیک تأیید</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {f.followers(user.channel.followerCount)} · {f.count(user.channel.videoCount, 'ویدیو')}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/channels/${user.channel.id}`}>مدیریت کانال</Link>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">این کاربر کانالی ندارد.</p>
            )}
            {user.blockedOn.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">مسدود برای دیدگاه‌گذاشتن در</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {user.blockedOn.map((b) => (
                    <li key={b.channelId}>
                      <Link href={`/admin/channels/${b.channelId}`}>
                        <Badge variant="outline" className="hover:bg-accent">
                          {b.channelName}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </div>

        <Section id="manage" title="نقش و وضعیت حساب">
          {canManage ? (
            <UserActions
              userId={user.id}
              name={user.name}
              role={user.role}
              status={user.status}
              hasChannel={!!user.channel}
              isSelf={user.id === viewer.id}
              isLastAdmin={user.isLastAdmin}
            />
          ) : (
            <Alert variant="info">
              <Info />
              <AlertDescription className="text-foreground">تغییر نقش و تعلیق حساب فقط برای مدیران ممکن است. شما می‌توانید سابقه‌ی این کاربر را ببینید و گزارش‌های مربوط به او را بررسی کنید.</AlertDescription>
            </Alert>
          )}
        </Section>

        <Section
          id="reports"
          title="گزارش‌ها علیه این کاربر"
          description={`${f.number(user.reportsAgainst.open)} گزارش باز · ${f.number(user.reportsAgainst.total)} گزارش در کل (کانال، ویدیوها و دیدگاه‌های او)`}
        >
          {user.reportsAgainst.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">تاکنون گزارشی علیه محتوای این کاربر ثبت نشده است.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {user.reportsAgainst.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 text-sm">
                  <Badge variant="outline">{adminLabels.reportTarget[r.targetType]}</Badge>
                  <Badge variant="secondary">{labels.reportReason[r.reason]}</Badge>
                  <ReportStatusBadge status={r.status} />
                  <span className="min-w-0 flex-1 basis-40 truncate text-muted-foreground" dir="auto">
                    {r.targetLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">{f.relative(r.createdAt)}</span>
                  <Link href={`/admin/reports/${r.id}`} className="text-xs font-medium text-primary hover:underline">
                    بررسی
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="history" title="اقدام‌های اخیر روی این کاربر" description="تصمیم‌های ثبت‌شده درباره‌ی حساب، محتوا و کانال او">
          {user.history.length === 0 ? <p className="text-sm text-muted-foreground">تاکنون اقدامی روی این کاربر ثبت نشده است.</p> : <ActivityList items={user.history} f={f} label="اقدام‌های اخیر روی کاربر" compact />}
        </Section>
      </div>
    </div>
  );
}
