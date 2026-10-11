/**
 * Child-process runner for ffmpeg / ffprobe.
 *
 *  - never goes through a shell (argv only)
 *  - every child is tracked, so a shutdown or a stall can kill whatever is still running
 *  - aborting (AbortSignal), an overall timeout and an inactivity watchdog all end in SIGTERM → SIGKILL
 *  - stdout can be streamed to a callback (ffmpeg `-progress pipe:1`) and/or captured (ffprobe JSON)
 */
import { spawn, type ChildProcess } from 'node:child_process';

const children = new Set<ChildProcess>();

/** SIGKILL (or `signal`) every ffmpeg/ffprobe still running. Used when the worker shuts down. */
export function killAllChildren(signal: NodeJS.Signals = 'SIGKILL'): number {
  let count = 0;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      count++;
    }
  }
  return count;
}

export const runningChildCount = (): number => children.size;

export type RunOptions = {
  command: string;
  args: readonly string[];
  signal?: AbortSignal;
  /** Overall limit in ms. */
  timeoutMs?: number;
  /** Kill when neither stdout nor stderr produced anything for this long (ms) — a hung encoder. */
  inactivityMs?: number;
  /** Receives stdout text as it arrives. */
  onStdout?: (chunk: string) => void;
  /** Keep (a capped copy of) stdout in the result. */
  captureStdout?: boolean;
  /** SIGTERM → SIGKILL escalation delay (ms). */
  killGraceMs?: number;
};

export type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  /** The last few KiB of stderr, for classification and logs (never shown to users). */
  stderrTail: string;
  killedBy: 'abort' | 'timeout' | 'inactivity' | null;
};

const STDERR_TAIL_BYTES = 8 * 1024;
const STDOUT_CAPTURE_BYTES = 16 * 1024 * 1024;

export function runProcess(options: RunOptions): Promise<RunResult> {
  const { command, args, signal, timeoutMs, inactivityMs, killGraceMs = 3_000 } = options;

  return new Promise<RunResult>((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ code: null, signal: null, stdout: '', stderrTail: '', killedBy: 'abort' });
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    children.add(child);

    let stdout = '';
    let stderrTail = '';
    let killedBy: RunResult['killedBy'] = null;
    let killTimer: NodeJS.Timeout | undefined;
    let overallTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;

    const terminate = (reason: NonNullable<RunResult['killedBy']>) => {
      if (killedBy) return;
      killedBy = reason;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
      killTimer.unref();
    };

    const resetIdle = () => {
      if (!inactivityMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => terminate('inactivity'), inactivityMs);
      idleTimer.unref();
    };

    const onAbort = () => terminate('abort');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs) {
      overallTimer = setTimeout(() => terminate('timeout'), timeoutMs);
      overallTimer.unref();
    }
    resetIdle();

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      resetIdle();
      options.onStdout?.(chunk);
      if (options.captureStdout && stdout.length < STDOUT_CAPTURE_BYTES) stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      resetIdle();
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    const cleanup = () => {
      children.delete(child);
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      if (overallTimer) clearTimeout(overallTimer);
      if (idleTimer) clearTimeout(idleTimer);
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code, closeSignal) => {
      cleanup();
      resolve({ code, signal: closeSignal, stdout, stderrTail, killedBy });
    });
  });
}
