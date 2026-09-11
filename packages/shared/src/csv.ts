/**
 * Minimal RFC 4180 CSV encoding and parsing.
 *
 * ## Why hand-written
 *
 * The job is two things: escape a field, and split a line into fields. A CSV dependency
 * would save roughly sixty lines and cost a package, a supply-chain surface and a parser
 * with its own history of edge cases. The project already refuses dependencies for shapes
 * this small — both charts are hand-rolled SVG — so this follows that.
 *
 * ## Why the parser is not a `split(',')`
 *
 * A single remark containing a comma is enough to break every column after it, and the
 * damage is invisible until someone opens the file. The awkward cases are all real:
 *
 *   - a comma or newline inside a quoted field
 *   - `""` inside a quoted field meaning one literal quote
 *   - CRLF and LF mixed in one file (Excel writes CRLF, this app writes LF)
 *   - a file with no trailing newline (very common)
 *
 * Each of those has a test. The exporter writes `\n`; the parser accepts both.
 */

/** Wraps a field in quotes only when it needs them, doubling any inner quotes. */
export function encodeCsvField(value: string): string {
  // A leading `=`/`+`/`-`/`@` is a spreadsheet formula-injection vector. Prefixing with a
  // single quote is the conventional neutraliser and Excel hides it.
  const needsFormulaGuard = /^[=+\-@]/.test(value);
  const guarded = needsFormulaGuard ? `'${value}` : value;

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** One CSV document from a header row plus data rows. Rows are joined with `\n`. */
export type CsvRow = readonly string[];

export function encodeCsv(rows: readonly CsvRow[]): string {
  return rows.map((row) => row.map(encodeCsvField).join(',')).join('\n');
}

/**
 * One CSV document as a UTF-8 string **with a BOM**.
 *
 * The BOM is the whole reason a Chinese export opens correctly in Excel: without it,
 * Windows Excel decodes the bytes using the local ANSI code page and every Chinese
 * character becomes garbage. It is a deliberate wart — some Unix tools show the BOM as
 * part of the first field — and it is the right trade because the destination is Excel.
 */
export function encodeCsvWithBom(rows: readonly CsvRow[]): string {
  return `\uFEFF${encodeCsv(rows)}`;
}

/**
 * Parses CSV text into rows of fields.
 *
 * A character-by-character state machine rather than `split`, because a quoted field may
 * contain the delimiter and the line terminator. The BOM, if present, is stripped.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM so the first header cell is not "\uFEFFid".
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  /** Finishes the current field and pushes the row when the line ends. */
  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index] as string;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      // Only meaningful at the start of a field; mid-field it is a literal quote.
      if (field === '') {
        inQuotes = true;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === ',') {
      endField();
      index += 1;
      continue;
    }

    if (char === '\r') {
      // CRLF or a lone CR both terminate the record.
      endRow();
      index += input[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // A file without a trailing newline still has a final row. An input that ended exactly
  // on a newline produced an empty trailing row above — drop only that one.
  const endedOnNewline = input.endsWith('\n') || input.endsWith('\r');
  if (!endedOnNewline) {
    endRow();
  } else if (row.length > 0 || field !== '') {
    endRow();
  }

  return rows;
}

/**
 * `parseCsv` with the first row treated as a header.
 *
 * Every row is returned as a name→value record. Rows with a different field count than
 * the header are reported rather than silently padded, because a misaligned row means the
 * file is malformed and guessing which column shifted is how data lands in the wrong field.
 */
export interface CsvRecords {
  readonly header: readonly string[];
  readonly records: Record<string, string>[];
}

export function parseCsvWithHeader(text: string): CsvRecords {
  const rows = parseCsv(text).filter(
    (row) => !(row.length === 1 && (row[0] ?? '').trim() === ''),
  );
  const header = rows[0] ?? [];
  const records: Record<string, string>[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] as string[];
    if (row.length !== header.length) {
      throw new Error(
        `Row ${index + 1} has ${row.length} column(s) but the header has ${header.length}.`,
      );
    }
    const record: Record<string, string> = {};
    for (let column = 0; column < header.length; column += 1) {
      record[header[column] as string] = row[column] ?? '';
    }
    records.push(record);
  }

  return { header, records };
}
