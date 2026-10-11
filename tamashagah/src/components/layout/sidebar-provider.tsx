'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { siteConfig } from '@/config/site';

type SidebarState = {
  /** Desktop rail (icons only) vs. expanded. */
  collapsed: boolean;
  /** Mobile drawer open state. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  /** Hamburger action: collapse/expand on desktop, open the drawer on mobile. */
  toggle: () => void;
};

const SidebarContext = createContext<SidebarState | null>(null);

export function SidebarProvider({
  defaultCollapsed,
  children,
}: {
  defaultCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // The drawer is "open for a specific path": navigating changes the path, which closes it
  // without needing an effect.
  const pathname = usePathname();
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const mobileOpen = openForPath === pathname;
  const setMobileOpen = useCallback((open: boolean) => setOpenForPath(open ? pathname : null), [pathname]);

  const toggle = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setCollapsed((prev) => {
        const next = !prev;
        document.cookie = `${siteConfig.sidebarCookie}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
        return next;
      });
    } else {
      setOpenForPath((current) => (current === pathname ? null : pathname));
    }
  }, [pathname]);

  const value = useMemo(
    () => ({ collapsed, mobileOpen, setMobileOpen, toggle }),
    [collapsed, mobileOpen, setMobileOpen, toggle],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return ctx;
}
