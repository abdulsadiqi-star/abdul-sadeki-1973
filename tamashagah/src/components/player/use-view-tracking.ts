'use client';

import { useEffect, type RefObject } from 'react';
import { HEARTBEAT_INTERVAL_SECONDS, hasPlayedEnough } from '@/features/watch/view-rules';
import { PlayTimeAccumulator } from './play-time';
import { writeLocalPosition } from './player-prefs';

type Options = {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoId: string;
  durationSeconds: number | null;
  /** Signed-in viewers also get their resume position saved on the server. */
  signedIn: boolean;
  /** False while there is nothing to track (error / unsupported). */
  enabled: boolean;
};

const SAMPLE_MS = 500;
const POSITION_SAVE_MS = 10_000;
const VIEW_RETRY_MS = 10_000;
const MIN_FLUSH_GAP_MS = 2_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Where the viewer really came from: external referrer only on a hard landing, "internal" after in-app navigation. */
function currentReferrer(): string {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const landedHere = nav && new URL(nav.name).pathname === location.pathname;
    return (landedHere ? document.referrer : `${location.origin}/`).slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * Honest view tracking for one watch session (server rules: features/watch/view-rules.ts):
 *  - counts only time the video really played (PlayTimeAccumulator)
 *  - after ≥ 5 s (or 25 % of videos shorter than 20 s) it POSTs /view once
 *  - every ~15 s of playing time it POSTs a heartbeat with the seconds played since the previous one
 *  - on pause / end / tab hidden / page hide / unmount it flushes through `sendBeacon` (survives navigation)
 *  - the position is also kept in localStorage every ~10 s so anonymous viewers can resume
 * Everything is best effort: network failures never disturb playback.
 */
export function useViewTracking({ videoRef, videoId, durationSeconds, signedIn, enabled }: Options): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;

    const viewUrl = `/api/videos/${videoId}/view`;
    const beatUrl = `/api/videos/${videoId}/heartbeat`;
    const acc = new PlayTimeAccumulator();

    let unreported = 0; // seconds played that the server has not been told about yet
    let viewId: string | null = null;
    let viewState: 'idle' | 'sending' | 'done' | 'disabled' = 'idle';
    let viewRetryAt = 0;
    let beatInFlight = false;
    let lastTime = video.currentTime;
    let lastFlush = 0;
    let lastPositionSave = 0;
    let disposed = false;

    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'same-origin',
    });

    async function sendView() {
      viewState = 'sending';
      const played = round2(acc.total);
      try {
        const res = await fetch(viewUrl, json({ played, position: round2(lastTime), referrer: currentReferrer() }));
        if (res.ok) {
          const data = (await res.json()) as { counted?: boolean; viewId?: string | null; reason?: string };
          viewId = data.viewId ?? null;
          if (data.counted) unreported = Math.max(0, unreported - played); // the view call already carried those seconds
          viewState = viewId ? 'done' : data.reason === 'below-threshold' ? 'idle' : 'disabled';
        } else if (res.status === 429 || res.status >= 500) {
          viewState = 'idle';
          viewRetryAt = performance.now() + VIEW_RETRY_MS;
        } else {
          viewState = 'disabled'; // 404 / 403 / 422: asking again will not help
        }
      } catch {
        viewState = 'idle';
        viewRetryAt = performance.now() + VIEW_RETRY_MS;
      }
    }

    function beatBody(delta: number) {
      return { viewId, delta: round2(Math.min(delta, 600)), position: round2(lastTime) };
    }

    async function sendBeat() {
      if (beatInFlight || !viewId) return;
      const delta = unreported;
      if (delta <= 0) return;
      beatInFlight = true;
      try {
        const res = await fetch(beatUrl, json(beatBody(delta)));
        if (res.ok) unreported = Math.max(0, unreported - delta);
      } catch {
        /* keep the seconds for the next beat */
      } finally {
        beatInFlight = false;
      }
    }

    function savePosition(force = false) {
      const now = performance.now();
      if (!force && now - lastPositionSave < POSITION_SAVE_MS) return;
      lastPositionSave = now;
      writeLocalPosition(videoId, lastTime);
    }

    /** Pause / hide / unload: hand the remaining seconds + the position to the browser, which delivers them even while the page goes away. */
    function flush() {
      const now = performance.now();
      if (now - lastFlush < MIN_FLUSH_GAP_MS) return;
      lastFlush = now;
      savePosition(true);
      if (viewState === 'sending' && !viewId) return; // the view call is still in flight; its keepalive request carries the position
      if (!viewId && !signedIn) return; // nothing to attach to and no account to save a position for
      const delta = viewId ? unreported : 0;
      if (delta <= 0 && !signedIn) return;
      const payload = JSON.stringify(beatBody(delta));
      const queued = navigator.sendBeacon?.(beatUrl, new Blob([payload], { type: 'application/json' }));
      if (queued) unreported = Math.max(0, unreported - delta);
      else void fetch(beatUrl, { ...json(beatBody(delta)) }).catch(() => undefined);
    }

    const tick = () => {
      if (disposed) return;
      lastTime = video.currentTime;
      const credit = acc.sample({
        wallMs: performance.now(),
        mediaTime: video.currentTime,
        playing: !video.paused && !video.ended && !video.seeking && video.readyState >= 3,
        rate: video.playbackRate,
      });
      unreported += credit;

      if (viewState === 'idle' && hasPlayedEnough(acc.total, durationSeconds) && performance.now() >= viewRetryAt) void sendView();
      if (viewState === 'done' && unreported >= HEARTBEAT_INTERVAL_SECONDS) void sendBeat();
      if (credit > 0) savePosition();
    };

    const onPause = () => {
      lastTime = video.currentTime;
      flush();
    };
    const onEnded = () => {
      lastTime = video.duration || video.currentTime;
      lastFlush = 0; // always report the end
      flush();
    };
    const onSeeked = () => {
      lastTime = video.currentTime;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        lastTime = video.currentTime;
        flush();
      }
    };
    const onPageHide = () => {
      lastTime = video.currentTime;
      lastFlush = 0;
      flush();
    };

    const timer = setInterval(tick, SAMPLE_MS);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('seeked', onSeeked);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      disposed = true;
      clearInterval(timer);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('seeked', onSeeked);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      lastFlush = 0;
      flush(); // leaving the page (client-side navigation): same hand-off as pagehide
    };
  }, [videoRef, videoId, durationSeconds, signedIn, enabled]);
}
