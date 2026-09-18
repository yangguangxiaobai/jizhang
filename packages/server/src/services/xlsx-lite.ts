/**
 * Minimal XLSX (first sheet) → string[][] reader.
 *
 * WeChat exports bills as .xlsx. We only need cell values from sheet1 plus the
 * shared-string table — no formulas, styles, or multiple sheets. Node's zlib
 * inflates the zip entries; a full spreadsheet library would dwarf this app.
 */
import { inflateRawSync } from 'node:zlib';

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}
function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

function unzipAll(buf: Buffer): ZipEntry[] {
  // End of central directory: signature 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (readUInt32LE(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（zip）文件');
  const count = readUInt16LE(buf, eocd + 10);
  let offset = readUInt32LE(buf, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n += 1) {
    if (readUInt32LE(buf, offset) !== 0x02014b50) break;
    const method = readUInt16LE(buf, offset + 10);
    const compSize = readUInt32LE(buf, offset + 20);
    const nameLen = readUInt16LE(buf, offset + 28);
    const extraLen = readUInt16LE(buf, offset + 30);
    const commentLen = readUInt16LE(buf, offset + 32);
    const localOffset = readUInt32LE(buf, offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (readUInt32LE(buf, localOffset) !== 0x04034b50) continue;
    const lNameLen = readUInt16LE(buf, localOffset + 26);
    const lExtraLen = readUInt16LE(buf, localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    entries.push({ name, data });
  }
  return entries;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const items = xml.split('<si').slice(1);
  for (const item of items) {
    // Concatenate all <t> text nodes (handles rich text runs).
    const texts = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '');
    out.push(
      texts
        .join('')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&'),
    );
  }
  return out;
}

function colToIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowChunks = xml.split(/<row\b/).slice(1);
  for (const chunk of rowChunks) {
    const cells: string[] = [];
    const cellChunks = chunk.split(/<c\b/).slice(1);
    for (const cell of cellChunks) {
      const ref = /r="([A-Z]+\d+)"/.exec(cell)?.[1] ?? 'A1';
      const idx = colToIndex(ref);
      const t = /t="([^"]+)"/.exec(cell)?.[1] ?? '';
      let value = '';
      if (t === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
        value = v === undefined ? '' : (shared[Number(v)] ?? '');
      } else if (t === 'inlineStr') {
        value = [...cell.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((m) => m[1] ?? '')
          .join('')
          .replace(/&amp;/g, '&');
      } else {
        value = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? '';
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Reads the first worksheet of an xlsx buffer as string rows. */
export function xlsxToRows(buf: Buffer): string[][] {
  const entries = unzipAll(buf);
  const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  const shared = sharedEntry === undefined ? [] : parseSharedStrings(sharedEntry.data.toString('utf8'));
  const sheetEntry =
    entries.find((e) => e.name === 'xl/worksheets/sheet1.xml') ??
    entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (sheetEntry === undefined) throw new Error('xlsx 中未找到工作表');
  return parseSheet(sheetEntry.data.toString('utf8'), shared);
}

/** Serialises xlsx rows to CSV text (WeChat preamble + table). */
export function xlsxToCsvText(buf: Buffer): string {
  return xlsxToRows(buf)
    .map((row) =>
      row
        .map((cell) => {
          const s = cell ?? '';
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}
