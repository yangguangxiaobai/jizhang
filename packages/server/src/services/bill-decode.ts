/**
 * Decode bill file bytes to Unicode text.
 *
 * Alipay CSV exports are GBK; WeChat xlsx is a zip; WeChat/Alipay may also be UTF-8.
 *
 * `decodeBillFile` takes an optional budget. Absent it, the historical behaviour is
 * preserved byte for byte (the legacy single-file import calls it with no options). With a
 * budget, decoding refuses instead of silently producing a truncated document — the merged
 * batch must never book half a file.
 */
import { xlsxToCsvText, type XlsxBudget } from './xlsx-lite.js';

export interface DecodeBillFileLimits {
  /** Passed through to the XLSX reader (entries / per-entry / shared counter). */
  readonly xlsx?: XlsxBudget;
  /** Maximum decoded text size in UTF-8 bytes. */
  readonly maxTextBytes?: number;
}

export interface DecodeBillFileResult {
  readonly text: string;
  readonly encoding: 'utf-8' | 'gbk' | 'xlsx';
  readonly format: 'csv' | 'xlsx';
}

export class DecodeBillLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeBillLimitError';
  }
}

function isUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * GB18030 decoder for the common Alipay export.
 * Implements a mapping via Node's `TextDecoder('gbk')` when available; otherwise
 * falls back to a bundled index for the BMP range via iconv if present.
 */
function decodeGbk(buf: Buffer): string {
  try {
    return new TextDecoder('gbk' as BufferEncoding, { fatal: false }).decode(buf);
  } catch {
    // Node supports gbk in full-icu builds; if not, try gb18030
  }
  try {
    return new TextDecoder('gb18030', { fatal: false }).decode(buf);
  } catch {
    throw new Error('无法按 GBK/GB18030 解码账单，请在导出后另存为 UTF-8 CSV，或改用微信/支付宝的 CSV 导出。');
  }
}

function enforceTextLimit(text: string, limits?: DecodeBillFileLimits): string {
  const max = limits?.maxTextBytes;
  if (max === undefined) return text;
  if (Buffer.byteLength(text, 'utf8') > max) {
    throw new DecodeBillLimitError(`账单解码文本超出限制（最多 ${max} 字节）。请拆分文件后重试。`);
  }
  return text;
}

export function decodeBillFile(buf: Buffer, fileName?: string, limits?: DecodeBillFileLimits): DecodeBillFileResult {
  const name = (fileName ?? '').toLowerCase();
  const isXlsx =
    (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) || name.endsWith('.xlsx') || name.endsWith('.xls');

  if (isXlsx) {
    return {
      text: enforceTextLimit(xlsxToCsvText(buf, limits?.xlsx), limits),
      encoding: 'xlsx',
      format: 'xlsx',
    };
  }

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: enforceTextLimit(buf.toString('utf8'), limits), encoding: 'utf-8', format: 'csv' };
  }
  if (isUtf8(buf)) {
    return { text: enforceTextLimit(buf.toString('utf8'), limits), encoding: 'utf-8', format: 'csv' };
  }
  return { text: enforceTextLimit(decodeGbk(buf), limits), encoding: 'gbk', format: 'csv' };
}
