import { AdminShell } from '@/components/layout/admin-shell';
import { requireStaffPage } from '@/features/admin/guard';
import { getNavCounts } from '@/features/admin/queries/overview';

export const metadata = { title: { default: 'پنل مدیریت', template: '%s | مدیریت تماشاگاه' }, robots: { index: false } };

/**
 * Staff only. NOTE: a layout is not re-rendered on client-side navigation, so this is the frame guard —
 * every admin page and every action repeats its own (finer) check.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage('MODERATOR', '/admin');
  const counts = await getNavCounts(user.role);
  return (
    <AdminShell user={user} counts={counts}>
      {children}
    </AdminShell>
  );
}
