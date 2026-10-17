/**
 * The pipeline with the DEFAULT encoder settings (veryfast, 6 s segments): the output must be real High-profile
 * H.264 with GOP-aligned segments.
 */
import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { processVideo } from '../../worker/pipeline/process-video';
import { createUser } from '../helpers/factories';
import { createUploadedVideo, ffprobeJson, storagePath } from '../helpers/media';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('video.process with default settings', () => {
  it(
    'writes High-profile H.264 with keyframes on every segment boundary',
    async () => {
      const owner = await createUser({ withChannel: true });
      const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-720p' });
      expect((await processVideo(id)).status).toBe('ready');

      const probe = await ffprobeJson(storagePath(`videos/${id}/hls/720p/index.m3u8`));
      const video = probe.streams.find((s) => s.codec_type === 'video')!;
      expect(video).toMatchObject({ codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p' });

      // 3 s clip, 6 s segments → a single segment that starts on a keyframe (independent segments)
      const playlist = await fs.readFile(storagePath(`videos/${id}/hls/720p/index.m3u8`), 'utf8');
      expect(playlist).toContain('#EXT-X-TARGETDURATION:');
      expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
      expect(playlist).toContain('#EXT-X-INDEPENDENT-SEGMENTS');
      expect(playlist).toContain('#EXT-X-ENDLIST');
      const segment = playlist.split('\n').find((l) => l.endsWith('.ts'))!;
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame,pts_time', '-of', 'csv=p=0',
        storagePath(`videos/${id}/hls/720p/${segment}`),
      ]);
      expect(stdout.trim().split('\n')[0]!.startsWith('1,')).toBe(true); // the first frame of the segment is a keyframe

      const master = await fs.readFile(storagePath(`videos/${id}/hls/master.m3u8`), 'utf8');
      expect(master).toContain('RESOLUTION=1280x720');
      expect(await db.video.count({ where: { id, processingStatus: 'READY' } })).toBe(1);
    },
    120_000,
  );
});
