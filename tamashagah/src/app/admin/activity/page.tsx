import type { Route } from 'next';
import { Info, ScrollText } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { ActivityFilters } from '@/components/admin/activity-filters';
import { ActivityList } from '@/components/admin/activity-list';
import { ResultCount } from '@/components/admin/result-count';
import { requireStaffPage } from '@/features/admin/guard';
import { ADMIN_ONLY_ACTION_TYPES, roleCan } from '@/features/admin/policy';
import { listActivity } from '@/features/admin/queries/activity';
import { activityListSchema, flattenSearchParams } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';

export const metadata = { title: 'گزارش فعالیت‌ها' };
export const dynamic = 'force-dynamic';

export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const raw = await searchParams;
  const filters = activityListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const { items, pageInfo } = await listActivity(viewer, filters, f);
  const seesAll = roleCan(viewer.role, 'audit.view.all');

  const values = { actor: filters.actor ?? '', type: filters.type, target: filters.target ?? '', from: filters.from ?? '', to: filters.to ?? '' };
  const filtered = !!(filters.actor || filters.target || filters.from || filters.to) || filters.type !== 'ALL';

  return (
    <div>
      <PageHeader title="گزارش فعالیت‌ها" description="سابقه‌ی همه‌ی تصمیم‌های مدیریتی: چه کسی، چه کاری، روی چه چیزی و به چه دلیل. این فهرست فقط خواندنی است." />

      {!seesAll && (
        <Alert variant="info" className="mb-4">
          <Info />
          <AlertDescription className="text-foreground">شما اقدام‌های خودتان و اقدام‌های مربوط به محتوا (دیدگاه، ویدیو، کانال، گزارش و پشتیبانی) را می‌بینید. تصمیم‌های مربوط به نقش‌ها، تعلیق حساب‌ها و درآمدزایی فقط برای مدیران قابل مشاهده است.</AlertDescription>
        </Alert>
      )}

      <ActivityFilters values={values} hiddenTypes={seesAll ? [] : ADMIN_ONLY_ACTION_TYPES} />

      {items.length === 0 ? (
        <EmptyState icon={ScrollText} title={filtered ? 'اقدامی با این فیلترها پیدا نشد' : 'هنوز اقدامی ثبت نشده است'} description={filtered ? 'فیلترها یا بازه‌ی تاریخ را تغییر دهید.' : 'هر تصمیم مدیریتی همراه با دلیل آن اینجا ثبت می‌شود.'} />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="اقدام" />
          <ActivityList items={items} f={f} label="گزارش فعالیت‌ها" />
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/activity', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
