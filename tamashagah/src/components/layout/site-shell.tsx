import { cookies } from 'next/headers';
import { siteConfig } from '@/config/site';
import { getCurrentUser } from '@/lib/auth/session';
import { getCategories } from '@/features/categories/queries';
import { SidebarProvider } from '@/components/layout/sidebar-provider';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteSidebar } from '@/components/layout/site-sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SiteFooter } from '@/components/layout/site-footer';
import { VerifyEmailBanner } from '@/components/layout/verify-email-banner';

/**
 * Public site frame: sticky header + right-hand sidebar + content + footer.
 * Wrap pages with it through `src/app/(site)/layout.tsx`.
 */
export async function SiteShell({ children }: { children: React.ReactNode }) {
  const [user, categories, jar] = await Promise.all([getCurrentUser(), getCategories(), cookies()]);
  const defaultCollapsed = jar.get(siteConfig.sidebarCookie)?.value === 'collapsed';

  return (
    <SidebarProvider defaultCollapsed={defaultCollapsed}>
      <SiteHeader user={user} />
      {user && !user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <div className="mx-auto flex max-w-[120rem]">
        <SiteSidebar categories={categories} />
        <div className="flex min-h-[calc(100dvh-var(--header-height))] min-w-0 flex-1 flex-col">
          <main id="main-content" tabIndex={-1} className="flex-1 px-3 pt-4 pb-24 outline-none sm:px-6 sm:pt-6 lg:pb-8">
            {children}
          </main>
          <SiteFooter />
        </div>
      </div>
      <MobileNav signedIn={!!user} />
    </SidebarProvider>
  );
}
