import { SidebarProvider } from '@/components/layout/sidebar-provider';
import { SiteHeader } from '@/components/layout/site-header';
import { AdminSidebar } from '@/components/layout/admin-sidebar';
import { VerifyEmailBanner } from '@/components/layout/verify-email-banner';
import type { CurrentUser } from '@/lib/auth/session';
import type { NavCounts } from '@/features/admin/queries/overview';

/**
 * Staff panel frame: the global header, a fixed sidebar with the admin sections (with live "waiting" counts)
 * and the page content. On phones the sidebar is a drawer opened by the header menu button.
 */
export function AdminShell({ user, counts, children }: { user: CurrentUser; counts: NavCounts; children: React.ReactNode }) {
  return (
    <SidebarProvider defaultCollapsed={false}>
      <SiteHeader user={user} desktopToggle={false} />
      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <div className="mx-auto flex max-w-[120rem]">
        <AdminSidebar role={user.role} displayName={user.displayName} counts={counts} />
        <main id="main-content" tabIndex={-1} className="min-h-[calc(100dvh-var(--header-height))] min-w-0 flex-1 bg-muted/30 px-3 py-5 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
