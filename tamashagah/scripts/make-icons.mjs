/**
 * Renders the brand icons from the logo geometry (violet → magenta rounded square with the play glyph, see
 * `src/components/logo.tsx` and `.bg-brand-gradient` in `globals.css`). Run after changing the logo:
 *
 *   node scripts/make-icons.mjs
 *
 * Writes (committed, small):
 *   public/icons/icon-192.png, icon-512.png     purpose "any" (rounded square on a transparent background)
 *   public/icons/maskable-512.png               purpose "maskable" (full-bleed gradient, glyph inside the 80 % safe zone)
 *   src/app/icon.png, src/app/apple-icon.png    Next.js file conventions (<link rel="icon"> / apple-touch-icon)
 *   src/app/favicon.ico                         32×32 PNG inside an ICO container
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');

// oklch → sRGB hex (the two gradient stops of the brand are defined in oklch in globals.css)
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const enc = (x) => {
    const c = Math.min(1, Math.max(0, x));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  };
  return `#${lin.map((x) => enc(x).toString(16).padStart(2, '0')).join('')}`;
}

const from = oklchToHex(0.491, 0.27, 292.581);
const to = oklchToHex(0.6, 0.25, 330);

/** The play glyph of the logo (24×24 viewBox), scaled and centred in a `size` square. */
const glyph = (size, scale) => {
  const s = (size / 24) * scale;
  const offset = (size - 24 * s) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${s})" fill="#fff"><path d="M8 5.6c0-1.1 1.2-1.8 2.2-1.2l9 5.9c.9.6.9 1.8 0 2.4l-9 5.9c-1 .6-2.2-.1-2.2-1.2V5.6Z"/></g>`;
};

const svg = (size, { rounded, glyphScale }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${rounded ? Math.round(size * 0.22) : 0}" fill="url(#g)"/>
  ${glyph(size, glyphScale)}
</svg>`;

const png = (size, options) => sharp(Buffer.from(svg(size, options))).png({ compressionLevel: 9 }).toBuffer();

async function write(file, buffer) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  console.log(`✔ ${file} (${(buffer.length / 1024).toFixed(1)} kB)`);
}

/** ICO container with one PNG image (supported by every current browser). */
function ico(pngBuffer, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  header.writeUInt8(size, 6); // width
  header.writeUInt8(size, 7); // height
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(pngBuffer.length, 14); // image size
  header.writeUInt32LE(22, 18); // image offset
  return Buffer.concat([header, pngBuffer]);
}

await write('public/icons/icon-192.png', await png(192, { rounded: true, glyphScale: 0.52 }));
await write('public/icons/icon-512.png', await png(512, { rounded: true, glyphScale: 0.52 }));
await write('public/icons/maskable-512.png', await png(512, { rounded: false, glyphScale: 0.42 }));
await write('src/app/icon.png', await png(96, { rounded: true, glyphScale: 0.56 }));
await write('src/app/apple-icon.png', await png(180, { rounded: false, glyphScale: 0.46 }));
await write('src/app/favicon.ico', ico(await png(32, { rounded: true, glyphScale: 0.6 }), 32));
console.log(`gradient ${from} → ${to}`);
