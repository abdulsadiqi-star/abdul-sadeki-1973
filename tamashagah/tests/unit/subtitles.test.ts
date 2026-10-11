import { describe, expect, it } from 'vitest';
import {
  MAX_SUBTITLE_BYTES,
  SubtitleError,
  countCues,
  decodeSubtitle,
  normalizeVtt,
  prepareSubtitle,
  srtToVtt,
} from '@/features/videos-studio/subtitles';

const enc = (s: string) => new TextEncoder().encode(s);

describe('SRT → WebVTT', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,500
سلام دنیا

2
00:00:04,000 --> 00:00:06,250
<i>خط اول</i>
خط دوم
`;

  it('converts timestamps, drops cue numbers and keeps the text', () => {
    expect(srtToVtt(srt)).toBe(`WEBVTT

00:00:01.000 --> 00:00:03.500
سلام دنیا

00:00:04.000 --> 00:00:06.250
<i>خط اول</i>
خط دوم
`);
  });

  it('handles CRLF line endings, a BOM and missing cue numbers', () => {
    const windows = '﻿00:00:01,000 --> 00:00:02,000\r\nیک\r\n\r\n00:00:03,000 --> 00:00:04,000\r\nدو\r\n';
    const vtt = srtToVtt(windows);
    expect(countCues(vtt)).toBe(2);
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000\nیک');
    expect(vtt).not.toContain('\r');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('accepts missing hours, a dot as millisecond separator and short millisecond values', () => {
    const vtt = srtToVtt('01:02,5 --> 01:04.250\nhello\n');
    expect(vtt).toContain('00:01:02.500 --> 00:01:04.250\nhello');
  });

  it('converts Persian digits in timestamps and cue numbers', () => {
    const vtt = srtToVtt('۱\n۰۰:۰۰:۰۱,۰۰۰ --> ۰۰:۰۰:۰۲,۰۰۰\nسلام\n');
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000\nسلام');
  });

  it('strips styling that WebVTT cannot express and neutralizes dangerous text', () => {
    const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<font color="#ff0000">قرمز</font> a < b & c --> d\n');
    expect(vtt).toContain('قرمز a &lt; b & c -- > d');
    expect(vtt).not.toContain('<font');
    expect(vtt).not.toContain('{\\an8}');
    expect(countCues(vtt)).toBe(1); // "-->" inside the text must not create a phantom cue
  });

  it('keeps the allowed inline tags', () => {
    expect(srtToVtt('00:00:01,000 --> 00:00:02,000\n<b>bold</b> <u>u</u> <i>i</i>\n')).toContain('<b>bold</b> <u>u</u> <i>i</i>');
  });

  it('drops blocks without a valid timing line or without text', () => {
    const vtt = srtToVtt('garbage\n\n00:00:01,000 --> 00:00:02,000\n\n\n00:00:03,000 --> 00:00:04,000\nok\n');
    expect(countCues(vtt)).toBe(1);
    expect(vtt).toContain('ok');
  });

  it('empty input yields a header only', () => {
    expect(srtToVtt('')).toBe('WEBVTT\n\n\n');
    expect(countCues(srtToVtt('nothing here'))).toBe(0);
  });
});

describe('WebVTT normalization', () => {
  it('removes the BOM and CRLF, converts Persian digits only on timing lines', () => {
    const vtt = normalizeVtt('﻿WEBVTT\r\n\r\n۰۰:۰۰:۰۱.۰۰۰ --> ۰۰:۰۰:۰۲.۰۰۰\r\nسال ۱۴۰۵\r\n');
    expect(vtt).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nسال ۱۴۰۵\n');
  });
});

describe('decoding', () => {
  it('reads UTF-8 (with or without BOM)', () => {
    expect(decodeSubtitle(enc('﻿سلام'))).toBe('سلام');
    expect(decodeSubtitle(enc('سلام'))).toBe('سلام');
  });

  it('falls back to Windows-1256 for legacy Persian files', () => {
    // "سلام" in Windows-1256: 0xD3 0xE1 0xC7 0xE3
    expect(decodeSubtitle(new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3]))).toBe('سلام');
  });

  it('refuses binary data', () => {
    expect(() => decodeSubtitle(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toThrow(SubtitleError);
  });
});

describe('prepareSubtitle', () => {
  it('converts SRT and reports the cue count', () => {
    const result = prepareSubtitle(enc('1\n00:00:01,000 --> 00:00:02,000\nسلام\n\n2\n00:00:03,000 --> 00:00:04,000\nخداحافظ\n'));
    expect(result).toMatchObject({ cues: 2, source: 'srt' });
    expect(result.vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('passes WebVTT through', () => {
    expect(prepareSubtitle(enc('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n'))).toMatchObject({ cues: 1, source: 'vtt' });
  });

  it('rejects empty files, files without cues and oversized files with Persian messages', () => {
    for (const bytes of [new Uint8Array(), enc('این فقط یک متن است'), new Uint8Array(MAX_SUBTITLE_BYTES + 1).fill(65)]) {
      try {
        prepareSubtitle(bytes);
        throw new Error('should have been rejected');
      } catch (e) {
        expect(e).toBeInstanceOf(SubtitleError);
        expect((e as Error).message).toMatch(/[؀-ۿ]/);
      }
    }
  });
});
