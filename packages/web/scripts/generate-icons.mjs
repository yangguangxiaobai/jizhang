/**
 * Generates the PWA icon set without any image dependency.
 *
 * ## Why hand-rolled
 *
 * The app needs four PNGs in three sizes. A rasteriser (sharp/canvas) would add a
 * heavy native dependency to a repo whose whole deployment story is "one small
 * container", and a checked-in binary blob cannot be reviewed or recoloured.
 * PNG is simple enough to emit directly: zlib is in Node's standard library, so the
 * only thing this script owns is the pixel maths.
 *
 * Icon design: a rounded-square background in the app's accent colour with a white
 * "¥" glyph drawn from a tiny bitmap font. Rendered as a maskable-safe icon — the
 * glyph stays inside the central 80% so Android can crop it to a circle.
 *
 * Re-run after changing the palette:  node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');

/** Accent colour, matching `--accent` in src/styles/main.css. */
const ACCENT = { r: 0x2f, g: 0x6f, b: 0x8f };
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

/** 5x7 bitmap for the glyph, as rows of bits. */
const GLYPH = {
  // '¥' — a Y with two crossbars.
  yen: [
    '10001',
    '01010',
    '00100',
    '11111',
    '00100',
    '11111',
    '00100',
  ],
};

/** CRC32 table, computed once. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** Wraps a chunk with its length, type and CRC. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes an RGB pixel buffer (rows of `width * 3` bytes) as a PNG. */
function encodePng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with a filter byte (0 = None).
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draws the icon.
 *
 * @param size edge length in pixels
 * @param padding fraction of the edge left as margin around the rounded square
 * @param rounded whether to round the corners (iOS masks the icon itself, so the
 *   apple-touch-icon is written square with no rounding to avoid double-rounding)
 */
function renderIcon(size, { padding = 0, rounded = true } = {}) {
  const rgb = Buffer.alloc(size * size * 3);

  const inset = Math.round(size * padding);
  const boxSize = size - inset * 2;
  const radius = rounded ? Math.round(boxSize * 0.22) : 0;
  const cx = size / 2;
  const cy = size / 2;

  // Glyph geometry: keep it inside the central ~52% so a circular mask cannot clip it.
  const glyphRows = GLYPH.yen;
  const glyphCols = glyphRows[0].length;
  const cell = Math.max(1, Math.floor((boxSize * 0.52) / glyphCols));
  const glyphWidth = cell * glyphCols;
  const glyphHeight = cell * glyphRows.length;
  const glyphLeft = Math.round(cx - glyphWidth / 2);
  const glyphTop = Math.round(cy - glyphHeight / 2);

  const inRoundedSquare = (x, y) => {
    if (x < inset || y < inset || x >= size - inset || y >= size - inset) return false;
    if (radius === 0) return true;

    const localX = x - inset;
    const localY = y - inset;
    const maxLocal = boxSize - 1;

    // Corner circles.
    const corners = [
      { cx: radius, cy: radius },
      { cx: maxLocal - radius, cy: radius },
      { cx: radius, cy: maxLocal - radius },
      { cx: maxLocal - radius, cy: maxLocal - radius },
    ];
    for (const corner of corners) {
      const withinCornerBlock =
        (localX < radius || localX > maxLocal - radius) &&
        (localY < radius || localY > maxLocal - radius);
      if (!withinCornerBlock) continue;
      const dx = localX - corner.cx;
      const dy = localY - corner.cy;
      if (dx * dx + dy * dy > radius * radius) return false;
    }
    return true;
  };

  const inGlyph = (x, y) => {
    if (x < glyphLeft || y < glyphTop) return false;
    const col = Math.floor((x - glyphLeft) / cell);
    const row = Math.floor((y - glyphTop) / cell);
    if (row < 0 || row >= glyphRows.length) return false;
    if (col < 0 || col >= glyphCols) return false;
    return glyphRows[row][col] === '1';
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 3;
      let colour = null;

      if (inGlyph(x, y) && inRoundedSquare(x, y)) {
        colour = WHITE;
      } else if (inRoundedSquare(x, y)) {
        colour = ACCENT;
      }

      if (colour !== null) {
        rgb[offset] = colour.r;
        rgb[offset + 1] = colour.g;
        rgb[offset + 2] = colour.b;
      }
      // Outside the shape stays transparent-looking black; PNG has no alpha here, so
      // the consumer places it on a known background. Every icon we emit is fully
      // covered, so this branch only matters for the padded variants.
    }
  }

  return encodePng(size, size, rgb);
}

mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'pwa-192x192.png', size: 192, options: {} },
  { file: 'pwa-512x512.png', size: 512, options: {} },
  // Maskable icons need a safe zone, hence the padding.
  { file: 'maskable-512x512.png', size: 512, options: { padding: 0.12 } },
  // iOS ignores the manifest icons and uses this one; it applies its own mask, so no
  // rounding here.
  { file: 'apple-touch-icon.png', size: 180, options: { rounded: false } },
  { file: 'favicon-32x32.png', size: 32, options: { rounded: false } },
];

for (const target of targets) {
  const png = renderIcon(target.size, target.options);
  writeFileSync(join(outDir, target.file), png);
  console.log(`wrote public/icons/${target.file} (${target.size}px, ${png.length} bytes)`);
}
