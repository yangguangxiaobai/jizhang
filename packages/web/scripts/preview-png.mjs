/**
 * Renders a generated PNG as ASCII so its shape can be checked without an image
 * viewer. Throwaway verification tool for `generate-icons.mjs`.
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const columns = Number(process.argv[3] ?? 48);

const buffer = readFileSync(file);

// Walk the chunks to find IHDR and IDAT.
let width = 0;
let height = 0;
const idat = [];
let offset = 8;
while (offset < buffer.length) {
  const length = buffer.readUInt32BE(offset);
  const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
  const data = buffer.subarray(offset + 8, offset + 8 + length);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
  }
  if (type === 'IDAT') idat.push(data);
  offset += length + 12;
}

const raw = inflateSync(Buffer.concat(idat));
const stride = width * 3;

/** Undo the per-scanline filter (only None=0 and Sub=1 are emitted, but handle all). */
const pixels = Buffer.alloc(width * height * 3);
let previous = Buffer.alloc(stride);
for (let y = 0; y < height; y += 1) {
  const filter = raw[y * (stride + 1)];
  const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
  for (let x = 0; x < stride; x += 1) {
    const a = x >= 3 ? line[x - 3] : 0;
    const b = previous[x];
    if (filter === 1) line[x] = (line[x] + a) & 0xff;
    else if (filter === 2) line[x] = (line[x] + b) & 0xff;
    else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
    else if (filter === 4) {
      const c = x >= 3 ? previous[x - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  }
  line.copy(pixels, y * stride);
  previous = line;
}

/** Downsample to `columns` wide and print luminance as a character ramp. */
const rows = Math.max(1, Math.round((columns * height) / width / 2));
const ramp = ' .:-=+*#%@';
const out = [];
for (let row = 0; row < rows; row += 1) {
  let line = '';
  for (let col = 0; col < columns; col += 1) {
    const x0 = Math.floor((col * width) / columns);
    const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / columns));
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows));

    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const o = (y * width + x) * 3;
        sum += 0.299 * pixels[o] + 0.587 * pixels[o + 1] + 0.114 * pixels[o + 2];
        count += 1;
      }
    }
    const luma = count === 0 ? 0 : sum / count;
    line += ramp[Math.min(ramp.length - 1, Math.floor((luma / 255) * ramp.length))];
  }
  out.push(line);
}

console.log(`${file} ${width}x${height}`);
console.log(out.join('\n'));
