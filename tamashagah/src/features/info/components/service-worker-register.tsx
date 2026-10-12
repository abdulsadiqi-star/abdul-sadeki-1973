'use client';

import { useEffect } from 'react';

/**
 * Registers the minimal service worker (`/sw.js`): it only shows an offline page when a page navigation fails, and never
 * caches pages, API responses or media. Production builds only, so development hot reloading is never intercepted.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
