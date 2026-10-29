/**
 * Minimal XLSX (first sheet) → string[][] reader.
 *
 * WeChat exports bills as .xlsx. We only need cell values from sheet1 plus the
 * shared-string table — no formulas, styles, or multiple sheets. Node's zlib
 * inflates the zip entries; a full spreadsheet library would dwarf this app.
 *
 * `xlsxToRows` accepts an optional budget. Without one the behaviour is exactly the
 * historical one (used by the legacy single-file import); with one, every bound is enforced
 * by rejection so a hostile or simply huge workbook cannot inflate without limit. The
 * structural checks run on the central directory *before* any inflation, which is what makes
 * a zip bomb a refusal instead of an allocation.
 */
import { inflateRawSync } from 'node:zlib';

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}
function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

/** Feature-scoped decompression budget. Absent fields mean "no bound" (legacy behaviour). */
export interface XlsxBudget {
  readonly maxEntries?: number;
  readonly maxEntryBytes?: number;
  /** Worksheet materialization limits; checked before allocating sparse cells/rows. */
  readonly maxRows?: number;
  readonly maxColumns?: number;
  readonly maxCellChars?: number;
  /** Shared ceiling across the whole batch, measured against `counter.total`. */
  readonly maxTotalBytes?: number;
  /**
   * Mutable shared accumulator. One counter instance spans every file in a batch, so a caller
   * enforcing "≤16 MiB of inflation for this whole import" gets a real total instead of a
   * per-file bound multiplied by the file count.
   */
  readonly counter?: { total: number };
}

/** Thrown for any structural/budget refusal; callers map it to the import limit error. */
export class XlsxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxLimitError';
  }
}

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

function unzipAll(buf: Buffer, budget?: XlsxBudget): ZipEntry[] {
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
  const localOffset = readUInt32LE(buf, eocd + 16);
  const centralSize = readUInt32LE(buf, eocd + 12);
  if (budget?.maxEntries !== undefined && count > budget.maxEntries) {
    throw new XlsxLimitError(`xlsx 条目数超出限制（最多 ${budget.maxEntries} 个）。`);
  }
  // The central directory must lie inside the file; otherwise every offset below is fiction.
  if (localOffset > buf.length || localOffset + centralSize > buf.length) {
    throw new Error('不是有效的 xlsx（zip）文件：目录越界。');
  }
  let offset = localOffset;
  const entries: ZipEntry[] = [];
  let inflatedTotal = 0;
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buf.length || readUInt32LE(buf, offset) !== 0x02014b50) {
      throw new XlsxLimitError('xlsx 中央目录结构不完整，已拒绝解析。');
    }
    const method = readUInt16LE(buf, offset + 10);
    const compSize = readUInt32LE(buf, offset + 20);
    const uncompSize = readUInt32LE(buf, offset + 24);
    const nameLen = readUInt16LE(buf, offset + 28);
    const extraLen = readUInt16LE(buf, offset + 30);
    const commentLen = readUInt16LE(buf, offset + 32);
    const entryLocalOffset = readUInt32LE(buf, offset + 42);
    const recordEnd = offset + 46 + nameLen + extraLen + commentLen;
    if (recordEnd > buf.length || recordEnd > localOffset + centralSize) {
      throw new XlsxLimitError('xlsx 中央目录记录越界，已拒绝解析。');
    }
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset = recordEnd;

    // Structural bounds checks happen BEFORE inflating: a declared output size or a local
    // header offset pointing outside the file is a refusal, not an attempt.
    if (budget?.maxEntryBytes !== undefined && uncompSize > budget.maxEntryBytes) {
      throw new XlsxLimitError(`xlsx 单条目解压超出限制（最多 ${budget.maxEntryBytes} 字节）。`);
    }
    if (entryLocalOffset + 30 > buf.length || readUInt32LE(buf, entryLocalOffset) !== 0x04034b50) {
      throw new XlsxLimitError('xlsx 本地文件头无效，已拒绝解析。');
    }
    const lNameLen = readUInt16LE(buf, entryLocalOffset + 26);
    const lExtraLen = readUInt16LE(buf, entryLocalOffset + 28);
    const dataStart = entryLocalOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) {
      throw new XlsxLimitError('xlsx 条目数据越界，文件已损坏或被截断。');
    }
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const limit = budget?.maxEntryBytes;
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
      if (limit !== undefined && data.byteLength > limit) {
        throw new XlsxLimitError(`xlsx 单条目解压超出限制（最多 ${limit} 字节）。`);
      }
    } else {
      try {
        data = inflateRawSync(raw, limit === undefined ? {} : { maxOutputLength: limit });
      } catch {
        throw new XlsxLimitError(`xlsx 单条目解压超出限制（最多 ${limit ?? 0} 字节）。`);
      }
    }
    if (data.byteLength !== uncompSize) {
      throw new XlsxLimitError('xlsx 条目解压长度与目录声明不一致，已拒绝解析。');
    }
    inflatedTotal += data.byteLength;
    if (budget?.counter !== undefined) budget.counter.total += data.byteLength;
    const runningTotal = budget?.counter?.total ?? inflatedTotal;
    if (budget?.maxTotalBytes !== undefined && runningTotal > budget.maxTotalBytes) {
      throw new XlsxLimitError('本批 xlsx 解压总量超出限制，请拆分文件后重试。');
    }
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

function excelSerialToDateTimeString(serial: number): string {
  // Excel base: serial days since 1899-12-30 (accounting for 1900 leap bug)
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function parseSheet(xml: string, shared: string[], budget?: XlsxBudget): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<row\b[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g;
  for (const rowMatch of xml.matchAll(rowPattern)) {
    if (budget?.maxRows !== undefined && rows.length >= budget.maxRows) {
      throw new XlsxLimitError(`xlsx 工作表行数超出限制（最多 ${budget.maxRows} 行）。`);
    }
    const cells: string[] = [];
    const rowXml = rowMatch[1] ?? '';
    const cellPattern = /<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g;
    for (const cellMatch of rowXml.matchAll(cellPattern)) {
      const cell = cellMatch[0];
      const ref = /r="([A-Z]+\d+)"/.exec(cell)?.[1] ?? 'A1';
      const idx = colToIndex(ref);
      const rowNumber = Number(/\d+$/.exec(ref)?.[0] ?? 0);
      if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || (budget?.maxRows !== undefined && rowNumber > budget.maxRows)) {
        throw new XlsxLimitError(`xlsx 工作表行数超出限制（最多 ${budget?.maxRows ?? 0} 行）。`);
      }
      if (idx < 0 || (budget?.maxColumns !== undefined && idx >= budget.maxColumns)) {
        throw new XlsxLimitError(`xlsx 工作表列数超出限制（最多 ${budget?.maxColumns ?? 0} 列）。`);
      }
      const t = /t="([^"]+)"/.exec(cell)?.[1] ?? '';
      const sAttr = /s="(\d+)"/.exec(cell)?.[1] ?? '';
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
        const rawV = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1] ?? '';
        // If it's a numeric date serial (e.g. 46307.5866), convert to formatted date string
        const num = Number(rawV);
        if (Number.isFinite(num) && num > 30000 && num < 65000 && (idx === 0 || sAttr === '1')) {
          value = excelSerialToDateTimeString(num);
        } else {
          value = rawV;
        }
      }
      if (budget?.maxCellChars !== undefined && value.length > budget.maxCellChars) {
        throw new XlsxLimitError(`xlsx 单元格超出限制（最多 ${budget.maxCellChars} 字符）。`);
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Reads the first worksheet of an xlsx buffer as string rows. */
export function xlsxToRows(buf: Buffer, budget?: XlsxBudget): string[][] {
  const entries = unzipAll(buf, budget);
  const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  const shared = sharedEntry === undefined ? [] : parseSharedStrings(sharedEntry.data.toString('utf8'));
  const sheetEntry =
    entries.find((e) => e.name === 'xl/worksheets/sheet1.xml') ??
    entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (sheetEntry === undefined) throw new Error('xlsx 中未找到工作表');
  return parseSheet(sheetEntry.data.toString('utf8'), shared, budget);
}

/** Serialises xlsx rows to CSV text (WeChat preamble + table). */
export function xlsxToCsvText(buf: Buffer, budget?: XlsxBudget): string {
  return xlsxToRows(buf, budget)
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
