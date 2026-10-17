/**
 * Human label for a stored session `User-Agent` ("Chrome روی ویندوز"). Pure and tiny on purpose: only the browser
 * family and OS are extracted (no version, no fingerprinting). Order matters — most specific token first, because
 * Chromium-based browsers all say "Chrome/" and every mobile OS says something that contains another OS name.
 */
import { detectDevice, type DeviceKind } from '@/lib/request';

export type ParsedUserAgent = { browser: string | null; os: string | null; kind: DeviceKind };

const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|(?:Headless)?Chrome\/|\bChromium\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/\bWindows\b/, 'ویندوز'],
  [/\bAndroid\b/, 'اندروید'],
  [/\biPhone\b|\biPod\b/, 'آیفون'],
  [/\biPad\b/, 'آیپد'],
  [/\bCrOS\b/, 'Chrome OS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'مک'],
  [/\bLinux\b|\bX11\b/, 'لینوکس'],
];

export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  const ua = userAgent ?? '';
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  return { browser, os, kind: detectDevice(ua) };
}

/** "Chrome روی ویندوز" · "Safari روی آیفون" · "دستگاه ناشناس" */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const { browser, os } = parseUserAgent(userAgent);
  if (browser && os) return `${browser} روی ${os}`;
  return browser ?? os ?? 'دستگاه ناشناس';
}
