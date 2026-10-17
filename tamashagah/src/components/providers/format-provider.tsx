'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createFormatter, type DigitMode, type Formatter } from '@/lib/format';

const FormatContext = createContext<Formatter>(createFormatter('fa'));

export function FormatProvider({ digits, children }: { digits: DigitMode; children: ReactNode }) {
  const formatter = useMemo(() => createFormatter(digits), [digits]);
  return <FormatContext.Provider value={formatter}>{children}</FormatContext.Provider>;
}

/** Persian/English numeral-aware formatter for Client Components. */
export function useFormatter(): Formatter {
  return useContext(FormatContext);
}
