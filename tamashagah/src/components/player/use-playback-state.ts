'use client';

import { useEffect, useState, type RefObject } from 'react';
import { rangesOf } from './player-utils';

export type PlaybackState = {
  paused: boolean;
  ended: boolean;
  /** Playback has been started at least once for the current source. */
  started: boolean;
  currentTime: number;
  duration: number;
  buffered: Array<[number, number]>;
  /** Playing (or trying to) but waiting for data. */
  buffering: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  pip: boolean;
};

const INITIAL: PlaybackState = {
  paused: true,
  ended: false,
  started: false,
  currentTime: 0,
  duration: 0,
  buffered: [],
  buffering: false,
  volume: 1,
  muted: false,
  rate: 1,
  pip: false,
};

const EVENTS = [
  'play',
  'pause',
  'playing',
  'waiting',
  'canplay',
  'seeking',
  'seeked',
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'progress',
  'volumechange',
  'ratechange',
  'ended',
  'emptied',
  'enterpictureinpicture',
  'leavepictureinpicture',
] as const;

const same = (a: PlaybackState, b: PlaybackState): boolean =>
  a.paused === b.paused &&
  a.ended === b.ended &&
  a.started === b.started &&
  a.currentTime === b.currentTime &&
  a.duration === b.duration &&
  a.buffering === b.buffering &&
  a.volume === b.volume &&
  a.muted === b.muted &&
  a.rate === b.rate &&
  a.pip === b.pip &&
  a.buffered.length === b.buffered.length &&
  a.buffered.every((r, i) => r[0] === b.buffered[i]![0] && r[1] === b.buffered[i]![1]);

/** Mirrors the <video> element into React state (re-renders only when something actually changed). */
export function usePlaybackState(videoRef: RefObject<HTMLVideoElement | null>, fallbackDuration: number): PlaybackState {
  const [state, setState] = useState<PlaybackState>({ ...INITIAL, duration: fallbackDuration });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let started = false;

    const read = (): PlaybackState => ({
      paused: video.paused,
      ended: video.ended,
      started,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : fallbackDuration,
      buffered: rangesOf(video.buffered),
      buffering: !video.paused && !video.ended && (video.seeking || video.readyState < 3),
      volume: video.volume,
      muted: video.muted,
      rate: video.playbackRate,
      pip: typeof document !== 'undefined' && document.pictureInPictureElement === video,
    });

    const update = (event?: Event) => {
      if (event?.type === 'play' || event?.type === 'playing') started = true;
      if (event?.type === 'emptied') started = false;
      const next = read();
      setState((prev) => (same(prev, next) ? prev : next));
    };

    for (const name of EVENTS) video.addEventListener(name, update);
    return () => {
      for (const name of EVENTS) video.removeEventListener(name, update);
    };
  }, [videoRef, fallbackDuration]);

  return state;
}
