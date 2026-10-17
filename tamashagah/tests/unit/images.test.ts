import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, processImage, sniffImageType } from '@/lib/images';

async function make(format: 'jpeg' | 'png' | 'webp', width = 800, height = 600, withExif = false) {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 120, g: 40, b: 200 } } });
  if (withExif) img.withExif({ IFD0: { Copyright: 'secret', Artist: 'someone' } });
  return img[format]().toBuffer();
}

describe('sniffImageType', () => {
  it('identifies real images by magic bytes', async () => {
    expect(sniffImageType(await make('jpeg'))).toBe('jpeg');
    expect(sniffImageType(await make('png'))).toBe('png');
    expect(sniffImageType(await make('webp'))).toBe('webp');
  });
  it('rejects everything else', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImageType(Buffer.from('short'))).toBeNull();
  });
});

describe('processImage', () => {
  it('crops to the exact size and re-encodes as webp', async () => {
    const out = await processImage(await make('png', 1600, 900), { width: 400, height: 400, fit: 'cover' });
    expect(out).toMatchObject({ contentType: 'image/webp', ext: 'webp', width: 400, height: 400 });
    expect(sniffImageType(out.data)).toBe('webp');
  });

  it('shrinks but never enlarges with fit=inside', async () => {
    const big = await processImage(await make('jpeg', 3000, 2000), { width: 1280, height: 720, fit: 'inside' });
    expect(big.width).toBeLessThanOrEqual(1280);
    expect(big.height).toBeLessThanOrEqual(720);
    const small = await processImage(await make('jpeg', 300, 200), { width: 1280, height: 720, fit: 'inside' });
    expect(small).toMatchObject({ width: 300, height: 200 });
  });

  it('can produce jpeg thumbnails', async () => {
    const out = await processImage(await make('webp'), { width: 640, height: 360, format: 'jpeg' });
    expect(out).toMatchObject({ contentType: 'image/jpeg', ext: 'jpg' });
    expect(sniffImageType(out.data)).toBe('jpeg');
  });

  it('strips EXIF metadata', async () => {
    const withExif = await make('jpeg', 400, 400, true);
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processImage(withExif, { width: 200, height: 200 });
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
  });

  it('rejects non-images, polyglots, truncated files and oversize input', async () => {
    await expect(processImage(Buffer.from('not an image at all, definitely'), { width: 10, height: 10 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const png = await make('png');
    const polyglot = Buffer.concat([png.subarray(0, 40), Buffer.from('<script>alert(1)</script>')]);
    await expect(processImage(polyglot, { width: 10, height: 10 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(processImage(png.subarray(0, 30), { width: 10, height: 10 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(processImage(Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff), { width: 10, height: 10 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(processImage(Buffer.alloc(0), { width: 10, height: 10 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
