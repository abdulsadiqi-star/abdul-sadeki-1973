import { PageHeader } from '@/components/page-header';
import { requirePageUser } from '@/lib/auth/guards';
import { countUnreadNotifications, listNotifications } from '@/features/notifications/queries';
import { NotificationsCenter } from '@/features/notifications/components/notifications-center';

export const metadata = { title: 'اعلان‌ها' };

const PAGE_SIZE = 20;

/** Notifications center: every notification of the signed-in user, unread/all filter, deep links. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requirePageUser('/studio/notifications');
  const { filter: rawFilter } = await searchParams;
  const filter = rawFilter === 'unread' ? 'unread' : 'all';

  const [page, unreadCount] = await Promise.all([
    listNotifications(user.id, { limit: PAGE_SIZE, unreadOnly: filter === 'unread' }),
    countUnreadNotifications(user.id),
  ]);

  return (
    <>
      <PageHeader title="اعلان‌ها" description="دیدگاه‌ها، پاسخ‌ها، دنبال‌کننده‌ها و وضعیت ویدیوهای شما" />
      <NotificationsCenter filter={filter} initial={{ items: page.items, nextCursor: page.nextCursor }} initialUnread={unreadCount} />
    </>
  );
}
