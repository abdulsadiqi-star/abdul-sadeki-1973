import { describe, expect, it } from 'vitest';
import { describeUserAgent, parseUserAgent } from '@/features/settings/user-agent';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  operaWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  safariIpad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('session device labels', () => {
  it.each([
    [UA.chromeWin, 'Chrome روی ویندوز'],
    [UA.edgeWin, 'Edge روی ویندوز'],
    [UA.operaWin, 'Opera روی ویندوز'],
    [UA.firefoxLinux, 'Firefox روی لینوکس'],
    [UA.safariMac, 'Safari روی مک'],
    [UA.safariIphone, 'Safari روی آیفون'],
    [UA.safariIpad, 'Safari روی آیپد'],
    [UA.chromeIos, 'Chrome روی آیفون'],
    [UA.chromeAndroid, 'Chrome روی اندروید'],
    [UA.samsung, 'Samsung Internet روی اندروید'],
    [UA.headless, 'Chrome روی لینوکس'],
    [UA.chromeOs, 'Chrome روی Chrome OS'],
  ])('describes %s', (ua, label) => {
    expect(describeUserAgent(ua)).toBe(label);
  });

  it('falls back gracefully for unknown, empty and missing agents', () => {
    expect(describeUserAgent(null)).toBe('دستگاه ناشناس');
    expect(describeUserAgent(undefined)).toBe('دستگاه ناشناس');
    expect(describeUserAgent('')).toBe('دستگاه ناشناس');
    expect(describeUserAgent('vitest')).toBe('دستگاه ناشناس');
    expect(describeUserAgent('curl/8.5.0')).toBe('دستگاه ناشناس');
    // only one half known
    expect(describeUserAgent('SomeApp/1.0 (Windows NT 10.0)')).toBe('ویندوز');
    expect(describeUserAgent('Firefox/127.0')).toBe('Firefox');
  });

  it('classifies the device kind too', () => {
    expect(parseUserAgent(UA.chromeWin).kind).toBe('DESKTOP');
    expect(parseUserAgent(UA.safariIphone).kind).toBe('MOBILE');
    expect(parseUserAgent(UA.safariIpad).kind).toBe('TABLET');
    expect(parseUserAgent(UA.chromeAndroid).kind).toBe('MOBILE');
    expect(parseUserAgent(null).kind).toBe('OTHER');
  });
});
