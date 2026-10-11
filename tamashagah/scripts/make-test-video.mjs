#!/usr/bin/env node
/**
 * Test / demo media generator. Everything is synthesized by ffmpeg's `lavfi` sources (gradients, test patterns,
 * sine tones) — NO third-party or copyrighted media is used or downloaded.
 *
 *   node scripts/make-test-video.mjs                         # every standard fixture into .data/fixtures
 *   node scripts/make-test-video.mjs --out=/tmp/fx --seconds=2 --only=landscape-1080p,corrupt
 *   node scripts/make-test-video.mjs --list
 *
 * As a module (used by tests and by `pnpm seed:media`):
 *
 *   import { generateFixture, FIXTURES } from '../scripts/make-test-video.mjs';
 *   const file = await generateFixture('landscape-720p', { dir, seconds: 3 });
 *
 * Fixtures
 *   landscape-1080p / -720p / -360p / -240p   H.264 + AAC, MP4
 *   portrait-short                            720x1280, H.264 + AAC (becomes a SHORT)
 *   silent-720p                               no audio track
 *   rotated-portrait                          640x360 coded, display-matrix rotation 90 (displays 360x640)
 *   webm-vp8 / mkv-hevc / avi-mpeg4           other containers and codecs
 *   webm-no-duration                          WebM written to a pipe (no duration in the header)
 *   corrupt                                   MP4 header followed by random bytes (ffprobe must refuse it)
 *   truncated                                 the first part of a real MP4 (no `moov` box)
 *   large-1080p                               ~20 MB of noisy 1080p — for pause/resume tests, not for transcoding
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';

/** Visually distinct, pleasant backgrounds so demo posters differ from each other. */
export const PALETTES = {
  violet: ['0x7c3aed', '0xdb2777', '0xf59e0b'],
  ocean: ['0x0ea5e9', '0x6366f1', '0x22c55e'],
  sunset: ['0xf43f5e', '0xf97316', '0xfacc15'],
  forest: ['0x14b8a6', '0x16a34a', '0x84cc16'],
  berry: ['0xa21caf', '0x4f46e5', '0xec4899'],
  night: ['0x1e1b4b', '0x4338ca', '0x0891b2'],
  sand: ['0xca8a04', '0xea580c', '0xdc2626'],
  mint: ['0x34d399', '0x38bdf8', '0xa78bfa'],
};

const gradient = (w, h, fps, seconds, palette = 'violet', speed = 0.05) => {
  const [c0, c1, c2] = PALETTES[palette] ?? PALETTES.violet;
  return `gradients=s=${w}x${h}:r=${fps}:d=${seconds}:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3:speed=${speed}`;
};
const tone = (seconds, frequency = 440, rate = 48000) => `sine=frequency=${frequency}:sample_rate=${rate}:duration=${seconds}`;

/** Run ffmpeg; resolves when it exits 0. `stdoutTo` pipes the muxer output into a file (non-seekable output). */
function run(args, { stdoutTo } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', stdoutTo ? 'pipe' : 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    if (stdoutTo) child.stdout.pipe(createWriteStream(stdoutTo));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().slice(-400)}`))));
  });
}

const h264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p'];
const aac = ['-c:a', 'aac', '-b:a', '96k'];

function standardClip({ width, height, fps = 30, palette = 'violet', audio = true, frequency = 440 }) {
  return async ({ out, seconds }) => {
    const inputs = ['-f', 'lavfi', '-i', gradient(width, height, fps, seconds, palette)];
    if (audio) inputs.push('-f', 'lavfi', '-i', tone(seconds, frequency));
    await run([...inputs, ...h264, ...(audio ? [...aac, '-shortest'] : ['-an']), '-movflags', '+faststart', out]);
  };
}

/** @type {Record<string, { file: string, description: string, make: (ctx: { out: string, seconds: number, dir: string }) => Promise<void> }>} */
export const FIXTURES = {
  'landscape-1080p': {
    file: 'landscape-1080p.mp4',
    description: '1920x1080 H.264 + AAC',
    make: standardClip({ width: 1920, height: 1080, palette: 'violet' }),
  },
  'landscape-720p': {
    file: 'landscape-720p.mp4',
    description: '1280x720 H.264 + AAC',
    make: standardClip({ width: 1280, height: 720, palette: 'ocean', frequency: 523 }),
  },
  'landscape-360p': {
    file: 'landscape-360p.mp4',
    description: '640x360 H.264 + AAC (must yield exactly one 360p rendition)',
    make: standardClip({ width: 640, height: 360, palette: 'forest', frequency: 392 }),
  },
  'landscape-240p': {
    file: 'landscape-240p.mp4',
    description: '426x240 H.264 + AAC (below the ladder: one rendition at source size)',
    make: standardClip({ width: 426, height: 240, fps: 25, palette: 'sunset', frequency: 330 }),
  },
  'portrait-short': {
    file: 'portrait-short.mp4',
    description: '720x1280 H.264 + AAC (portrait, short → SHORT)',
    make: standardClip({ width: 720, height: 1280, palette: 'berry', frequency: 660 }),
  },
  'silent-720p': {
    file: 'silent-720p.mp4',
    description: '1280x720 H.264, no audio track',
    make: standardClip({ width: 1280, height: 720, palette: 'night', audio: false }),
  },
  'rotated-portrait': {
    file: 'rotated-portrait.mp4',
    description: '640x360 coded with display rotation 90 (shown as 360x640)',
    make: async ({ out, seconds, dir }) => {
      const base = path.join(dir, `.rotated-base-${process.pid}.mp4`);
      try {
        await standardClip({ width: 640, height: 360, palette: 'mint' })({ out: base, seconds });
        await run(['-display_rotation:v:0', '90', '-i', base, '-c', 'copy', out]);
      } finally {
        await fs.rm(base, { force: true });
      }
    },
  },
  'webm-vp8': {
    file: 'webm-vp8.webm',
    description: '640x360 VP8 + Opus in WebM',
    make: async ({ out, seconds }) => {
      await run([
        '-f', 'lavfi', '-i', gradient(640, 360, 30, seconds, 'sunset'),
        '-f', 'lavfi', '-i', tone(seconds, 440),
        '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '600k',
        '-c:a', 'libopus', '-shortest', out,
      ]);
    },
  },
  'webm-no-duration': {
    file: 'webm-no-duration.webm',
    description: 'WebM streamed to a pipe: the header carries no duration (like browser recordings)',
    make: async ({ out, seconds }) => {
      await run(
        [
          '-f', 'lavfi', '-i', gradient(640, 360, 30, seconds, 'ocean'),
          '-f', 'lavfi', '-i', tone(seconds, 440),
          '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '600k',
          '-c:a', 'libopus', '-shortest', '-f', 'webm', 'pipe:1',
        ],
        { stdoutTo: out },
      );
    },
  },
  'mkv-hevc': {
    file: 'mkv-hevc.mkv',
    description: '1280x720 HEVC + AAC in Matroska',
    make: async ({ out, seconds }) => {
      await run([
        '-f', 'lavfi', '-i', gradient(1280, 720, 24, seconds, 'forest'),
        '-f', 'lavfi', '-i', tone(seconds, 392),
        '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '30', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p',
        ...aac, '-shortest', '-f', 'matroska', out,
      ]);
    },
  },
  'avi-mpeg4': {
    file: 'avi-mpeg4.avi',
    description: '640x480 MPEG-4 part 2 + MP3 in AVI (4:3, legacy codecs)',
    make: async ({ out, seconds }) => {
      await run([
        '-f', 'lavfi', '-i', gradient(640, 480, 25, seconds, 'sand'),
        '-f', 'lavfi', '-i', tone(seconds, 500, 44100),
        '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'libmp3lame', '-b:a', '96k', '-shortest', out,
      ]);
    },
  },
  corrupt: {
    file: 'corrupt.mp4',
    description: 'valid-looking MP4 header followed by random bytes',
    make: async ({ out }) => {
      // Deterministic pseudo-random bytes (xorshift) so the fixture is reproducible.
      let x = 0x2545f491;
      const noise = Buffer.alloc(64 * 1024);
      for (let i = 0; i < noise.length; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        noise[i] = x & 0xff;
      }
      const ftyp = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]);
      await fs.writeFile(out, Buffer.concat([ftyp, noise]));
    },
  },
  truncated: {
    file: 'truncated.mp4',
    description: 'the first 40% of a real MP4 (the index at the end is missing)',
    make: async ({ out, seconds, dir }) => {
      const base = path.join(dir, `.truncated-base-${process.pid}.mp4`);
      try {
        // No `+faststart`: the `moov` index is written at the END, so cutting the file makes it unreadable.
        await run(['-f', 'lavfi', '-i', gradient(640, 360, 30, seconds, 'night'), ...h264, '-an', base]);
        const bytes = await fs.readFile(base);
        await fs.writeFile(out, bytes.subarray(0, Math.floor(bytes.length * 0.4)));
      } finally {
        await fs.rm(base, { force: true });
      }
    },
  },
  'large-1080p': {
    file: 'large-1080p.mp4',
    description: '~20 MB of noisy 1080p, only meant for upload pause/resume tests',
    make: async ({ out }) => {
      await run([
        '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=8,noise=alls=60:allf=t+u',
        '-f', 'lavfi', '-i', tone(8),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '20M', '-maxrate', '20M', '-bufsize', '40M', '-pix_fmt', 'yuv420p',
        ...aac, '-shortest', out,
      ]);
    },
  },
};

export const STANDARD_FIXTURES = [
  'landscape-1080p',
  'landscape-720p',
  'landscape-360p',
  'landscape-240p',
  'portrait-short',
  'silent-720p',
  'corrupt',
];

/**
 * Create one fixture (cached: an existing file is reused unless `force`). Returns its absolute path.
 * `seconds` defaults to 3 (2–4 s keeps pipeline tests fast).
 */
export async function generateFixture(name, { dir = '.data/fixtures', seconds = 3, force = false } = {}) {
  const fixture = FIXTURES[name];
  if (!fixture) throw new Error(`Unknown fixture "${name}". Known: ${Object.keys(FIXTURES).join(', ')}`);
  const absoluteDir = path.resolve(dir);
  await fs.mkdir(absoluteDir, { recursive: true });
  const out = path.join(absoluteDir, fixture.file);
  if (!force) {
    try {
      const stat = await fs.stat(out);
      if (stat.size > 0) return out;
    } catch {
      /* not generated yet */
    }
  }
  // Build into a temp name, then rename: concurrent callers never see half-written files. The temp name keeps the
  // real extension because ffmpeg picks the container from it.
  const ext = path.extname(fixture.file);
  const partial = path.join(absoluteDir, `.partial-${process.pid}-${Date.now()}-${path.basename(fixture.file, ext)}${ext}`);
  try {
    await fixture.make({ out: partial, seconds, dir: absoluteDir });
    await fs.rename(partial, out);
  } finally {
    await fs.rm(partial, { force: true });
  }
  return out;
}

export async function generateFixtures(names = STANDARD_FIXTURES, options = {}) {
  const result = {};
  for (const name of names) result[name] = await generateFixture(name, options);
  return result;
}

// --- CLI ---------------------------------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  if (args.includes('--list')) {
    for (const [name, f] of Object.entries(FIXTURES)) console.log(`${name.padEnd(18)} ${f.description}`);
  } else {
    const only = opt('only');
    const names = only ? only.split(',') : Object.keys(FIXTURES).filter((n) => n !== 'large-1080p');
    const files = await generateFixtures(names, {
      dir: opt('out', '.data/fixtures'),
      seconds: Number(opt('seconds', '3')),
      force: args.includes('--force'),
    });
    for (const [name, file] of Object.entries(files)) {
      const { size } = await fs.stat(file);
      console.log(`✔ ${name.padEnd(18)} ${(size / 1024).toFixed(0).padStart(7)} KiB  ${path.relative(process.cwd(), file)}`);
    }
  }
}
