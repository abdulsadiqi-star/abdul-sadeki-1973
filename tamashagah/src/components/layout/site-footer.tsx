import Link from 'next/link';
import { siteConfig } from '@/config/site';
import { createFormatter } from '@/lib/format';
import { toJalali } from '@/lib/jalali';
import { getDigitMode } from '@/lib/format-server';

const links = [
  { href: '/about', label: 'درباره‌ی ما' },
  { href: '/help', label: 'راهنما' },
  { href: '/apps', label: 'اپلیکیشن‌ها' },
  { href: '/verification', label: 'تیک تأیید' },
  { href: '/copyright', label: 'حق تکثیر' },
  { href: '/terms', label: 'قوانین' },
  { href: '/privacy', label: 'حریم خصوصی' },
] as const;

export async function SiteFooter() {
  const f = createFormatter(await getDigitMode());
  const year = f.localize(String(toJalali(new Date()).jy).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!));
  return (
    <footer className="mt-16 border-t px-4 py-8 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-[120rem] flex-col items-center justify-between gap-4 sm:flex-row">
        <nav aria-label="پیوندهای پایین صفحه">
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="transition-colors hover:text-foreground">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>
          © {year} {siteConfig.name}؛ {siteConfig.tagline}
        </p>
      </div>
    </footer>
  );
}
