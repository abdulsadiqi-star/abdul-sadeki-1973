'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The global "muted" switch of the shorts feed, remembered in localStorage. Muted is the default (browsers only
 * autoplay muted video); once the viewer unmutes, every following short starts with sound. Storage can be missing or
 * throw (private windows, blocked site data): the preference then lives in memory for the session.
 */
const STORAGE_KEY = 'tg_shorts_muted';
const listeners = new Set<() => void>();
let memory: boolean | null = null;

function read(): boolean {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      memory = null; // another tab changed it: re-read from storage
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useShortsMuted(): readonly [boolean, (muted: boolean) => void] {
  const muted = useSyncExternalStore(subscribe, read, () => true);
  const setMuted = useCallback((next: boolean) => {
    memory = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* in-memory fallback only */
    }
    for (const listener of listeners) listener();
  }, []);
  return [muted, setMuted] as const;
}
