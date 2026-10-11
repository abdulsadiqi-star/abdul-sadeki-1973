import { SiteShell } from '@/components/layout/site-shell';
import { requirePageRole } from '@/lib/auth/guards';

export const metadata = { title: { default: 'پنل مدیریت', template: '%s | مدیریت تماشاگاه' }, robots: { index: false } };

/** Moderators and administrators only. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole('MODERATOR', '/admin');
  return <SiteShell>{children}</SiteShell>;
}
