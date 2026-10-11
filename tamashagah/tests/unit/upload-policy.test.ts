import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VIDEO_EXTENSIONS,
  checkDeclaredUpload,
  checkQuota,
  extensionOf,
  isAcceptableMime,
  sanitizeFilename,
  titleFromFilename,
} from '@/features/uploads/policy';
import { tusIdForVideo, uploadArtifactKeys, videoIdFromTusId } from '@/features/uploads/keys';

const MB = 1024 * 1024;
const limits = { maxBytes: 100 * MB };

describe('declared upload checks', () => {
  it('accepts every documented container', () => {
    for (const extension of ALLOWED_VIDEO_EXTENSIONS) {
      const result = checkDeclaredUpload({ filename: `clip.${extension}`, filetype: 'video/mp4', size: 1000 }, limits);
      expect(result, extension).toMatchObject({ ok: true, extension });
    }
  });

  it('is case-insensitive about extensions and tolerant about browser MIME types', () => {
    for (const filetype of ['', 'application/octet-stream', 'video/x-matroska', 'video/quicktime', 'VIDEO/MP4']) {
      expect(checkDeclaredUpload({ filename: 'A.MKV', filetype, size: 10 }, limits).ok, filetype).toBe(true);
    }
    expect(checkDeclaredUpload({ filename: 'a.mkv', filetype: undefined, size: 10 }, limits).ok).toBe(true);
  });

  it('derives the stored MIME type from the extension, never from the client', () => {
    expect(checkDeclaredUpload({ filename: 'a.mov', filetype: 'video/x-whatever', size: 10 }, limits)).toMatchObject({ mime: 'video/quicktime' });
  });

  it('rejects unsupported formats, non-video types, empty and oversized files (Persian messages)', () => {
    const cases: [Parameters<typeof checkDeclaredUpload>[0], string][] = [
      [{ filename: 'run.exe', filetype: 'application/octet-stream', size: 10 }, 'VALIDATION'],
      [{ filename: 'noext', filetype: 'video/mp4', size: 10 }, 'VALIDATION'],
      [{ filename: 'a.mp4.exe', filetype: 'video/mp4', size: 10 }, 'VALIDATION'],
      [{ filename: 'a.mp4', filetype: 'image/png', size: 10 }, 'VALIDATION'],
      [{ filename: 'a.mp4', filetype: 'text/html', size: 10 }, 'VALIDATION'],
      [{ filename: '', filetype: 'video/mp4', size: 10 }, 'VALIDATION'],
      [{ filename: 'a.mp4', filetype: 'video/mp4', size: 0 }, 'VALIDATION'],
      [{ filename: 'a.mp4', filetype: 'video/mp4', size: Number.NaN }, 'VALIDATION'],
      [{ filename: 'a.mp4', filetype: 'video/mp4', size: undefined }, 'VALIDATION'],
      [{ filename: 'a.mp4', filetype: 'video/mp4', size: 100 * MB + 1 }, 'QUOTA_EXCEEDED'],
    ];
    for (const [input, code] of cases) {
      const result = checkDeclaredUpload(input, limits);
      expect(result.ok, JSON.stringify(input)).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(code);
        expect(result.message).toMatch(/[\u0600-\u06FF]/);
      }
    }
  });

  it('allows exactly the maximum size', () => {
    expect(checkDeclaredUpload({ filename: 'a.mp4', filetype: 'video/mp4', size: 100 * MB }, limits).ok).toBe(true);
  });
});

describe('file names', () => {
  it('extracts extensions', () => {
    expect(extensionOf('a.MP4')).toBe('mp4');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('noext')).toBeNull();
    expect(extensionOf('trailing.')).toBeNull();
  });

  it('sanitizes paths and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd\u0000/clip.mkv')).toBe('clip.mkv');
    expect(sanitizeFilename('C:\\Users\\me\\فیلم.mp4')).toBe('فیلم.mp4');
    expect(sanitizeFilename('x'.repeat(500) + '.mp4').length).toBeLessThanOrEqual(200);
  });

  it('turns a file name into a title', () => {
    expect(titleFromFilename('سفر_به_شمال.mp4')).toBe('سفر به شمال');
    expect(titleFromFilename('my.holiday.video_2026.MOV')).toBe('my holiday video 2026');
    expect(titleFromFilename('.mp4')).toBe('ویدیوی بدون عنوان');
    expect([...titleFromFilename('ا'.repeat(300) + '.mp4')].length).toBeLessThanOrEqual(100);
  });
});

describe('MIME acceptance', () => {
  it('video/*, generic and empty types pass; everything else does not', () => {
    for (const ok of ['video/mp4', 'video/whatever', '', 'application/octet-stream', 'application/ogg', undefined, null]) expect(isAcceptableMime(ok), String(ok)).toBe(true);
    for (const bad of ['image/png', 'text/plain', 'application/pdf', 'audio/mpeg', 'application/zip']) expect(isAcceptableMime(bad), bad).toBe(false);
  });
});

describe('daily quota', () => {
  const quota = { maxPerDay: 3, dailyQuotaBytes: 10 * MB };

  it('counts uploads and bytes of the last 24 hours', () => {
    expect(checkQuota({ count: 2, bytes: 5 * MB }, 5 * MB, quota)).toEqual({ ok: true });
    const byCount = checkQuota({ count: 3, bytes: 0 }, 1, quota);
    expect(byCount).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
    const byBytes = checkQuota({ count: 1, bytes: 6 * MB }, 5 * MB, quota);
    expect(byBytes).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
    if (!byCount.ok && !byBytes.ok) {
      expect(byCount.message).toMatch(/[\u0600-\u06FF]/);
      expect(byBytes.message).toContain('باقی مانده');
    }
  });
});

describe('upload id mapping', () => {
  it('maps uploads/<videoId> both ways and refuses everything else', () => {
    expect(tusIdForVideo('aB3dE5gH7jK')).toBe('uploads/aB3dE5gH7jK');
    expect(videoIdFromTusId('uploads/aB3dE5gH7jK')).toBe('aB3dE5gH7jK');
    for (const bad of ['aB3dE5gH7jK', 'uploads/short', 'uploads/aB3dE5gH7jK/extra', 'uploads/../etc', 'videos/aB3dE5gH7jK', 'uploads/aB3dE5gH7j!']) {
      expect(videoIdFromTusId(bad), bad).toBeNull();
    }
  });

  it('lists every object an unfinished upload can leave behind', () => {
    expect(uploadArtifactKeys('aB3dE5gH7jK')).toEqual(['uploads/aB3dE5gH7jK', 'uploads/aB3dE5gH7jK.info', 'uploads/aB3dE5gH7jK.part', 'uploads/aB3dE5gH7jK.json']);
  });
});
