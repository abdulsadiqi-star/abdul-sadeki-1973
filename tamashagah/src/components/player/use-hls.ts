'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type HlsType from 'hls.js';
import type { ErrorData } from 'hls.js';
import {
  MAX_NETWORK_RETRIES,
  NETWORK_MESSAGE,
  UNAVAILABLE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  isPermanentHttpStatus,
  levelIndexForHeight,
  mapMediaError,
  qualityOptions,
  retryDelayMs,
  type PlayerErrorInfo,
  type QualityOption,
} from './player-utils';
import { writePrefs } from './player-prefs';

export type HlsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';
export type Quality = 'auto' | number;

type Options = {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Master playlist URL. */
  src: string;
  /** Wait (false) until the start position is known, so playback begins at the right place. */
  enabled: boolean;
  startPosition: number;
  autoPlay: boolean;
  initialQuality: Quality;
  onAutoplayBlocked?: () => void;
};

export type HlsController = {
  status: HlsStatus;
  engine: 'hlsjs' | 'native' | null;
  error: PlayerErrorInfo | null;
  /** One entry per available height (tallest first); empty with native HLS. */
  qualities: QualityOption[];
  /** What the viewer chose. */
  quality: Quality;
  /** Height currently being played (what "Auto" resolved to). */
  activeHeight: number | null;
  setQuality: (quality: Quality) => void;
  /** Re-create the player from scratch (the overlay's "تلاش دوباره"). */
  retry: () => void;
};

/** Seconds that must pass before another media-error recovery is attempted. */
const MEDIA_RECOVERY_COOLDOWN_MS = 30_000;

function tryPlay(video: HTMLVideoElement, onBlocked?: () => void) {
  video.play().catch((error: unknown) => {
    // Autoplay policy: not an error, the big play button simply stays visible. AbortError = source replaced meanwhile.
    if ((error as { name?: string } | null)?.name === 'NotAllowedError') onBlocked?.();
  });
}

/**
 * hls.js lifecycle for one <video>: adaptive playback with the native-HLS fallback (Safari / iOS), a clear
 * "unsupported" state otherwise, bounded network retries with exponential back-off, media-error recovery,
 * quality selection (Auto + concrete heights) and autoplay-policy handling.
 */
export function useHls(options: Options): HlsController {
  const { videoRef, src, enabled } = options;
  const [status, setStatus] = useState<HlsStatus>('idle');
  const [engine, setEngine] = useState<'hlsjs' | 'native' | null>(null);
  const [error, setError] = useState<PlayerErrorInfo | null>(null);
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [quality, setQualityState] = useState<Quality>(options.initialQuality);
  const [activeLevel, setActiveLevel] = useState(-1);
  const [attempt, setAttempt] = useState(0);

  const [levelHeights, setLevelHeights] = useState<number[]>([]);

  const hlsRef = useRef<HlsType | null>(null);
  const qualitiesRef = useRef<QualityOption[]>([]);
  const qualityRef = useRef<Quality>(options.initialQuality);
  const qualityInitialised = useRef(false);
  // "Latest value" ref: these options must not restart the player when they change after mount. It is synced in
  // an effect (declared BEFORE the player effect, so it is current when that one runs), never during render.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video || !src) return;

    let cancelled = false;
    let hls: HlsType | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let networkRetries = 0;
    let lastMediaRecovery = 0;
    let mediaRecoveries = 0;
    let nativeEngine = false;

    // The remembered quality is only known once the player is enabled (client preferences are read after mount).
    if (!qualityInitialised.current) {
      qualityInitialised.current = true;
      qualityRef.current = latest.current.initialQuality;
      setQualityState(latest.current.initialQuality);
    }
    setStatus('loading');
    setError(null);
    setQualities([]);
    setActiveLevel(-1);
    setLevelHeights([]);
    qualitiesRef.current = [];

    const fail = (info: PlayerErrorInfo) => {
      if (cancelled) return;
      setError(info);
      setStatus('error');
    };

    const recoverMedia = (): boolean => {
      const now = Date.now();
      if (now - lastMediaRecovery > MEDIA_RECOVERY_COOLDOWN_MS) mediaRecoveries = 0;
      lastMediaRecovery = now;
      if (!hls || mediaRecoveries >= 2) return false;
      if (mediaRecoveries === 1) hls.swapAudioCodec(); // second attempt: the codec guess may be wrong
      mediaRecoveries += 1;
      hls.recoverMediaError();
      return true;
    };

    const onVideoError = () => {
      if (cancelled || !video.error) return;
      if (!nativeEngine && recoverMedia()) return;
      fail(mapMediaError(video.error.code));
    };
    video.addEventListener('error', onVideoError);

    void (async () => {
      let Hls: typeof HlsType;
      try {
        Hls = (await import('hls.js')).default;
      } catch {
        fail({ message: NETWORK_MESSAGE, retryable: true });
        return;
      }
      if (cancelled) return;

      if (Hls.isSupported()) {
        setEngine('hlsjs');
        const start = latest.current.startPosition;
        hls = new Hls({
          startPosition: start > 0 ? start : -1,
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          backBufferLength: 60,
          capLevelToPlayerSize: true,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          setLevelHeights(data.levels.map((l) => l.height ?? 0));
          const list = qualityOptions(data.levels);
          qualitiesRef.current = list;
          setQualities(list);
          const wanted = qualityRef.current;
          if (wanted !== 'auto' && list.length > 0) hls!.currentLevel = levelIndexForHeight(list, wanted);
          setStatus('ready');
          if (latest.current.autoPlay) tryPlay(video, latest.current.onAutoplayBlocked);
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => setActiveLevel(data.level));
        hls.on(Hls.Events.FRAG_LOADED, () => {
          networkRetries = 0; // healthy again: the next outage gets the full retry budget
        });
        hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
          if (!data.fatal || cancelled) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (isPermanentHttpStatus(data.response?.code)) {
              fail({ message: UNAVAILABLE_MESSAGE, retryable: true });
              return;
            }
            if (networkRetries >= MAX_NETWORK_RETRIES) {
              fail({ message: NETWORK_MESSAGE, retryable: true });
              return;
            }
            const delay = retryDelayMs(networkRetries);
            networkRetries += 1;
            const manifestProblem =
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
              data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
            retryTimer = setTimeout(() => {
              if (cancelled || !hls) return;
              if (manifestProblem) hls.loadSource(src);
              else hls.startLoad();
            }, delay);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (!recoverMedia()) fail(mapMediaError(3));
          } else {
            fail({ message: mapMediaError(undefined).message, retryable: true });
          }
        });

        hls.loadSource(src);
        hls.attachMedia(video);
        return;
      }

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari / iOS: the platform plays HLS natively (no quality control, the system picks renditions).
        nativeEngine = true;
        setEngine('native');
        video.addEventListener(
          'loadedmetadata',
          () => {
            if (cancelled) return;
            const start = latest.current.startPosition;
            if (start > 0) video.currentTime = start;
            setStatus('ready');
            if (latest.current.autoPlay) tryPlay(video, latest.current.onAutoplayBlocked);
          },
          { once: true },
        );
        video.src = src;
        video.load();
        return;
      }

      setEngine(null);
      setStatus('unsupported');
      setError({ message: UNSUPPORTED_MESSAGE, retryable: false });
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      video.removeEventListener('error', onVideoError);
      hls?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load(); // release the media pipeline
    };
  }, [videoRef, src, enabled, attempt]);

  const setQuality = useCallback((next: Quality) => {
    setQualityState(next);
    qualityRef.current = next;
    writePrefs({ quality: next });
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = next === 'auto' ? -1 : levelIndexForHeight(qualitiesRef.current, next);
  }, []);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const activeHeight = activeLevel >= 0 ? (levelHeights[activeLevel] ?? null) : null;
  return { status, engine, error, qualities, quality, activeHeight: activeHeight || null, setQuality, retry };
}
