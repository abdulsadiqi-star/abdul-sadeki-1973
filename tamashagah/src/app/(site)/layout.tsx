import { SiteShell } from '@/components/layout/site-shell';

/** Public site frame (header + sidebar + footer) for every page in the (site) group. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
