/**
 * Decode bill file bytes to Unicode text.
 *
 * Alipay CSV exports are GBK; WeChat xlsx is a zip; WeChat/Alipay may also be UTF-8.
 */
import { xlsxToCsvText } from './xlsx-lite.js';

export interface DecodeBillFileResult {
  readonly text: string;
  readonly encoding: 'utf-8' | 'gbk' | 'xlsx';
  readonly format: 'csv' | 'xlsx';
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

export function decodeBillFile(buf: Buffer, fileName?: string): DecodeBillFileResult {
  const name = (fileName ?? '').toLowerCase();
  const isXlsx =
    (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) || name.endsWith('.xlsx') || name.endsWith('.xls');

  if (isXlsx) {
    return { text: xlsxToCsvText(buf), encoding: 'xlsx', format: 'xlsx' };
  }

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.toString('utf8'), encoding: 'utf-8', format: 'csv' };
  }
  if (isUtf8(buf)) {
    return { text: buf.toString('utf8'), encoding: 'utf-8', format: 'csv' };
  }
  return { text: decodeGbk(buf), encoding: 'gbk', format: 'csv' };
}
