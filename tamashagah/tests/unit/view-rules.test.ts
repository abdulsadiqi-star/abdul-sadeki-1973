import { describe, expect, it } from 'vitest';
import {
  COMPLETED_FRACTION,
  FIRST_REPORT_MAX_SECONDS,
  HEARTBEAT_MAX_SECONDS,
  VIEW_DEDUPE_WINDOW_MS,
  clampFirstReportSeconds,
  clampHeartbeatSeconds,
  clampPosition,
  hasPlayedEnough,
  hasReachedViewThreshold,
  isCompleted,
  isLikelyBot,
  isWithinDedupeWindow,
  resumePositionFor,
  viewThresholdSeconds,
} from '@/features/watch/view-rules';

describe('view threshold', () => {
  it('is 5 seconds for normal videos', () => {
    expect(viewThresholdSeconds(120)).toBe(5);
    expect(viewThresholdSeconds(20)).toBe(5);
    expect(viewThresholdSeconds(3600)).toBe(5);
  });

  it('is 25 % of the length for videos shorter than 20 seconds', () => {
    expect(viewThresholdSeconds(19)).toBe(4.75);
    expect(viewThresholdSeconds(10)).toBe(2.5);
    expect(viewThresholdSeconds(8)).toBe(2);
  });

  it('never drops below one second and ignores unknown durations', () => {
    expect(viewThresholdSeconds(2)).toBe(1);
    expect(viewThresholdSeconds(0.5)).toBe(1);
    expect(viewThresholdSeconds(null)).toBe(5);
    expect(viewThresholdSeconds(undefined)).toBe(5);
    expect(viewThresholdSeconds(Number.NaN)).toBe(5);
    expect(viewThresholdSeconds(-3)).toBe(5);
  });

  it('is checked exactly on the client and with a small tolerance on the server', () => {
    expect(hasPlayedEnough(4.9, 120)).toBe(false);
    expect(hasPlayedEnough(5, 120)).toBe(true);
    expect(hasReachedViewThreshold(4.6, 120)).toBe(true); // 0.5 s tolerance
    expect(hasReachedViewThreshold(4.4, 120)).toBe(false);
    expect(hasReachedViewThreshold(0, 120)).toBe(false);
    expect(hasReachedViewThreshold(Number.NaN, 120)).toBe(false);
    expect(hasReachedViewThreshold(2.5, 10)).toBe(true);
  });
});

describe('de-duplication window', () => {
  const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
  it('covers views inside 30 minutes and releases at exactly 30', () => {
    expect(isWithinDedupeWindow(t0, t0 + 1)).toBe(true);
    expect(isWithinDedupeWindow(t0, t0 + VIEW_DEDUPE_WINDOW_MS - 1)).toBe(true);
    expect(isWithinDedupeWindow(t0, t0 + VIEW_DEDUPE_WINDOW_MS)).toBe(false);
    expect(isWithinDedupeWindow(t0, t0 + 2 * VIEW_DEDUPE_WINDOW_MS)).toBe(false);
  });
  it('accepts Date objects and never treats the future as covered', () => {
    expect(isWithinDedupeWindow(new Date(t0), new Date(t0 + 60_000))).toBe(true);
    expect(isWithinDedupeWindow(t0 + 5_000, t0)).toBe(false);
  });
});

describe('first report', () => {
  it('cannot claim more than 30 seconds or more than the video length', () => {
    expect(clampFirstReportSeconds(6, 120)).toBe(6);
    expect(clampFirstReportSeconds(500, 120)).toBe(FIRST_REPORT_MAX_SECONDS);
    expect(clampFirstReportSeconds(500, 10)).toBe(10);
    expect(clampFirstReportSeconds(-5, 120)).toBe(0);
    expect(clampFirstReportSeconds(Number.POSITIVE_INFINITY, 120)).toBe(0);
  });
});

describe('heartbeat clamp', () => {
  it('lets an honest 15 second beat through (with the 1 s jitter slack)', () => {
    expect(clampHeartbeatSeconds({ reportedSeconds: 15, elapsedMs: 15_000 })).toBe(15);
    expect(clampHeartbeatSeconds({ reportedSeconds: 15, elapsedMs: 14_200 })).toBe(15);
  });

  it('never adds more than the wall-clock time that really elapsed', () => {
    expect(clampHeartbeatSeconds({ reportedSeconds: 20, elapsedMs: 3_000 })).toBe(3);
    expect(clampHeartbeatSeconds({ reportedSeconds: 20, elapsedMs: 500 })).toBe(0.5);
    expect(clampHeartbeatSeconds({ reportedSeconds: 20, elapsedMs: 0 })).toBe(0);
    expect(clampHeartbeatSeconds({ reportedSeconds: 20, elapsedMs: -9_000 })).toBe(0);
  });

  it('caps one beat at 20 seconds however long the gap was', () => {
    expect(clampHeartbeatSeconds({ reportedSeconds: 600, elapsedMs: 3_600_000 })).toBe(HEARTBEAT_MAX_SECONDS);
    expect(clampHeartbeatSeconds({ reportedSeconds: 25, elapsedMs: 60_000 })).toBe(HEARTBEAT_MAX_SECONDS);
  });

  it('rejects garbage', () => {
    expect(clampHeartbeatSeconds({ reportedSeconds: -5, elapsedMs: 10_000 })).toBe(0);
    expect(clampHeartbeatSeconds({ reportedSeconds: Number.NaN, elapsedMs: 10_000 })).toBe(0);
    expect(clampHeartbeatSeconds({ reportedSeconds: 10, elapsedMs: Number.NaN })).toBe(0);
    expect(clampHeartbeatSeconds({ reportedSeconds: 0, elapsedMs: 10_000 })).toBe(0);
  });

  it('makes a flood of beats share real time: ten beats in one second add one second in total', () => {
    // The service moves `lastBeatAt` forward on every beat, so each beat only sees the gap since the previous one.
    let total = 0;
    for (let i = 0; i < 10; i++) total += clampHeartbeatSeconds({ reportedSeconds: 20, elapsedMs: 100 });
    expect(total).toBeCloseTo(1, 5);
  });

  it('only grants the jitter slack to beats that are at least 5 seconds apart', () => {
    expect(clampHeartbeatSeconds({ reportedSeconds: 20, elapsedMs: 4_900 })).toBe(4.9);
    expect(clampHeartbeatSeconds({ reportedSeconds: 20, elapsedMs: 5_000 })).toBe(6);
  });
});

describe('position, completion and resume', () => {
  it('clamps positions to the video', () => {
    expect(clampPosition(42.123, 120)).toBe(42.12);
    expect(clampPosition(999, 120)).toBe(120);
    expect(clampPosition(-3, 120)).toBe(0);
    expect(clampPosition(Number.NaN, 120)).toBe(0);
    expect(clampPosition(999, null)).toBe(999);
  });

  it('marks a video completed from 90 %', () => {
    expect(COMPLETED_FRACTION).toBe(0.9);
    expect(isCompleted(89, 100)).toBe(false);
    expect(isCompleted(90, 100)).toBe(true);
    expect(isCompleted(100, 100)).toBe(true);
    expect(isCompleted(50, null)).toBe(false);
    expect(isCompleted(50, 0)).toBe(false);
  });

  it('resumes where you stopped, but restarts finished videos and ignores the first seconds', () => {
    expect(resumePositionFor(62, 600)).toBe(62);
    expect(resumePositionFor(3, 600)).toBe(0);
    expect(resumePositionFor(null, 600)).toBe(0);
    expect(resumePositionFor(580, 600)).toBe(0); // ≥ 95 %
    expect(resumePositionFor(593, 600)).toBe(0); // inside the last 8 seconds
    expect(resumePositionFor(560, 600)).toBe(560); // 93 %: still worth resuming
    expect(resumePositionFor(75, null)).toBe(75);
  });
});

describe('bot detection', () => {
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const headless = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  it('lets real browsers through (headless test browsers included)', () => {
    expect(isLikelyBot(chrome)).toBe(false);
    expect(isLikelyBot(headless)).toBe(false);
    expect(isLikelyBot(iphone)).toBe(false);
  });

  it('flags declared crawlers, previewers and scripted clients', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'facebookexternalhit/1.1',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; YandexBot/3.0)',
      'curl/8.5.0',
      'Wget/1.21.4',
      'python-requests/2.31.0',
      'Go-http-client/2.0',
      'Pingdom.com_bot_version_1.4',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
    ]) {
      expect(isLikelyBot(ua), ua).toBe(true);
    }
  });

  it('treats a missing or tiny user agent as a bot', () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot(undefined)).toBe(true);
    expect(isLikelyBot('')).toBe(true);
    expect(isLikelyBot('x')).toBe(true);
  });
});
