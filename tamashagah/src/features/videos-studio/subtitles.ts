/**
 * Subtitle files: decoding, SRT → WebVTT conversion and validation. Pure functions (no I/O).
 *
 * Creators upload `.srt` (the common format) or `.vtt`; the player only needs WebVTT, so SRT is converted on the
 * server. Persian subtitles in the wild are often saved as Windows-1256 instead of UTF-8, so decoding falls back to it.
 */
import { toAsciiDigits } from '@/lib/persian';

export const MAX_SUBTITLE_BYTES = 1024 * 1024; // 1 MiB — a feature-length subtitle is ~100 KiB
export const MAX_SUBTITLE_CUES = 20_000;

export class SubtitleError extends Error {}

/** UTF-8 (BOM allowed) first; legacy Persian files fall back to Windows-1256. Binary data is rejected. */
export function decodeSubtitle(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new SubtitleError('این فایل زیرنویس نیست (محتوای باینری).');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('windows-1256').decode(bytes);
    } catch {
      throw new SubtitleError('رمزگذاری فایل زیرنویس پشتیبانی نمی‌شود. آن را با UTF-8 ذخیره کنید.');
    }
  }
}

const TIMING = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.:](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.:](\d{1,3})(.*)$/;

const pad = (n: string, width: number) => n.padStart(width, '0');
/** "5" → "005" milliseconds (SRT writers sometimes drop zeros: "1,5" means 1.500 in practice, but "1,050" is common). */
const millis = (ms: string) => (ms.length === 3 ? ms : ms.padEnd(3, '0'));

function formatTiming(match: RegExpExecArray): string {
  const start = `${pad(match[1] ?? '0', 2)}:${pad(match[2]!, 2)}:${pad(match[3]!, 2)}.${millis(match[4]!)}`;
  const end = `${pad(match[5] ?? '0', 2)}:${pad(match[6]!, 2)}:${pad(match[7]!, 2)}.${millis(match[8]!)}`;
  // Cue settings after the end time (SRT has none; some tools append coordinates) are dropped: they are not WebVTT.
  return `${start} --> ${end}`;
}

/** Cue text → safe WebVTT: ASS/SSA overrides and <font> removed, stray `<` and `-->` neutralized. */
function cleanCueText(line: string): string {
  return line
    .replace(/\{\\[^}]*\}/g, '') // {\an8} {\i1}
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/<(?!\/?(?:i|b|u|c|v|ruby|rt|lang)(?:[\s.>]|$))/gi, '&lt;')
    .replace(/-->/g, '-- >');
}

/**
 * SRT → WebVTT. Tolerant: cue numbers are optional, hours may be missing, `,` or `.` separate the milliseconds,
 * Persian digits in timestamps are converted. Blocks without a valid timing line are skipped.
 */
export function srtToVtt(srt: string): string {
  const text = srt.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const cues: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    let i = 0;
    // optional numeric cue identifier
    if (lines[i] && /^[\d۰-۹٠-٩]+$/.test(lines[i]!.trim()) && lines[i + 1]?.includes('-->')) i++;
    const timingLine = lines[i];
    if (!timingLine) continue;
    const match = TIMING.exec(toAsciiDigits(timingLine).trim());
    if (!match) continue;
    const body = lines
      .slice(i + 1)
      .map(cleanCueText)
      .filter((l, index, all) => l.trim() !== '' || (index > 0 && index < all.length - 1))
      .join('\n')
      .trim();
    if (!body) continue;
    cues.push(`${formatTiming(match)}\n${body}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function countCues(vtt: string): number {
  return vtt.split('\n').filter((l) => l.includes('-->')).length;
}

/** Light normalization of a WebVTT upload: BOM and CRLF removed, Persian digits in timing lines converted. */
export function normalizeVtt(vtt: string): string {
  const lines = vtt
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.includes('-->') ? toAsciiDigits(line) : line));
  return `${lines.join('\n').trim()}\n`;
}

export type PreparedSubtitle = { vtt: string; cues: number; source: 'srt' | 'vtt' };

/** Decode, convert (SRT) or normalize (VTT) and validate an uploaded subtitle file. Throws `SubtitleError`. */
export function prepareSubtitle(bytes: Uint8Array): PreparedSubtitle {
  if (bytes.byteLength === 0) throw new SubtitleError('فایل زیرنویس خالی است.');
  if (bytes.byteLength > MAX_SUBTITLE_BYTES) throw new SubtitleError('حجم فایل زیرنویس نباید بیشتر از ۱ مگابایت باشد.');
  const text = decodeSubtitle(bytes);
  const isVtt = /^\s*WEBVTT/.test(text);
  const vtt = isVtt ? normalizeVtt(text) : srtToVtt(text);
  const cues = countCues(vtt);
  if (cues === 0) throw new SubtitleError('در این فایل هیچ زیرنویس معتبری پیدا نشد. فقط قالب‌های SRT و VTT پذیرفته می‌شود.');
  if (cues > MAX_SUBTITLE_CUES) throw new SubtitleError('تعداد زیرنویس‌های این فایل بیش از حد مجاز است.');
  return { vtt, cues, source: isVtt ? 'vtt' : 'srt' };
}
