'use client';

import { useSyncExternalStore } from 'react';
import { confirmUploadAction, deleteVideoAction } from '@/features/videos-studio/actions';
import type { MetadataFormValues } from '@/features/videos-studio/metadata';
import { UPLOAD_ENDPOINT } from '../limits';
import { UploadEngine, type UploadItem } from './engine';
import { createTusTransportFactory } from './tus-transport';

const EMPTY: readonly UploadItem[] = Object.freeze([]);

/**
 * What each upload card's form starts with (by local item id). Module-level like the engine, so a card that is mounted
 * again after navigating away shows the values the creator last saved instead of the defaults.
 */
export const uploadMetadata = new Map<string, MetadataFormValues>();

/**
 * One engine per browser tab. It lives at module level, so uploads keep going while the creator moves between the
 * studio pages (client-side navigation keeps the module); a full page reload ends them, and the same files can be
 * picked again to continue where they stopped.
 */
let engine: UploadEngine | null = null;

export function getUploadEngine(): UploadEngine {
  engine ??= new UploadEngine({
    createTransport: createTusTransportFactory(),
    endpoint: UPLOAD_ENDPOINT,
    maxBytes: 2 * 1024 ** 3, // replaced with the server's limit by the page (`configure`)
    confirm: async (videoId) => {
      const result = await confirmUploadAction({ id: videoId });
      if (!result.ok) return { ok: false, message: result.message };
      if (result.data.status === 'incomplete' || result.data.status === 'missing') {
        return { ok: false, message: 'ذخیره‌ی فایل کامل نشد. دوباره تلاش کنید.' };
      }
      return { ok: true };
    },
    discard: (videoId) => deleteVideoAction({ id: videoId }),
  });
  return engine;
}

/** The upload list of this tab (re-renders on every change; progress is throttled by the engine). */
export function useUploadItems(): readonly UploadItem[] {
  return useSyncExternalStore(
    (listener) => getUploadEngine().subscribe(listener),
    () => getUploadEngine().getSnapshot(),
    () => EMPTY,
  );
}
