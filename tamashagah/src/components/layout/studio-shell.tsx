import { SidebarProvider } from '@/components/layout/sidebar-provider';
import { SiteHeader } from '@/components/layout/site-header';
import { StudioSidebar } from '@/components/layout/studio-sidebar';
import { VerifyEmailBanner } from '@/components/layout/verify-email-banner';
import type { CurrentUser } from '@/lib/auth/session';

/**
 * Creator Studio frame: the global header, a fixed right sidebar with the
 * channel identity + studio navigation, and the page content.
 */
export function StudioShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return (
    <SidebarProvider defaultCollapsed={false}>
      <SiteHeader user={user} desktopToggle={false} />
      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <div className="mx-auto flex max-w-[120rem]">
        <StudioSidebar channel={user.channel} userName={user.displayName} />
        <main id="main-content" tabIndex={-1} className="min-h-[calc(100dvh-var(--header-height))] min-w-0 flex-1 bg-muted/30 px-3 py-5 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
