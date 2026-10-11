import Link from 'next/link';
import type { Route } from 'next';
import { Flag, Tv } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { FilterBar } from '@/components/admin/filter-bar';
import { ChannelActions } from '@/components/admin/channel-actions';
import { ChannelLink, ResultList, ResultRow, UserLink } from '@/components/admin/layout-bits';
import { ResultCount } from '@/components/admin/result-count';
import { requireStaffPage } from '@/features/admin/guard';
import { checkTargetUser } from '@/features/admin/policy';
import { listAdminChannels } from '@/features/admin/queries/channels';
import { channelListSchema, flattenSearchParams } from '@/features/admin/schemas';
import { pageHref } from '@/features/admin/url';
import { getFormatter } from '@/lib/format-server';

export const metadata = { title: 'کانال‌ها' };
export const dynamic = 'force-dynamic';

export default async function AdminChannelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireStaffPage('MODERATOR');
  const raw = await searchParams;
  const filters = channelListSchema.parse(flattenSearchParams(raw));
  const f = await getFormatter();
  const { items, pageInfo } = await listAdminChannels(filters);

  const values = { q: filters.q ?? '', verified: filters.verified, suspended: filters.suspended, sort: filters.sort };
  const filtered = !!filters.q || filters.verified !== 'ALL' || filters.suspended !== 'ALL';
  const yesNo = (yes: string, no: string) => [{ value: 'ALL', label: 'همه' }, { value: 'YES', label: yes }, { value: 'NO', label: no }];

  return (
    <div>
      <PageHeader title="کانال‌ها" description="جستجوی کانال‌ها، دادن یا برداشتن تیک تأیید و تعلیق یا رفع تعلیق. کانال تعلیق‌شده و ویدیوهایش از دید عموم پنهان می‌شوند." />

      <FilterBar
        key={JSON.stringify(values)}
        label="فیلتر کانال‌ها"
        values={values}
        fields={[
          { kind: 'search', name: 'q', label: 'جستجو', placeholder: 'نام یا شناسه‌ی کانال، نام یا ایمیل صاحب' },
          { kind: 'select', name: 'verified', label: 'تیک تأیید', defaultValue: 'ALL', options: yesNo('دارای تیک', 'بدون تیک') },
          { kind: 'select', name: 'suspended', label: 'تعلیق', defaultValue: 'ALL', options: yesNo('تعلیق‌شده', 'فعال') },
          {
            kind: 'select',
            name: 'sort',
            label: 'مرتب‌سازی',
            defaultValue: 'newest',
            options: [
              { value: 'newest', label: 'جدیدترین' },
              { value: 'followers', label: 'بیشترین دنبال‌کننده' },
            ],
          },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon={Tv} title={filtered ? 'کانالی با این فیلترها پیدا نشد' : 'هنوز کانالی ساخته نشده است'} description={filtered ? 'فیلترها را تغییر دهید یا پاک کنید.' : undefined} />
      ) : (
        <>
          <ResultCount total={pageInfo.total} noun="کانال" />
          <ResultList label="فهرست کانال‌ها">
            {items.map((c) => {
              const verdict = checkTargetUser(viewer, { id: c.owner.id, role: c.owner.role }, 'channel.suspend');
              return (
                <ResultRow key={c.id}>
                  <div className="min-w-0 flex-1 basis-60 space-y-1.5">
                    <ChannelLink id={c.id} name={c.name} handle={c.handle} avatarUrl={c.avatarUrl} isVerified={c.isVerified} size="md" />
                    <p className="text-xs text-muted-foreground">
                      صاحب: <UserLink id={c.owner.id} name={c.owner.name} role={c.owner.role} />
                    </p>
                  </div>
                  <div className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
                    <span>{f.followers(c.followerCount)}</span>
                    <span>{f.count(c.videoCount, 'ویدیو')}</span>
                    <span>ساخته‌شده {f.relative(c.createdAt)}</span>
                  </div>
                  <div className="flex min-w-32 flex-wrap items-center gap-1.5">
                    {c.suspendedAt ? <Badge variant="destructive">تعلیق‌شده</Badge> : <Badge variant="success">فعال</Badge>}
                    {c.isVerified && <Badge variant="info">تیک تأیید</Badge>}
                    {c.openReports > 0 && (
                      <Badge variant="warning">
                        <Flag />
                        {f.number(c.openReports)} گزارش باز
                      </Badge>
                    )}
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <Button asChild variant="outline" size="xs">
                      <Link href={`/admin/channels/${c.id}`}>جزئیات و آمار</Link>
                    </Button>
                    <ChannelActions channelId={c.id} name={c.name} isVerified={c.isVerified} suspended={!!c.suspendedAt} openReports={c.openReports} denial={verdict.ok ? null : verdict.message} />
                  </div>
                </ResultRow>
              );
            })}
          </ResultList>
          <Pagination className="mt-6" page={pageInfo.page} pageCount={pageInfo.pageCount} href={(p) => pageHref('/admin/channels', raw, p) as Route} />
        </>
      )}
    </div>
  );
}
