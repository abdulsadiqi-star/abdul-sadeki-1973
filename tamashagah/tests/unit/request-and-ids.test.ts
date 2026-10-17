import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { isTrustedRequest } from '@/lib/origin';
import { detectDevice, getClientIp, referrerHost, safeRedirectPath } from '@/lib/request';
import { VIDEO_ID_REGEX, isVideoId, newVideoId, randomToken, safeEqual, sha256Hex, hmacHex } from '@/lib/ids';
import { assertSafeKey, isPublicMediaKey } from '@/lib/storage/keys';

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUSTED_ORIGINS;
  resetEnvCache();
});

describe('safeRedirectPath', () => {
  it('allows only same-site relative paths', () => {
    expect(safeRedirectPath('/studio/videos?x=1')).toBe('/studio/videos?x=1');
    expect(safeRedirectPath('//evil.com')).toBe('/');
    expect(safeRedirectPath('https://evil.com')).toBe('/');
    expect(safeRedirectPath('/\\evil.com')).toBe('/');
    expect(safeRedirectPath('/ok\r\nSet-Cookie: x=y')).toBe('/');
    expect(safeRedirectPath(undefined, '/studio')).toBe('/studio');
  });
});

describe('client IP', () => {
  it('ignores X-Forwarded-For unless proxies are trusted', () => {
    resetEnvCache();
    expect(getClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }))).toBeNull();
  });
  it('takes the address appended by the trusted proxy', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    resetEnvCache();
    expect(getClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }))).toBe('1.2.3.4');
    process.env.TRUSTED_PROXY_HOPS = '2';
    resetEnvCache();
    expect(getClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
  });
});

describe('device and referrer classification', () => {
  it('classifies user agents', () => {
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('MOBILE');
    expect(detectDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('TABLET');
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe('DESKTOP');
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; SM-X900)')).toBe('TABLET');
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile')).toBe('MOBILE');
    expect(detectDevice(null)).toBe('OTHER');
  });
  it('extracts referrer hosts', () => {
    expect(referrerHost('https://www.google.com/search?q=x')).toBe('www.google.com');
    expect(referrerHost('http://localhost:3000/', 'localhost')).toBe('internal');
    expect(referrerHost(null)).toBe('direct');
    expect(referrerHost('not a url')).toBe('direct');
  });
});

describe('origin check (CSRF defence)', () => {
  const req = (method: string, headers: Record<string, string>) =>
    new Request('http://localhost:3000/api/x', { method, headers });

  it('never blocks safe methods', () => {
    expect(isTrustedRequest(req('GET', { origin: 'https://evil.com' }))).toBe(true);
  });
  it('accepts same-origin and APP_URL origins', () => {
    expect(isTrustedRequest(req('POST', { origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true);
    expect(isTrustedRequest(req('POST', { origin: 'http://localhost:3000' }))).toBe(true); // APP_URL
  });
  it('rejects cross-site origins', () => {
    expect(isTrustedRequest(req('POST', { origin: 'https://evil.com', host: 'localhost:3000' }))).toBe(false);
    expect(isTrustedRequest(req('DELETE', { origin: 'null' }))).toBe(false);
  });
  it('falls back to Sec-Fetch-Site when Origin is absent', () => {
    expect(isTrustedRequest(req('POST', { 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isTrustedRequest(req('POST', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isTrustedRequest(req('POST', {}))).toBe(false);
  });
  it('honours TRUSTED_ORIGINS', () => {
    process.env.TRUSTED_ORIGINS = 'https://studio.example.com, https://app.example.com';
    resetEnvCache();
    expect(isTrustedRequest(req('POST', { origin: 'https://app.example.com', host: 'x' }))).toBe(true);
    expect(isTrustedRequest(req('POST', { origin: 'https://other.example.com', host: 'x' }))).toBe(false);
  });
});

describe('ids and secrets', () => {
  it('generates well-formed unique video ids', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newVideoId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(VIDEO_ID_REGEX);
    expect(isVideoId('aB3dE5gH7jK')).toBe(true);
    expect(isVideoId('short')).toBe(false);
    expect(isVideoId('aB3dE5gH7j-')).toBe(false);
  });
  it('creates URL-safe random tokens and stable hashes', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmacHex('k', 'v')).toHaveLength(64);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('storage keys', () => {
  it('rejects traversal and odd keys', () => {
    for (const bad of ['../etc/passwd', 'a/../b', '/abs', 'a//b', '', 'a b', 'a\\b', 'a\0b', 'x'.repeat(600)]) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
    expect(() => assertSafeKey('videos/aB3dE5gH7jK/hls/master.m3u8')).not.toThrow();
  });
  it('only exposes allow-listed media', () => {
    expect(isPublicMediaKey('videos/aB3dE5gH7jK/hls/720p/seg_00001.ts')).toEqual({ videoId: 'aB3dE5gH7jK' });
    expect(isPublicMediaKey('videos/aB3dE5gH7jK/thumbs/poster_x1.jpg')).toEqual({ videoId: 'aB3dE5gH7jK' });
    expect(isPublicMediaKey('videos/aB3dE5gH7jK/subs/fa.vtt')).toEqual({ videoId: 'aB3dE5gH7jK' });
    expect(isPublicMediaKey('images/avatars/u1/abc.webp')).toEqual({ public: true });
    expect(isPublicMediaKey('uploads/aB3dE5gH7jK')).toBeNull();
    expect(isPublicMediaKey('videos/aB3dE5gH7jK/source.mp4')).toBeNull();
    expect(isPublicMediaKey('videos/short/hls/master.m3u8')).toBeNull();
    expect(isPublicMediaKey('images/avatars/u1/abc.svg')).toBeNull();
  });
});

describe('safeRedirectPath hardening', () => {
  it('rejects control characters that URL parsers strip (open-redirect via TAB/LF/CR)', () => {
    for (const evil of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/%09/x\u0000', '/a\u007fb']) {
      expect(safeRedirectPath(evil, '/home')).toBe('/home');
    }
  });
  it('keeps normal in-site paths and normalises them', () => {
    expect(safeRedirectPath('/studio/videos?tab=all#x', '/')).toBe('/studio/videos?tab=all#x');
    expect(safeRedirectPath('//evil.example', '/')).toBe('/');
    expect(safeRedirectPath('https://evil.example', '/')).toBe('/');
  });
});
