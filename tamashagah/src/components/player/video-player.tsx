'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Direction } from 'radix-ui';
import { Captions, Keyboard, Maximize, Minimize, Pause, PictureInPicture2, Play, Settings } from 'lucide-react';
import { useFormatter } from '@/components/providers/format-provider';
import { cn } from '@/lib/utils';
import { playerLabels } from './labels';
import { PlayerMenu, type PlayerSubtitle } from './player-menu';
import { registerPlayer } from './player-bridge';
import { BigPlayButton, BufferingSpinner, CaptionsOverlay, ErrorOverlay, SeekRipple, type SeekRippleState } from './player-overlays';
import { readLocalPosition, readPrefs, writePrefs, type PlayerPrefs } from './player-prefs';
import {
  SEEK_JUMP_SECONDS,
  chooseStartPosition,
  clamp01,
  clampTime,
  isActivationTarget,
  isEditableTarget,
  mapShortcut,
  pickCaptionsToEnable,
  pickInitialSubtitle,
  stepSpeed,
  stripCueMarkup,
  type PlayerAction,
} from './player-utils';
import { SeekBar } from './seek-bar';
import { ShortcutsHelp } from './shortcuts-help';
import { useHls } from './use-hls';
import { usePlaybackState } from './use-playback-state';
import { useViewTracking } from './use-view-tracking';
import { VolumeControl } from './volume-control';

export type { PlayerSubtitle } from './player-menu';

export type VideoPlayerProps = {
  videoId: string;
  title: string;
  /** Master playlist URL (`/media/videos/<id>/hls/master.m3u8`). */
  src: string;
  poster?: string | null;
  durationSeconds?: number | null;
  subtitles?: PlayerSubtitle[];
  /** Explicit start position (`?t=`); beats any saved position. */
  startAt?: number | null;
  /** Saved position of the signed-in viewer. */
  resume?: { positionSeconds: number; /** ISO */ at: string } | null;
  signedIn: boolean;
  /** Try to start playing on load (browsers may refuse; the big play button is shown then). */
  autoPlay?: boolean;
  /** Count views and watch time (off for previews). */
  track?: boolean;
  className?: string;
};

type Boot = { start: number; prefs: Partial<PlayerPrefs>; subtitleId: string | null };

const NO_SUBTITLES: PlayerSubtitle[] = [];
const HIDE_AFTER_MS = 3_000;
const DOUBLE_TAP_MS = 300;
const subscribeNothing = () => () => undefined;

const controlButton =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 aria-pressed:bg-white/20 disabled:opacity-50';

/**
 * The video player: hls.js adaptive playback (native HLS fallback), accessible RTL controls, keyboard shortcuts,
 * speed / quality / subtitles, fullscreen and picture-in-picture, resume position and honest view tracking.
 * Everything is built from the pieces next to this file; see docs/features/watch.md.
 */
export function VideoPlayer({
  videoId,
  title,
  src,
  poster = null,
  durationSeconds = null,
  subtitles = NO_SUBTITLES,
  startAt = null,
  resume = null,
  signedIn,
  autoPlay = false,
  track = true,
  className,
}: VideoPlayerProps) {
  const f = useFormatter();
  const dir = Direction.useDirection();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const trackEls = useRef(new Map<string, HTMLTrackElement>());

  // ---- client-only start-up: saved preferences + where to resume ---------------------------------------------
  // `isClient` is false during server rendering AND the hydration pass, so the markup always matches; the real
  // values (localStorage, saved position) are computed right after, once, without an effect.
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const resumePosition = resume?.positionSeconds;
  const resumeAt = resume?.at;
  const boot = useMemo<Boot | null>(() => {
    if (!isClient) return null;
    const prefs = readPrefs();
    const start = chooseStartPosition({
      explicit: startAt,
      server: resumePosition !== undefined && resumeAt ? { position: resumePosition, at: Date.parse(resumeAt) } : null,
      local: readLocalPosition(videoId),
      durationSeconds,
    });
    return { start, prefs, subtitleId: pickInitialSubtitle(subtitles, prefs.captions) };
  }, [isClient, videoId, startAt, resumePosition, resumeAt, durationSeconds, subtitles]);

  const hls = useHls({
    videoRef,
    src,
    enabled: boot !== null,
    startPosition: boot?.start ?? 0,
    autoPlay,
    initialQuality: boot?.prefs.quality ?? 'auto',
  });
  const pb = usePlaybackState(videoRef, durationSeconds ?? 0);
  useViewTracking({ videoRef, videoId, durationSeconds, signedIn, enabled: track && hls.status === 'ready' });

  // Remembered volume / mute (applied once the preferences are known).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !boot) return;
    if (typeof boot.prefs.volume === 'number') video.volume = boot.prefs.volume;
    if (typeof boot.prefs.muted === 'boolean') video.muted = boot.prefs.muted;
  }, [boot]);

  // Let the share dialog read the current position.
  useEffect(() => registerPlayer(videoId, { getCurrentTime: () => videoRef.current?.currentTime ?? 0 }), [videoId]);

  // ---- small UI state ------------------------------------------------------------------------------------------
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [wantsPlay, setWantsPlay] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [ripple, setRipple] = useState<SeekRippleState | null>(null);
  const [subtitleOverride, setSubtitleOverride] = useState<string | null | undefined>(undefined);
  const [cueText, setCueText] = useState('');
  const pipSupported = useSyncExternalStore(
    subscribeNothing,
    () => typeof document !== 'undefined' && !!document.pictureInPictureEnabled,
    () => false,
  );

  const activeSubtitleId = subtitleOverride !== undefined ? subtitleOverride : (boot?.subtitleId ?? null);
  const announce = useCallback((text: string) => setAnnouncement(text), []);
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), 1_500);
    return () => clearTimeout(timer);
  }, [announcement]);

  // ---- controls: auto-hide with focus-aware logic ------------------------------------------------------------
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ paused: true, menuOpen: false, helpOpen: false });
  useEffect(() => {
    live.current = { paused: pb.paused, menuOpen, helpOpen };
  });
  const scheduleHide = useCallback((delay: number) => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const { paused, menuOpen: menu, helpOpen: help } = live.current;
      if (paused || menu || help) return; // stay visible while paused or while a menu / dialog is open
      if (rootRef.current?.querySelector(':focus-visible')) return; // keyboard focus is inside the controls
      setControlsShown(false);
    }, delay);
  }, []);
  const showControls = useCallback(() => {
    setControlsShown(true);
    scheduleHide(HIDE_AFTER_MS);
  }, [scheduleHide]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (!pb.paused) scheduleHide(HIDE_AFTER_MS - 500); // playback just started: let the bar fade soon
  }, [pb.paused, scheduleHide]);

  // ---- basic operations ----------------------------------------------------------------------------------------
  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.currentSrc) {
      setWantsPlay(true); // the source is still being attached; play as soon as it is ready
      return;
    }
    void video.play().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (wantsPlay && hls.status === 'ready') void videoRef.current?.play().catch(() => undefined);
  }, [wantsPlay, hls.status]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const clear = () => setWantsPlay(false); // playback really started: the request is fulfilled
    video.addEventListener('playing', clear);
    return () => video.removeEventListener('playing', clear);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) play();
    else video.pause();
  }, [play]);

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const total = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (durationSeconds ?? 0);
      video.currentTime = clampTime(time, total);
    },
    [durationSeconds],
  );

  const showRipple = useCallback(
    (side: 'start' | 'end', forward: boolean) => {
      const text = (forward ? playerLabels.skipForward : playerLabels.skipBackward)(f.number(SEEK_JUMP_SECONDS));
      setRipple({ id: Date.now(), side, forward, text });
      announce(text);
    },
    [f, announce],
  );
  useEffect(() => {
    if (!ripple) return;
    const timer = setTimeout(() => setRipple(null), 650);
    return () => clearTimeout(timer);
  }, [ripple]);

  const applyVolume = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const volume = clamp01(value);
    video.volume = volume;
    video.muted = volume === 0;
    writePrefs(volume === 0 ? { muted: true } : { volume, muted: false });
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
    writePrefs({ muted: video.muted, volume: video.volume || 0.5 });
    announce(video.muted ? playerLabels.mute : playerLabels.unmute);
  }, [announce]);

  const setRate = useCallback(
    (rate: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = rate;
      announce(`${playerLabels.speed}: ${rate === 1 ? playerLabels.speedNormal : `${f.number(rate)}×`}`);
    },
    [f, announce],
  );

  const selectSubtitle = useCallback(
    (id: string | null) => {
      setSubtitleOverride(id);
      const chosen = subtitles.find((s) => s.id === id);
      writePrefs({ captions: chosen ? chosen.lang : 'off' });
      announce(`${playerLabels.subtitles}: ${chosen?.label ?? playerLabels.subtitlesOff}`);
    },
    [subtitles, announce],
  );

  const toggleCaptions = useCallback(() => {
    if (subtitles.length === 0) return;
    if (activeSubtitleId) selectSubtitle(null);
    else selectSubtitle(pickCaptionsToEnable(subtitles, boot?.prefs.captions));
  }, [subtitles, activeSubtitleId, boot, selectSubtitle]);

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!root || !video) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.requestFullscreen) await root.requestFullscreen();
      else video.webkitEnterFullscreen?.(); // iPhone Safari: only the video element can go fullscreen
    } catch {
      /* the browser refused (e.g. not triggered by a gesture) */
    }
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* unsupported / blocked */
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    // On phones lock to landscape while fullscreen (best effort: not every browser allows it).
    const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    if (!orientation?.lock || !window.matchMedia('(pointer: coarse)').matches) return;
    if (fullscreen) orientation.lock('landscape').catch(() => undefined);
    else orientation.unlock?.();
  }, [fullscreen]);

  // ---- subtitles: tracks are loaded by the browser, drawn by us ----------------------------------------------
  useEffect(() => {
    for (const s of subtitles) {
      const textTrack = trackEls.current.get(s.id)?.track;
      if (textTrack) textTrack.mode = s.id === activeSubtitleId ? 'hidden' : 'disabled';
    }
  }, [subtitles, activeSubtitleId]);
  useEffect(() => {
    const textTrack = activeSubtitleId ? trackEls.current.get(activeSubtitleId)?.track : null;
    if (!textTrack) return;
    const update = () => setCueText(Array.from(textTrack.activeCues ?? []).map((cue) => stripCueMarkup((cue as VTTCue).text)).join('\n'));
    textTrack.addEventListener('cuechange', update);
    return () => {
      textTrack.removeEventListener('cuechange', update);
      setCueText('');
    };
  }, [activeSubtitleId, subtitles]);
  useEffect(() => {
    // iPhone's native fullscreen player ignores our overlay, so let it draw the cues there.
    const video = videoRef.current;
    if (!video) return;
    const setMode = (mode: TextTrackMode) => {
      const textTrack = activeSubtitleId ? trackEls.current.get(activeSubtitleId)?.track : null;
      if (textTrack) textTrack.mode = mode;
    };
    const begin = () => setMode('showing');
    const end = () => setMode('hidden');
    video.addEventListener('webkitbeginfullscreen', begin);
    video.addEventListener('webkitendfullscreen', end);
    return () => {
      video.removeEventListener('webkitbeginfullscreen', begin);
      video.removeEventListener('webkitendfullscreen', end);
    };
  }, [activeSubtitleId]);

  // ---- keyboard shortcuts ----------------------------------------------------------------------------------------
  const perform = useCallback(
    (action: PlayerAction) => {
      const video = videoRef.current;
      if (!video) return;
      switch (action.type) {
        case 'toggle-play':
          togglePlay();
          break;
        case 'fullscreen':
          void toggleFullscreen();
          break;
        case 'mute':
          toggleMute();
          break;
        case 'captions':
          toggleCaptions();
          break;
        case 'help':
          setHelpOpen(true);
          break;
        case 'escape':
          if (helpOpen) setHelpOpen(false);
          else if (menuOpen) setMenuOpen(false);
          break;
        case 'volume':
          applyVolume((video.muted ? 0 : video.volume) + action.delta);
          announce(`${playerLabels.volume}: ${f.number(Math.round(clamp01((video.muted ? 0 : video.volume)) * 100))}٪`);
          break;
        case 'seek-by':
          seekTo(video.currentTime + action.seconds);
          if (Math.abs(action.seconds) >= SEEK_JUMP_SECONDS) showRipple(action.seconds > 0 ? 'end' : 'start', action.seconds > 0); // forward is the END side in both directions
          break;
        case 'seek-percent':
          seekTo((action.percent / 100) * (Number.isFinite(video.duration) ? video.duration : (durationSeconds ?? 0)));
          break;
        case 'seek-start':
          seekTo(0);
          break;
        case 'seek-end':
          seekTo(Number.isFinite(video.duration) ? video.duration : (durationSeconds ?? 0));
          break;
        case 'speed':
          setRate(stepSpeed(video.playbackRate, action.direction));
          break;
      }
    },
    [togglePlay, toggleFullscreen, toggleMute, toggleCaptions, applyVolume, announce, f, seekTo, showRipple, setRate, durationSeconds, helpOpen, menuOpen],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      const root = rootRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      const inside = !!target && root.contains(target);
      const onPageBody = target === document.body || target === document.documentElement;
      if (!inside && !onPageBody) return; // focus is on something else on the page (a button, the comment box, …)

      if (!inside) {
        // Page-level use (nothing focused): only while the player is on screen and no dialog of the page is open.
        const rect = root.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      }

      const action = mapShortcut(e, dir);
      if (!action) return;
      // Space belongs to the focused button / menu item / link (it activates it); the player only takes it from neutral surfaces.
      if (e.code === 'Space' && isActivationTarget(e.target)) return;

      e.preventDefault();
      if (e.repeat && ['toggle-play', 'fullscreen', 'mute', 'captions', 'help', 'speed'].includes(action.type)) return;
      perform(action);
      showControls();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dir, perform, showControls]);

  // ---- pointer gestures on the picture ---------------------------------------------------------------------------
  const lastPointer = useRef<string>('mouse');
  const lastTap = useRef<{ time: number; x: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tapTimer.current), []);

  function onSurfaceClick() {
    if (lastPointer.current !== 'mouse') return; // touch taps are handled in onPointerUp
    setMenuOpen(false);
    togglePlay();
    rootRef.current?.focus({ preventScroll: true });
  }

  function onSurfaceDoubleClick() {
    if (lastPointer.current === 'mouse') void toggleFullscreen();
  }

  function onSurfacePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    lastPointer.current = e.pointerType;
    if (e.pointerType === 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const previous = lastTap.current;
    if (previous && e.timeStamp - previous.time < DOUBLE_TAP_MS && Math.abs(x - previous.x) < 70) {
      // double tap: the left third goes FORWARD, the right third BACKWARD (the visual direction of the RTL seek bar)
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      const third = (x - rect.left) / rect.width;
      const video = videoRef.current;
      if (!video) return;
      if (third < 1 / 3 || third > 2 / 3) {
        const forward = (third < 1 / 3) === (dir === 'rtl');
        seekTo(video.currentTime + (forward ? SEEK_JUMP_SECONDS : -SEEK_JUMP_SECONDS));
        showRipple(forward ? 'end' : 'start', forward);
      } else {
        togglePlay();
      }
      return;
    }
    lastTap.current = { time: e.timeStamp, x };
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      setMenuOpen(false);
      // single tap: show or hide the controls
      setControlsShown((shown) => {
        if (shown && !live.current.paused) return false;
        return true;
      });
      scheduleHide(HIDE_AFTER_MS);
    }, DOUBLE_TAP_MS);
  }

  // ---- render ----------------------------------------------------------------------------------------------------
  const failed = hls.status === 'error' || hls.status === 'unsupported';
  const controlsVisible = controlsShown || pb.paused || menuOpen || helpOpen || failed;
  const showBigPlay = !failed && (pb.ended || (!pb.started && pb.paused));
  const showSpinner = !failed && ((hls.status === 'loading' && wantsPlay) || pb.buffering);
  const PlayIcon = pb.paused || pb.ended ? Play : Pause;
  const playLabel = pb.ended ? playerLabels.replay : pb.paused ? playerLabels.play : playerLabels.pause;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-roledescription="پخش‌کننده"
      aria-label={`${playerLabels.region}: ${title}`}
      tabIndex={0}
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') showControls();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') scheduleHide(700);
      }}
      data-player-state={hls.status}
      data-engine={hls.engine ?? undefined}
      data-playing={!pb.paused && !pb.ended}
      data-quality={hls.quality}
      data-active-height={hls.activeHeight ?? undefined}
      data-captions={activeSubtitleId ?? 'off'}
      data-fullscreen={fullscreen}
      className={cn(
        'relative aspect-video w-full overflow-hidden bg-black text-white outline-none select-none sm:rounded-xl',
        'focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:ring-inset',
        '[&:fullscreen]:aspect-auto [&:fullscreen]:h-full [&:fullscreen]:rounded-none',
        !controlsVisible && !pb.paused && 'cursor-none',
        className,
      )}
    >
      <video ref={videoRef} playsInline preload="metadata" poster={poster ?? undefined} className="absolute inset-0 size-full bg-black object-contain">
        {subtitles.map((s) => (
          <track
            key={s.id}
            ref={(el) => {
              if (el) trackEls.current.set(s.id, el);
              else trackEls.current.delete(s.id);
            }}
            kind="subtitles"
            src={s.src}
            srcLang={s.lang}
            label={s.label}
          />
        ))}
      </video>

      {/* Click / tap surface (keyboard users have the buttons and shortcuts). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1]"
        onPointerDown={(e) => (lastPointer.current = e.pointerType)}
        onClick={onSurfaceClick}
        onDoubleClick={onSurfaceDoubleClick}
        onPointerUp={onSurfacePointerUp}
      />

      <CaptionsOverlay text={activeSubtitleId ? cueText : ''} raised={controlsVisible} />
      <SeekRipple ripple={ripple} />
      <BufferingSpinner visible={showSpinner} />
      {showBigPlay && <BigPlayButton onClick={play} replay={pb.ended} />}
      {failed && <ErrorOverlay message={hls.error?.message ?? ''} retryable={hls.error?.retryable ?? false} onRetry={hls.retry} />}

      {!failed && (
        <div
          onFocusCapture={showControls}
          className={cn(
            'absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pt-14 pb-1 transition-opacity duration-200 sm:px-3',
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <SeekBar currentTime={pb.currentTime} duration={pb.duration} buffered={pb.buffered} onSeek={seekTo} disabled={hls.status !== 'ready'} />
          <div role="group" aria-label={playerLabels.controls} className="flex items-center gap-0.5">
            <button type="button" onClick={togglePlay} aria-label={playLabel} title={playLabel} className={controlButton}>
              <PlayIcon className="size-5 fill-current" />
            </button>
            <VolumeControl volume={pb.volume} muted={pb.muted} onVolumeChange={applyVolume} onToggleMute={toggleMute} buttonClassName={controlButton} />
            <span className="px-2 text-xs whitespace-nowrap tabular-nums sm:text-sm">
              <bdi>{f.duration(pb.currentTime)}</bdi>
              <span aria-hidden="true"> / </span>
              <bdi>{f.duration(pb.duration)}</bdi>
            </span>

            <span className="flex-1" />

            {subtitles.length > 0 && (
              <button
                type="button"
                onClick={toggleCaptions}
                aria-pressed={activeSubtitleId !== null}
                aria-label={activeSubtitleId ? playerLabels.captionsOn : playerLabels.captionsOff}
                title={playerLabels.captions}
                className={cn(controlButton, activeSubtitleId && 'text-[oklch(0.8_0.14_293)]')}
              >
                <Captions className="size-5" />
              </button>
            )}
            <button
              ref={settingsRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={playerLabels.settings}
              title={playerLabels.settings}
              className={controlButton}
            >
              <Settings className={cn('size-5 transition-transform duration-200', menuOpen && 'rotate-45')} />
            </button>
            <button type="button" onClick={() => setHelpOpen(true)} aria-label={playerLabels.shortcuts} title={playerLabels.shortcuts} className={cn(controlButton, 'hidden lg:inline-flex')}>
              <Keyboard className="size-5" />
            </button>
            {pipSupported && (
              <button
                type="button"
                onClick={() => void togglePip()}
                aria-pressed={pb.pip}
                aria-label={pb.pip ? playerLabels.exitPip : playerLabels.pip}
                title={playerLabels.pip}
                className={cn(controlButton, 'hidden sm:inline-flex')}
              >
                <PictureInPicture2 className="size-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? playerLabels.exitFullscreen : playerLabels.fullscreen}
              title={fullscreen ? playerLabels.exitFullscreen : playerLabels.fullscreen}
              className={controlButton}
            >
              {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
            </button>
          </div>
        </div>
      )}

      <PlayerMenu
        open={menuOpen && !failed}
        onClose={(restoreFocus) => {
          setMenuOpen(false);
          if (restoreFocus) settingsRef.current?.focus();
        }}
        triggerRef={settingsRef}
        rate={pb.rate}
        onRate={setRate}
        qualities={hls.qualities}
        quality={hls.quality}
        activeHeight={hls.activeHeight}
        onQuality={hls.setQuality}
        subtitles={subtitles}
        activeSubtitleId={activeSubtitleId}
        onSubtitle={selectSubtitle}
        onShowShortcuts={() => setHelpOpen(true)}
      />
      <ShortcutsHelp
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
          rootRef.current?.focus();
        }}
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
