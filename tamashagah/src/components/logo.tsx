import Link from 'next/link';
import { cn } from '@/lib/utils';
import { siteConfig } from '@/config/site';

/**
 * Original brand mark: a violet→magenta rounded square with a play glyph.
 * (Intentionally unrelated to Aparat's logo — replace freely.)
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-sm', className)}
    >
      <svg viewBox="0 0 24 24" className="size-[52%]" fill="currentColor">
        <path d="M8 5.6c0-1.1 1.2-1.8 2.2-1.2l9 5.9c.9.6.9 1.8 0 2.4l-9 5.9c-1 .6-2.2-.1-2.2-1.2V5.6Z" />
      </svg>
    </span>
  );
}

export function Logo({ className, showName = true, href = '/' }: { className?: string; showName?: boolean; href?: '/' | '/studio' }) {
  return (
    <Link
      href={href}
      aria-label={`${siteConfig.name} — صفحه‌ی اصلی`}
      className={cn('inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}
    >
      <LogoMark />
      {showName && <span className="text-xl font-extrabold tracking-tight">{siteConfig.name}</span>}
    </Link>
  );
}
