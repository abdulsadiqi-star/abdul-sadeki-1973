import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { ChannelAvatar } from '@/components/channel-avatar';
import { VerifiedBadge } from '@/components/verified-badge';
import { RoleBadge } from '@/components/admin/badges';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/generated/prisma/enums';

/** A titled card for one block of a detail page. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={className}>
      <Card className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-bold">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

/** Label / value pairs (`<dl>`), two columns from the `sm` breakpoint. */
export function DefList({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid gap-x-8 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 min-w-0 text-sm break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Bordered list container for result rows. */
export function ResultList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {children}
    </ul>
  );
}

export function ResultRow({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:p-4', className)}>{children}</li>;
}

export function UserLink({ id, name, role, email }: { id: string; name: string; role?: UserRole; email?: string }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Link href={`/admin/users/${id}` as Route} className="min-w-0 font-medium break-words hover:text-primary hover:underline" dir="auto">
        {name}
      </Link>
      {role && role !== 'USER' && role !== 'CREATOR' && <RoleBadge role={role} />}
      {email && <span className="ltr-isolate text-xs break-all text-muted-foreground">{email}</span>}
    </span>
  );
}

export function ChannelLink({
  id,
  name,
  handle,
  avatarUrl,
  isVerified,
  size = 'sm',
  href,
}: {
  id: string;
  name: string;
  handle?: string;
  avatarUrl?: string | null;
  isVerified?: boolean;
  size?: 'xs' | 'sm' | 'md';
  href?: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ChannelAvatar name={name} src={avatarUrl} size={size} />
      <span className="min-w-0">
        <Link href={(href ?? `/admin/channels/${id}`) as Route} className="flex items-center gap-1 font-medium hover:text-primary hover:underline" dir="auto">
          <span className="truncate">{name}</span>
          {isVerified && <VerifiedBadge />}
        </Link>
        {handle && <span className="ltr-isolate block truncate text-xs text-muted-foreground">@{handle}</span>}
      </span>
    </span>
  );
}

/** Quoted free text written by users (report details, messages, reasons). */
export function UserText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p dir="auto" className={cn('user-text rounded-lg bg-muted/60 px-3 py-2 text-sm leading-7 break-words whitespace-pre-line', className)}>
      {children}
    </p>
  );
}
