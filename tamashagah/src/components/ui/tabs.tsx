'use client';

import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

type TabsVariant = 'pills' | 'underline' | 'segmented';

const TabsVariantContext = React.createContext<TabsVariant>('pills');

/**
 * `pills`     — rounded chips, dark active chip (Aparat-style filter row, scrolls on mobile)
 * `underline` — classic underlined tabs
 * `segmented` — compact segmented control
 */
function TabsList({
  className,
  variant = 'pills',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          'flex items-center',
          variant === 'pills' && 'scrollbar-hide w-full justify-start gap-2 overflow-x-auto pb-1',
          variant === 'underline' && 'scrollbar-hide w-full gap-1 overflow-x-auto border-b',
          variant === 'segmented' && 'w-fit gap-1 rounded-lg bg-muted p-1',
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'pills' &&
          'h-9 rounded-full bg-secondary px-4 text-secondary-foreground hover:bg-secondary/70 data-[state=active]:bg-foreground data-[state=active]:text-background',
        variant === 'underline' &&
          '-mb-px h-10 border-b-2 border-transparent px-4 text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground',
        variant === 'segmented' &&
          'h-8 rounded-md px-3 text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
