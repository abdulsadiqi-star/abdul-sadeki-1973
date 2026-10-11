import Link from 'next/link';
import type { Route } from 'next';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChannelAvatar } from '@/components/channel-avatar';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { RoleBadge, UserStatusBadge } from '@/components/admin/badges';
import { FilterBar } from '@/components/admin/filter-bar';
import { ResultList, ResultRow } from '@/components/admin/layout-bits';
import { ResultCount } from '@/components/admin/result-count';
import { requireStaffPage } from '@/features/admin/guard';
import { roleCan } from '@/features/admin/policy';
import { listAdminUsers } from '@/features/admin/queries/users';
import { flattenSearchParams, userListSchema } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';
import { labels } from '@/lib/i18n/fa';

export const metadata = { title: 'کاربران' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const raw = await searchParams;
  const filters = userListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const { items, pageInfo } = await listAdminUsers(filters);

  const values = { q: filters.q ?? '', role: filters.role, status: filters.status };
  const filtered = !!filters.q || filters.role !== 'ALL' || filters.status !== 'ALL';
  const canManage = roleCan(viewer.role, 'user.role.change');

  return (
    <div>
      <PageHeader
        title="کاربران"
        description={canManage ? 'جستجوی کاربران، تغییر نقش و تعلیق یا رفع تعلیق حساب‌ها.' : 'جستجوی کاربران و دیدن سابقه‌ی آن‌ها. تغییر نقش و تعلیق حساب فقط برای مدیران ممکن است.'}
      />

      <FilterBar
        key={JSON.stringify(values)}
        label="فیلتر کاربران"
        values={values}
        fields={[
          { kind: 'search', name: 'q', label: 'جستجو', placeholder: 'ایمیل، نام یا شناسه‌ی کانال' },
          {
            kind: 'select',
            name: 'role',
            label: 'نقش',
            defaultValue: 'ALL',
            options: [{ value: 'ALL', label: 'همه' }, ...(Object.keys(labels.role) as (keyof typeof labels.role)[]).map((r) => ({ value: r, label: labels.role[r] }))],
          },
          {
            kind: 'select',
            name: 'status',
            label: 'وضعیت حساب',
            defaultValue: 'ALL',
            options: [
              { value: 'ALL', label: 'همه' },
              { value: 'ACTIVE', label: 'فعال' },
              { value: 'SUSPENDED', label: 'تعلیق‌شده' },
            ],
          },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon={Users} title={filtered ? 'کاربری با این فیلترها پیدا نشد' : 'کاربری ثبت‌نام نکرده است'} description={filtered ? 'عبارت جستجو یا فیلترها را تغییر دهید.' : undefined} />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="کاربر" />
          <ResultList label="فهرست کاربران">
            {items.map((u) => (
              <ResultRow key={u.id}>
                <ChannelAvatar name={u.name} size="md" />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/users/${u.id}`} className="font-semibold hover:text-primary hover:underline" dir="auto">
                      {u.name}
                    </Link>
                    <RoleBadge role={u.role} />
                    {u.status === 'SUSPENDED' && <UserStatusBadge status={u.status} />}
                    {!u.emailVerified && <Badge variant="muted">ایمیل تأیید نشده</Badge>}
                  </p>
                  <p className="ltr-isolate truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex min-w-44 flex-col gap-1 text-xs text-muted-foreground">
                  {u.channel ? (
                    <Link href={`/admin/channels/${u.channel.id}`} className="hover:text-primary hover:underline" dir="auto">
                      کانال: {u.channel.name}
                    </Link>
                  ) : (
                    <span>بدون کانال</span>
                  )}
                  <span>
                    عضویت {f.relative(u.createdAt)}
                    {u.lastLoginAt ? ` · آخرین ورود ${f.relative(u.lastLoginAt)}` : ''}
                  </span>
                </div>
                <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                  <Link href={`/admin/users/${u.id}`}>{canManage ? 'مدیریت' : 'مشاهده'}</Link>
                </Button>
              </ResultRow>
            ))}
          </ResultList>
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/users', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
