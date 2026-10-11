/** KEEP_ORIGINAL_SOURCE=false: the raw upload is deleted once the HLS outputs exist. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.KEEP_ORIGINAL_SOURCE = 'false';
  process.env.TRANSCODE_PRESET = 'ultrafast';
});

import { db } from '@/lib/db';
import { getStorage, keys } from '@/lib/storage';
import { processVideo } from '../../worker/pipeline/process-video';
import { createUser } from '../helpers/factories';
import { createUploadedVideo } from '../helpers/media';

describe('video.process without keeping the original', () => {
  it(
    'deletes the source object and clears sourceKey after a successful run',
    async () => {
      const owner = await createUser({ withChannel: true });
      const { id } = await createUploadedVideo(owner.channel!.id, { source: 'landscape-360p' });
      expect(await getStorage().head(keys.upload(id))).not.toBeNull();

      expect((await processVideo(id)).status).toBe('ready');
      expect(await getStorage().head(keys.upload(id))).toBeNull();
      const video = await db.video.findUniqueOrThrow({ where: { id }, include: { assets: true } });
      expect(video.sourceKey).toBeNull();
      expect(video.assets.some((a) => a.kind === 'SOURCE')).toBe(false);
      expect(video.hlsMasterKey).toBe(keys.hlsMaster(id));
      expect(await getStorage().head(keys.hlsMaster(id))).not.toBeNull();
    },
    120_000,
  );
});
