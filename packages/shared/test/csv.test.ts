/**
 * CSV round-trip and parsing specs (T15 PRD AC1/AC3).
 *
 * The parser is the part of this feature where a plausible-looking simplification loses
 * data silently: a `split(',')` passes every simple test and then shifts every column after
 * the first remark that contains a comma. Each awkward case therefore has its own test
 * rather than relying on one "round trip" case that happens to avoid them.
 */

import { describe, expect, it } from 'vitest';

import {
  encodeCsv,
  encodeCsvField,
  encodeCsvWithBom,
  parseCsv,
  parseCsvWithHeader,
} from '../src/csv.js';

describe('encodeCsvField', () => {
  it('leaves a plain value alone', () => {
    expect(encodeCsvField('餐饮')).toBe('餐饮');
    expect(encodeCsvField('123.45')).toBe('123.45');
    expect(encodeCsvField('')).toBe('');
  });

  it('quotes a value containing a comma', () => {
    expect(encodeCsvField('午饭, 加饮料')).toBe('"午饭, 加饮料"');
  });

  it('quotes a value containing a newline', () => {
    expect(encodeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('doubles an inner quote and wraps the field', () => {
    expect(encodeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a value with a leading or trailing space only when it also needs quoting', () => {
    // A plain leading space is preserved by every reader; quoting it is not required.
    expect(encodeCsvField('  padded  ')).toBe('  padded  ');
  });

  it('neutralises a spreadsheet formula', () => {
    // A remark starting with `=` would be executed as a formula when the file is opened.
    expect(encodeCsvField('=1+1')).toBe("'=1+1");
    expect(encodeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('parseCsv', () => {
  it('parses a simple document', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('parses a quoted field containing the delimiter', () => {
    expect(parseCsv('a,b\n"x,y",z')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ]);
  });

  it('parses a quoted field containing a newline', () => {
    expect(parseCsv('a,b\n"line1\nline2",z')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'z'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  it('handles CRLF line endings (what Excel writes)', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles mixed CRLF and LF in one file', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles a file with no trailing newline', () => {
    // Very common, and the case a naive "split then drop the last row" gets wrong.
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
  });

  it('handles a file WITH a trailing newline without inventing an empty row', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2);
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    expect(parseCsv(',,')).toEqual([['', '', '']]);
  });

  it('strips a leading BOM', () => {
    // Otherwise the first header cell is "\uFEFFid" and every lookup for "id" misses.
    expect(parseCsv('\uFEFFa,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('treats a quote appearing mid-field as a literal character', () => {
    expect(parseCsv('a\n12"34')).toEqual([['a'], ['12"34']]);
  });

  it('handles a lone CR as a record separator', () => {
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('encode/decode round trip', () => {
  it('AC3 a remark containing a comma does not shift the columns', () => {
    const rows = [
      ['id', 'note', 'amount'],
      ['t1', '午饭, 加饮料', '19.99'],
      ['t2', '普通备注', '5.00'],
    ];

    const parsed = parseCsv(encodeCsv(rows));

    expect(parsed).toEqual(rows);
    // The specific damage this guards against: row 1 having four columns.
    expect(parsed[1]).toHaveLength(3);
    expect(parsed[1]?.[2]).toBe('19.99');
  });

  it('AC3 round-trips quotes and newlines in one field', () => {
    const rows = [
      ['id', 'note'],
      ['t1', '他说 "太贵了"\n然后走了'],
    ];

    expect(parseCsv(encodeCsv(rows))).toEqual(rows);
  });

  it('round-trips Chinese text unchanged', () => {
    const rows = [
      ['分类', '备注'],
      ['餐饮', '楼下的牛肉面'],
      ['住房', '房租（含物业费）'],
    ];

    expect(parseCsv(encodeCsv(rows))).toEqual(rows);
  });

  it('round-trips empty and whitespace-only fields', () => {
    const rows = [
      ['a', 'b', 'c'],
      ['', '   ', 'x'],
    ];

    expect(parseCsv(encodeCsv(rows))).toEqual(rows);
  });
});

describe('encodeCsvWithBom', () => {
  it('AC1 starts with a UTF-8 BOM so Excel reads Chinese correctly', () => {
    const text = encodeCsvWithBom([
      ['分类', '金额'],
      ['餐饮', '19.99'],
    ]);

    // The three bytes Excel keys off. Asserted as bytes, not as a character, because the
    // file is written as UTF-8.
    const bytes = Buffer.from(text, 'utf8');
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.startsWith('\uFEFF')).toBe(true);
  });

  it('the BOM does not survive a parse as data', () => {
    const text = encodeCsvWithBom([
      ['id', 'note'],
      ['t1', 'x'],
    ]);

    expect(parseCsv(text)).toEqual([
      ['id', 'note'],
      ['t1', 'x'],
    ]);
  });
});

describe('parseCsvWithHeader', () => {
  it('maps each row onto the header names', () => {
    const { header, records } = parseCsvWithHeader('id,note\n1,午饭\n2,晚饭');

    expect(header).toEqual(['id', 'note']);
    expect(records).toEqual([
      { id: '1', note: '午饭' },
      { id: '2', note: '晚饭' },
    ]);
  });

  it('ignores blank trailing lines', () => {
    const { records } = parseCsvWithHeader('id,note\n1,x\n\n');
    expect(records).toHaveLength(1);
  });

  it('reports a misaligned row instead of guessing which column shifted', () => {
    // Padding or truncating would silently put a value in the wrong field.
    expect(() => parseCsvWithHeader('id,note,amount\n1,午饭')).toThrow(/Row 2 has 2 column/);
  });

  it('accepts a header-only file', () => {
    const { records } = parseCsvWithHeader('id,note');
    expect(records).toEqual([]);
  });
});
