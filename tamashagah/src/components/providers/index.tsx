'use client';

import { useState, type ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { Direction } from 'radix-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import type { DigitMode } from '@/lib/format';
import { FormatProvider } from './format-provider';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = (error as { status?: number } | null)?.status;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

/**
 * Global client providers:
 *  - next-themes     light / dark / system (class strategy)
 *  - Radix Direction RTL for every portal (menus, popovers, tooltips, sliders)
 *  - TanStack Query  client-side data fetching
 *  - numerals        Persian / English digits for useFormatter()
 */
export function Providers({ digits, children }: { digits: DigitMode; children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Direction.Provider dir="rtl">
        <QueryClientProvider client={queryClient}>
          <FormatProvider digits={digits}>
            <TooltipProvider delayDuration={250}>
              {children}
              <Toaster />
            </TooltipProvider>
          </FormatProvider>
        </QueryClientProvider>
      </Direction.Provider>
    </ThemeProvider>
  );
}
