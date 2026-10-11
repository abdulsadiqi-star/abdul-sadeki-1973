import Link from 'next/link';
import type { Route } from 'next';
import { AlertTriangle, BadgeCheck, Ban, Clapperboard, Flag, LifeBuoy, Loader, ScrollText, Search, ShieldAlert, Wallet, type LucideIcon } from 'lucide-react';
import { ChevronEnd } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { ActivityList } from '@/components/admin/activity-list';
import { RoleBadge } from '@/components/admin/badges';
import { Section } from '@/components/admin/layout-bits';
import { requireStaffPage } from '@/features/admin/guard';
import { getRecentActivity } from '@/features/admin/queries/activity';
import { getOverview } from '@/features/admin/queries/overview';
import { getFormatter } from '@/lib/format-server';
import { cn } from '@/lib/utils';

export const metadata = { title: 'نمای کلی' };
export const dynamic = 'force-dynamic';

function AttentionCard({
  href,
  label,
  value,
  hint,
  icon: Icon,
  urgent,
}: {
  href: Route;
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs transition-colors outline-none hover:border-primary/40 hover:bg-accent/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex items-center justify-between">
        <span className={cn('flex size-10 items-center justify-center rounded-xl', urgent ? 'bg-warning/25 text-warning-foreground dark:text-warning' : 'bg-accent text-accent-foreground')}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <ChevronEnd className="size-4 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
      </span>
      <span className="mt-2 text-3xl font-extrabold tabular-nums">{value}</span>
      <span className="text-sm font-semibold">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Link>
  );
}

export default async function AdminOverviewPage() {
  const user = await requireStaffPage('MODERATOR');
  const f = await getFormatter();
  const [overview, recent] = await Promise.all([getOverview(user.role), getRecentActivity(user, f)]);
  const { counts } = overview;
  const pendingReports = counts.openReports + counts.reviewingReports;

  return (
    <div className="space-y-8">
      <PageHeader
        title="نمای کلی"
        description="کارهایی که منتظر بررسی شما هستند. همه‌ی عددها در لحظه از پایگاه داده خوانده می‌شوند."
        actions={<RoleBadge role={user.role} />}
      />

      <section aria-label="موارد در انتظار بررسی" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AttentionCard
          href="/admin/reports"
          icon={Flag}
          label="گزارش‌های در انتظار"
          value={f.number(pendingReports)}
          urgent={pendingReports > 0}
          hint={
            pendingReports === 0
              ? 'صف گزارش‌ها خالی است.'
              : `${f.number(counts.openReports)} باز · ${f.number(counts.reviewingReports)} در حال بررسی${overview.oldestPendingReportAt ? ` · قدیمی‌ترین ${f.relative(overview.oldestPendingReportAt)}` : ''}`
          }
        />
        <AttentionCard
          href="/admin/verification"
          icon={BadgeCheck}
          label="درخواست‌های تیک تأیید"
          value={f.number(counts.pendingVerification)}
          urgent={counts.pendingVerification > 0}
          hint={counts.pendingVerification === 0 ? 'درخواست در انتظاری نیست.' : 'منتظر تصمیم ناظر'}
        />
        {counts.pendingMonetization !== null && (
          <AttentionCard
            href="/admin/monetization"
            icon={Wallet}
            label="درخواست‌های درآمدزایی"
            value={f.number(counts.pendingMonetization)}
            urgent={counts.pendingMonetization > 0}
            hint={counts.pendingMonetization === 0 ? 'درخواست در انتظاری نیست.' : 'منتظر تصمیم مدیر'}
          />
        )}
        <AttentionCard
          href="/admin/support?status=OPEN"
          icon={LifeBuoy}
          label="تیکت‌های بی‌پاسخ"
          value={f.number(counts.openTickets)}
          urgent={counts.openTickets > 0}
          hint={counts.openTickets === 0 ? 'همه‌ی تیکت‌ها پاسخ داده شده‌اند.' : overview.oldestOpenTicketAt ? `قدیمی‌ترین ${f.relative(overview.oldestOpenTicketAt)}` : undefined}
        />
        <AttentionCard
          href="/admin/videos?processing=PENDING"
          icon={Loader}
          label="ویدیوهای در صف یا در حال پردازش"
          value={f.number(counts.processingVideos)}
          hint="بارگذاری‌های در جریان"
        />
        <AttentionCard
          href="/admin/videos?processing=FAILED"
          icon={AlertTriangle}
          label="ویدیوهای ناموفق"
          value={f.number(counts.failedVideos)}
          urgent={counts.failedVideos > 0}
          hint={counts.failedVideos === 0 ? 'پردازش ناموفقی نداریم.' : 'پردازش آن‌ها به خطا خورده است'}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Section
          id="recent"
          title="آخرین اقدام‌ها"
          description="تازه‌ترین تصمیم‌های ثبت‌شده در سامانه (به همراه دلیل هر کدام)."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/activity">
                همه‌ی فعالیت‌ها
                <ChevronEnd />
              </Link>
            </Button>
          }
        >
          {recent.length === 0 ? (
            <EmptyState icon={ScrollText} title="هنوز اقدامی ثبت نشده است" description="هر تصمیم مدیریتی با نام تصمیم‌گیرنده و دلیل در اینجا فهرست می‌شود." className="border-0 py-8" />
          ) : (
            <ActivityList items={recent} f={f} label="آخرین اقدام‌ها" compact />
          )}
        </Section>

        <Section id="shortcuts" title="میان‌برها">
          <ul className="grid grid-cols-1 gap-1.5">
            {(
              [
                { href: '/admin/reports?status=OPEN&sort=oldest', label: 'گزارش‌های باز، قدیمی‌ترین ابتدا', icon: Flag },
                { href: '/admin/videos?takedown=YES', label: 'ویدیوهای خارج‌شده از دسترس', icon: ShieldAlert },
                { href: '/admin/channels?suspended=YES', label: 'کانال‌های تعلیق‌شده', icon: Ban },
                { href: '/admin/users?status=SUSPENDED', label: 'حساب‌های تعلیق‌شده', icon: Ban },
                { href: '/admin/channels?verified=NO&sort=followers', label: 'پرمخاطب‌ترین کانال‌های بدون تیک', icon: Clapperboard },
                { href: '/admin/users', label: 'جستجوی کاربر با ایمیل یا نام', icon: Search },
              ] as { href: Route; label: string; icon: LucideIcon }[]
            ).map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <s.icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">{s.label}</span>
                  <ChevronEnd className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
