import type { ReactNode } from 'react';

/** A titled home-page section: `h2` (linked via aria-labelledby), optional hint and "see all" action. */
export function HomeSection({
  id,
  title,
  icon,
  hint,
  action,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`${id}-heading`} className="flex items-center gap-2 text-lg font-bold">
            {icon}
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
