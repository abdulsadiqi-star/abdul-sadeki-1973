import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { siteConfig } from '@/config/site';
import { createFormatter, type DigitMode, type Formatter } from './format';

/** Numeral style for this request: user preference (cookie mirrors it) → default Persian digits. */
export const getDigitMode = cache(async (): Promise<DigitMode> => {
  const value = (await cookies()).get(siteConfig.digitsCookie)?.value;
  return value === 'en' ? 'en' : 'fa';
});

/** `const f = await getFormatter(); f.compact(4100)` — for Server Components. */
export const getFormatter = cache(async (): Promise<Formatter> => createFormatter(await getDigitMode()));
