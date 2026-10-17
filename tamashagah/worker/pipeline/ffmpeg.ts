/**
 * Thin, typed wrappers around ffprobe / ffmpeg: build argv with `features/transcoding`, run it through `exec.ts`,
 * turn the outcome into a `TranscodeError` with the right retry policy.
 */
import { env } from '@/lib/env';
import {
  buildDurationMeasureArgs,
  buildProbeArgs,
  buildThumbnailArgs,
  buildTranscodeArgs,
  type TranscodeArgsInput,
} from '@/features/transcoding/ffmpeg-args';
import { TranscodeError, isDeterministicDecodeFailure } from '@/features/transcoding/errors';
import type { ThumbnailSpec } from '@/features/transcoding/plan';
import { parseProbe, type SourceInfo } from '@/features/transcoding/probe';
import { FfmpegProgressParser, progressFraction } from '@/features/transcoding/progress';
import { runProcess, type RunResult } from './exec';

/** Why a run was cancelled from outside. `AbortController.abort('shutdown')` → the job is requeued, not failed. */
export type AbortReason = 'shutdown' | 'deleted';

/** The error to throw when a child was killed because the pipeline's signal fired. */
function abortedError(signal?: AbortSignal): TranscodeError {
  return new TranscodeError(signal?.reason === 'shutdown' ? 'INTERRUPTED' : 'CANCELLED');
}

const firstLine = (text: string): string => text.trim().split('\n').find(Boolean)?.slice(0, 200) ?? '';

function classifyFailure(result: RunResult, what: string): TranscodeError {
  if (isDeterministicDecodeFailure(result.stderrTail)) {
    return new TranscodeError('UNREADABLE', `${what}: ${firstLine(result.stderrTail)}`);
  }
  const how = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;
  return new TranscodeError('TRANSCODE_FAILED', `${what} failed (${how}): ${firstLine(result.stderrTail)}`);
}

export async function probeSource(file: string, signal?: AbortSignal): Promise<SourceInfo> {
  const result = await runProcess({
    command: env.FFPROBE_PATH,
    args: buildProbeArgs(file),
    captureStdout: true,
    timeoutMs: 60_000,
    signal,
  });
  if (result.killedBy === 'abort') throw abortedError(signal);
  if (result.killedBy === 'timeout') throw new TranscodeError('UNREADABLE', 'ffprobe timed out');
  let json: unknown = {};
  try {
    json = JSON.parse(result.stdout || '{}');
  } catch {
    throw new TranscodeError('UNREADABLE', 'ffprobe did not print valid JSON');
  }
  const hasStreams = Array.isArray((json as { streams?: unknown }).streams) && (json as { streams: unknown[] }).streams.length > 0;
  if (result.code !== 0 && !hasStreams) {
    throw new TranscodeError('UNREADABLE', `ffprobe: ${firstLine(result.stderrTail)}`);
  }
  return parseProbe(json);
}

/** Duration of containers that do not store it: stream-copy to the null muxer and read the last timestamp. */
export async function measureDuration(file: string, videoStreamIndex: number, signal?: AbortSignal): Promise<number> {
  const parser = new FfmpegProgressParser();
  let last = 0;
  const result = await runProcess({
    command: env.FFMPEG_PATH,
    args: buildDurationMeasureArgs(file, videoStreamIndex),
    signal,
    timeoutMs: 10 * 60_000,
    onStdout: (chunk) => {
      for (const snap of parser.push(chunk)) last = Math.max(last, snap.outTimeSeconds);
    },
  });
  if (result.killedBy === 'abort') throw abortedError(signal);
  if (result.code !== 0) throw classifyFailure(result, 'duration measurement');
  return last;
}

export type TranscodeRun = {
  args: TranscodeArgsInput;
  /** Source duration (seconds), the denominator of the progress fraction. */
  durationSeconds: number;
  signal?: AbortSignal;
  /** Called with 0..1 as ffmpeg reports progress (frequent: throttle in the caller). */
  onProgress: (fraction: number) => void;
};

/** One ffmpeg run that writes every rendition (see `buildTranscodeArgs`). */
export async function runTranscode(run: TranscodeRun): Promise<void> {
  const parser = new FfmpegProgressParser();
  const result = await runProcess({
    command: env.FFMPEG_PATH,
    args: buildTranscodeArgs(run.args),
    signal: run.signal,
    // ffmpeg reports progress at least every 0.5 s while it works: minutes of silence means a hung encoder.
    inactivityMs: 3 * 60_000,
    onStdout: (chunk) => {
      for (const snap of parser.push(chunk)) run.onProgress(progressFraction(snap.outTimeSeconds, run.durationSeconds));
    },
  });
  if (result.killedBy === 'abort') throw abortedError(run.signal);
  if (result.killedBy === 'inactivity') throw new TranscodeError('TRANSCODE_FAILED', 'ffmpeg stopped responding');
  if (result.code !== 0) throw classifyFailure(result, 'transcode');
  run.onProgress(1);
}

export async function extractThumbnail(options: {
  input: string;
  output: string;
  thumb: Pick<ThumbnailSpec, 'atSeconds' | 'width' | 'height'>;
  source: Pick<SourceInfo, 'videoStreamIndex' | 'interlaced' | 'hdr'>;
  hdrToSdr?: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  const result = await runProcess({
    command: env.FFMPEG_PATH,
    args: buildThumbnailArgs(options),
    signal: options.signal,
    timeoutMs: 2 * 60_000,
  });
  if (result.killedBy === 'abort') throw abortedError(options.signal);
  if (result.code !== 0) throw classifyFailure(result, 'thumbnail');
}

let hdrSupport: Promise<boolean> | undefined;

/** HDR → SDR tone mapping needs the `zscale` (libzimg) and `tonemap` filters. Checked once per process. */
export function supportsHdrToneMapping(): Promise<boolean> {
  hdrSupport ??= runProcess({
    command: env.FFMPEG_PATH,
    args: ['-hide_banner', '-filters'],
    captureStdout: true,
    timeoutMs: 15_000,
  })
    .then((r) => /\bzscale\b/.test(r.stdout) && /\btonemap\b/.test(r.stdout))
    .catch(() => false);
  return hdrSupport;
}

/** Fail fast at start-up when the binaries are missing instead of failing every job. */
export async function assertMediaToolsAvailable(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const version = async (command: string) => {
    const result = await runProcess({ command, args: ['-version'], captureStdout: true, timeoutMs: 10_000 });
    if (result.code !== 0) throw new Error(`${command} -version exited with ${result.code}`);
    return firstLine(result.stdout);
  };
  return { ffmpeg: await version(env.FFMPEG_PATH), ffprobe: await version(env.FFPROBE_PATH) };
}
