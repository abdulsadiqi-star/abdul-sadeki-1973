'use client';

import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/layout/sidebar-provider';
import { cn } from '@/lib/utils';

/** Hamburger: collapses the desktop rail, or opens the drawer on mobile. */
export function SidebarToggle({ desktop = true }: { desktop?: boolean }) {
  const { toggle, mobileOpen } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      shape="pill"
      aria-label="منوی اصلی"
      aria-expanded={mobileOpen}
      onClick={toggle}
      className={cn(!desktop && 'lg:hidden')}
    >
      <Menu className="size-5" />
    </Button>
  );
}
