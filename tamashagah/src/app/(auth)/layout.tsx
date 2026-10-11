import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';

/** Minimal frame for authentication pages: logo, theme switch and a centered card. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(60rem_26rem_at_50%_-8%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent)]">
      <header className="flex h-(--header-height) items-center justify-between px-4 sm:px-8">
        <Logo />
        <ThemeToggle />
      </header>
      <main id="main-content" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 py-8 outline-none sm:items-center sm:py-12">
        {children}
      </main>
    </div>
  );
}
