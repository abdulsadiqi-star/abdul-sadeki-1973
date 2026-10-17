/**
 * HLS playlists — pure helpers.
 *
 *  - `analyzeMediaPlaylist`  reads a rendition playlist written by ffmpeg to learn the segments and their duration
 *  - `bandwidthOf`           peak / average bits per second from segment sizes (what BANDWIDTH must report)
 *  - `buildMasterPlaylist`   the multivariant playlist players start from
 */

export type PlaylistSegment = { uri: string; duration: number };
export type MediaPlaylistInfo = { segments: PlaylistSegment[]; targetDuration: number; totalDuration: number; ended: boolean };

/** Parse `#EXTINF` entries of a media playlist. Tolerant: unknown tags are ignored. */
export function analyzeMediaPlaylist(text: string): MediaPlaylistInfo {
  const segments: PlaylistSegment[] = [];
  let pending: number | null = null;
  let targetDuration = 0;
  let ended = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const duration = Number.parseFloat(line.slice('#EXTINF:'.length));
      pending = Number.isFinite(duration) ? duration : null;
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number.parseInt(line.slice('#EXT-X-TARGETDURATION:'.length), 10) || 0;
    } else if (line === '#EXT-X-ENDLIST') {
      ended = true;
    } else if (!line.startsWith('#') && pending !== null) {
      segments.push({ uri: line, duration: pending });
      pending = null;
    }
  }
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  return { segments, targetDuration, totalDuration, ended };
}

export type Bandwidth = { peak: number; average: number };

/**
 * HLS BANDWIDTH is the PEAK segment bit rate, AVERAGE-BANDWIDTH the mean (RFC 8216 §4.3.4.2). Both include audio
 * because every segment contains both.
 */
export function bandwidthOf(segments: ReadonlyArray<{ duration: number; bytes: number }>): Bandwidth {
  let peak = 0;
  let bits = 0;
  let seconds = 0;
  for (const s of segments) {
    if (!(s.duration > 0)) continue;
    const segmentBits = s.bytes * 8;
    peak = Math.max(peak, segmentBits / s.duration);
    bits += segmentBits;
    seconds += s.duration;
  }
  return { peak: Math.ceil(peak), average: seconds > 0 ? Math.ceil(bits / seconds) : 0 };
}

export type MasterVariant = {
  /** Display name ("720p"). */
  name: string;
  /** Path of the variant playlist relative to the master ("720p/index.m3u8"). */
  uri: string;
  width: number;
  height: number;
  /** Peak bits per second. */
  bandwidth: number;
  averageBandwidth?: number;
  frameRate?: number;
  /** RFC 6381 list, e.g. "avc1.64001f,mp4a.40.2". */
  codecs: string;
};

const quote = (value: string) => `"${value.replace(/["\r\n]/g, '')}"`;

/** Lowest bandwidth first: players that start at the first variant begin quickly, ABR then climbs. */
export function buildMasterPlaylist(variants: readonly MasterVariant[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
  const sorted = [...variants].sort((a, b) => a.bandwidth - b.bandwidth || a.height - b.height);
  for (const v of sorted) {
    const attributes = [
      `BANDWIDTH=${Math.max(1, Math.round(v.bandwidth))}`,
      ...(v.averageBandwidth ? [`AVERAGE-BANDWIDTH=${Math.round(v.averageBandwidth)}`] : []),
      `RESOLUTION=${v.width}x${v.height}`,
      ...(v.frameRate ? [`FRAME-RATE=${v.frameRate.toFixed(3)}`] : []),
      `CODECS=${quote(v.codecs)}`,
      `NAME=${quote(v.name)}`,
    ];
    lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`, v.uri);
  }
  return `${lines.join('\n')}\n`;
}
