'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { Loader2, Play, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ShortPlayerMode = 'active' | 'preload';

type Props = {
  hlsUrl: string;
  /** Wider than tall: letterbox instead of crop. */
  landscape?: boolean;
  /** `active` plays; `preload` only buffers a little (the NEXT short). */
  mode: ShortPlayerMode;
  muted: boolean;
  /** Called when the browser refused to autoplay WITH sound and playback fell back to muted. */
  onSoundBlocked: () => void;
  /** The short cannot be played (missing playlist, unsupported media, network down). */
  onSkip: () => void;
};

/**
 * One short. hls.js (loaded lazily) when Media Source Extensions exist, otherwise the browser's native HLS (Safari/iOS).
 * Plays only while `active`, always starts muted unless the viewer chose sound, pauses when the tab is hidden, loops,
 * draws a thin progress line and shows a clear message when the media is broken. Mounted only for the active short and
 * the next one, so at most two decoders exist at a time.
 */
export function ShortPlayer({ hlsUrl, landscape = false, mode, muted, onSoundBlocked, onSkip }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(muted);
  const soundBlockedRef = useRef(onSoundBlocked);
  const [sourceReady, setSourceReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = mode === 'active';

  useEffect(() => {
    mutedRef.current = muted;
    soundBlockedRef.current = onSoundBlocked;
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, onSoundBlocked]);

  // --- attach the source ---------------------------------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hls: Hls | null = null;
    let retries = 0;
    const fail = () => {
      if (!cancelled) setFailed(true);
    };
    const onMeta = () => setSourceReady(true);
    video.addEventListener('loadedmetadata', onMeta);

    (async () => {
      const { default: HlsLib } = await import('hls.js');
      if (cancelled) return;
      if (HlsLib.isSupported()) {
        hls = new HlsLib({ maxBufferLength: 8, maxMaxBufferLength: 12, backBufferLength: 4, capLevelToPlayerSize: true });
        hls.on(HlsLib.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          const missing = data.response?.code === 404 || data.response?.code === 403;
          if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR && retries < 2) {
            retries++;
            hls?.recoverMediaError();
          } else if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR && !missing && retries < 2) {
            retries++;
            hls?.startLoad();
          } else {
            fail();
          }
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.addEventListener('error', fail, { once: true });
        video.src = hlsUrl;
      } else {
        fail();
      }
    })().catch(fail);

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeAttribute('src');
      video.load();
    };
  }, [hlsUrl]);

  // --- play / pause ----------------------------------------------------------------------------------------------------
  const tryPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = mutedRef.current;
    video.play().catch((error: unknown) => {
      if ((error as DOMException | undefined)?.name === 'NotAllowedError' && !video.muted) {
        // Autoplay with sound is blocked until the viewer interacts with the page: carry on muted.
        video.muted = true;
        soundBlockedRef.current();
        video.play().catch(() => undefined);
      }
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active && sourceReady && !userPaused) tryPlay();
    else video.pause();
  }, [active, sourceReady, userPaused, tryPlay]);

  // pause while the tab is hidden, resume when it is visible again
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
      else if (active && sourceReady && !userPaused) tryPlay();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, sourceReady, userPaused, tryPlay]);

  // --- progress line (driven by rAF while active; no React re-render per frame) -----------------------------------------
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      const bar = progressRef.current;
      if (video && bar && video.duration > 0) bar.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="absolute inset-0">
      <video
        ref={videoRef}
        playsInline
        loop
        muted
        preload={active ? 'auto' : 'metadata'}
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => {
          setPlaying(true);
          setBuffering(false);
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        className={cn('absolute inset-0 size-full transition-opacity duration-200', landscape ? 'object-contain' : 'object-cover', playing ? 'opacity-100' : 'opacity-0')}
      />

      {active && !failed && (
        <button
          type="button"
          data-role="toggle-play"
          aria-label={userPaused ? 'ادامه‌ی پخش' : 'توقف پخش'}
          onClick={() => setUserPaused((paused) => !paused)}
          className="absolute inset-0 z-10 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring"
        />
      )}

      {active && userPaused && !failed && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
            <Play className="size-8 fill-current" />
          </span>
        </span>
      )}

      {active && buffering && !failed && !userPaused && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="size-9 animate-spin text-white/90 drop-shadow" />
        </span>
      )}

      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 z-30 h-1 bg-white/25">
        <div ref={progressRef} className="h-full w-0 bg-white" />
      </div>

      {failed && (
        <div role="alert" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-white">
          <TriangleAlert aria-hidden="true" className="size-9 text-warning" />
          <p className="text-sm font-semibold">پخش این شورت ممکن نیست.</p>
          <p className="text-xs text-white/75">فایل ویدیو در دسترس نیست یا هنوز آماده نشده است.</p>
          {active && (
            <Button type="button" size="sm" shape="pill" variant="secondary" onClick={onSkip}>
              شورت بعدی
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
