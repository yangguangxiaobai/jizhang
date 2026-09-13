/**
 * Data portability: CSV export/import and the backup listing (T15).
 *
 * ## Why the file is CSV and not a database dump
 *
 * `cli.js backup` already snapshots the whole database, and that is the right format for
 * restoration. It is useless for the other two things a person wants: checking their
 * figures in Excel, and moving their ledger somewhere new. A binary SQLite file fails
 * both, so this module produces text a spreadsheet can open.
 *
 * ## Three decisions worth knowing before changing anything here
 *
 * 1. **Deduplication keys on the exported `id`.** A natural key (date + amount + note)
 *    would treat two identical coffees on one day as one bill and drop a real row. Losing
 *    data is the one failure this feature must not have.
 * 2. **Import is all-or-nothing, in one transaction.** Failures here almost always mean
 *    the file is wrong, not that row 37 happens to be wrong, and a half-imported ledger is
 *    harder to reason about than a rejected one.
 * 3. **An unknown category or account name fails the import** rather than being created on
 *    the fly or the row being skipped. Silently inventing master data would pollute a
 *    table the user curates, and silently dropping a row would lose money.
 *
 * Encoding is UTF-8 **with a BOM**: without it Windows Excel decodes the bytes using the
 * local code page and every Chinese character is garbage. `packages/shared/src/csv.ts`
 * owns the escaping rules.
 */
import { basename, join } from 'node:path';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import {
  encodeCsvWithBom,
  formatCents,
  parseCsvWithHeader,
  type CsvRow,
} from '@jizhang/shared';
import { createBackup } from '../cli-db.js';
import type { Db } from '../db/index.js';
import { ValidationError } from './transaction-service.js';

/** The columns of the transactions export. Order is the file's contract. */
export const TRANSACTION_COLUMNS = [
  'id',
  'date',
  'type',
  'amount',
  'category',
  'account',
  'note',
  'tags',
  'isRefund',
] as const;

/**
 * The columns of the salaries export.
 *
 * `account` mirrors the transactions export: a salary now lands in an account, and a
 * CSV-only backup that dropped that column would not be able to say where the money went.
 * The file is export-only (there is no salary importer), so extending it is additive.
 */
export const SALARY_COLUMNS = ['id', 'date', 'amount', 'account', 'note', 'allocations'] as const;
export const RECURRING_COLUMNS = [
  'id',
  'name',
  'type',
  'amount',
  'category',
  'frequency',
  'anchorDate',
  'nextDueDate',
  'enabled',
  'hasOlderDue',
] as const;

export interface ImportResult {
  /** Rows inserted by this call. */
  readonly inserted: number;
  /** Rows already present, matched by `id`. */
  readonly skipped: number;
  /** Data rows read from the file. */
  readonly total: number;
}

export interface BackupFileDto {
  /** File name only — never the host path, which is both useless here and a leak. */
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly createdAtMs: number;
}

export interface PortabilityServiceOptions {
  readonly dataDir: string;
  readonly now?: (() => number) | undefined;
}

/** `"2026-09-11"` in LOCAL time — the same convention the app's date inputs use. */
function dateOnlyLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Parses `"2026-09-11"` back to local midnight.
 *
 * Component-by-component, NOT `new Date(string)`: the string form is parsed as UTC, which
 * shifts every date by a day for anyone not on UTC. That bug has appeared in this project
 * before, which is why the parsing lives here rather than inline.
 */
function parseDateLabel(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Rejects "2026-02-31", which `new Date` would silently roll into March.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

/** `"19.99"` → `1999`. Rejects anything that is not a non-negative decimal. */
function parseAmountToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export class PortabilityService {
  private readonly db: Db;
  private readonly dataDir: string;

  constructor(db: Db, options: PortabilityServiceOptions) {
    this.db = db;
    this.dataDir = options.dataDir;
  }

  /** `<dataDir>/backups`, matching what `cli.js backup` writes to by default. */
  private backupsDir(): string {
    return join(this.dataDir, 'backups');
  }

  // ── export ─────────────────────────────────────────────────────────────────

  private nameMap(table: 'categories' | 'accounts'): Map<string, string> {
    const map = new Map<string, string>();
    // Soft-deleted rows are included: a historical bill must still be labelled with the
    // category it was filed under, exactly as the budget page does.
    for (const row of this.db.prepare(`SELECT id, name FROM ${table}`).all() as {
      id: string;
      name: string;
    }[]) {
      map.set(row.id, row.name);
    }
    return map;
  }

  exportTransactionsCsv(): string {
    const categories = this.nameMap('categories');
    const accounts = this.nameMap('accounts');
    const rows: CsvRow[] = [[...TRANSACTION_COLUMNS]];

    const query = this.db
      .prepare(
        `SELECT id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund
           FROM transactions
          WHERE deleted = 0
          ORDER BY date, updated_at, id`,
      )
      .all() as {
      id: string;
      type: number;
      amount_cents: number;
      category_id: string;
      account_id: string;
      date: number;
      note: string;
      tags_json: string;
      is_refund: number;
    }[];

    for (const row of query) {
      let tags: string[] = [];
      try {
        const decoded: unknown = JSON.parse(row.tags_json);
        if (Array.isArray(decoded)) tags = decoded.filter((t): t is string => typeof t === 'string');
      } catch {
        // A malformed tag blob must not abort an export.
        tags = [];
      }

      rows.push([
        row.id,
        dateOnlyLabel(row.date),
        // Human-readable rather than 0/1: this file is meant to be read.
        row.type === 0 ? 'expense' : 'income',
        // Always a non-negative magnitude; direction comes from type + isRefund, which is
        // what keeps the net-expense rule reproducible outside the app.
        formatCents(row.amount_cents),
        categories.get(row.category_id) ?? row.category_id,
        accounts.get(row.account_id) ?? row.account_id,
        row.note,
        // `|` rather than a comma: a comma would need quoting and is harder to read here.
        tags.join('|'),
        row.is_refund === 1 ? 'true' : 'false',
      ]);
    }

    return encodeCsvWithBom(rows);
  }

  exportSalariesCsv(): string {
    const accounts = this.nameMap('accounts');
    const rows: CsvRow[] = [[...SALARY_COLUMNS]];
    const salaries = this.db
      .prepare(
        'SELECT id, amount_cents, date, note, account_id FROM salary_records WHERE deleted = 0 ORDER BY date, id',
      )
      .all() as {
      id: string;
      amount_cents: number;
      date: number;
      note: string;
      account_id: string;
    }[];

    for (const salary of salaries) {
      const allocation = this.db
        .prepare(
          'SELECT allocations_json FROM budget_allocations WHERE salary_record_id = ? AND deleted = 0',
        )
        .get(salary.id) as { allocations_json: string } | undefined;

      rows.push([
        salary.id,
        dateOnlyLabel(salary.date),
        formatCents(salary.amount_cents),
        // Names, not ids: the file is meant to be read by a person, and a UUID cannot be
        // checked by eye. Same rule as the transactions export.
        accounts.get(salary.account_id) ?? salary.account_id,
        salary.note,
        allocation?.allocations_json ?? '',
      ]);
    }

    return encodeCsvWithBom(rows);
  }

  exportRecurringCsv(): string {
    const categories = this.nameMap('categories');
    const rows: CsvRow[] = [[...RECURRING_COLUMNS]];
    const rules = this.db
      .prepare('SELECT * FROM recurring_rules WHERE deleted = 0 ORDER BY rowid')
      .all() as {
      id: string;
      name: string;
      type: number;
      amount_cents: number;
      category_id: string;
      frequency: string;
      anchor_date: number;
      next_due_date: number;
      enabled: number;
      has_older_due: number;
    }[];

    for (const rule of rules) {
      rows.push([
        rule.id,
        rule.name,
        rule.type === 0 ? 'expense' : 'income',
        formatCents(rule.amount_cents),
        categories.get(rule.category_id) ?? rule.category_id,
        rule.frequency,
        dateOnlyLabel(rule.anchor_date),
        dateOnlyLabel(rule.next_due_date),
        rule.enabled === 1 ? 'true' : 'false',
        rule.has_older_due === 1 ? 'true' : 'false',
      ]);
    }

    return encodeCsvWithBom(rows);
  }

  // ── import ─────────────────────────────────────────────────────────────────

  /**
   * Imports a transactions CSV produced by `exportTransactionsCsv`.
   *
   * All-or-nothing. A validation failure on any row rejects the whole file with the row
   * number and reason, so the user can fix the file rather than reconcile a partial import.
   */
  importTransactionsCsv(csvText: string): ImportResult {
    let parsed;
    try {
      parsed = parseCsvWithHeader(csvText);
    } catch (error) {
      throw new ValidationError(
        `The file could not be read as CSV: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const missing = TRANSACTION_COLUMNS.filter(
      (column) => !parsed.header.includes(column),
    );
    if (missing.length > 0) {
      throw new ValidationError(
        `The file is missing required column(s): ${missing.join(', ')}. ` +
          'Export a file from this app to see the expected header.',
      );
    }

    const categories = new Map<string, string>();
    for (const row of this.db.prepare('SELECT id, name FROM categories WHERE deleted = 0').all() as {
      id: string;
      name: string;
    }[]) {
      // Names are not unique in the schema, so the first wins; a duplicate name would make
      // the mapping ambiguous, which is why the export writes names the user can verify.
      if (!categories.has(row.name)) categories.set(row.name, row.id);
    }
    const accounts = new Map<string, string>();
    for (const row of this.db.prepare('SELECT id, name FROM accounts WHERE deleted = 0').all() as {
      id: string;
      name: string;
    }[]) {
      if (!accounts.has(row.name)) accounts.set(row.name, row.id);
    }

    const existingIds = new Set(
      (this.db.prepare('SELECT id FROM transactions').all() as { id: string }[]).map((r) => r.id),
    );

    interface Pending {
      readonly id: string;
      readonly type: number;
      readonly amountCents: number;
      readonly categoryId: string;
      readonly accountId: string;
      readonly date: number;
      readonly note: string;
      readonly tags: string[];
      readonly isRefund: boolean;
    }

    const pendingRows: Pending[] = [];
    let skipped = 0;

    parsed.records.forEach((record, index) => {
      // 1-based, and +1 for the header row, so the number matches what a spreadsheet shows.
      const line = index + 2;
      const id = (record['id'] ?? '').trim();
      if (id === '') throw new ValidationError(`Line ${line}: id is empty.`);

      if (existingIds.has(id)) {
        skipped += 1;
        return;
      }

      const date = parseDateLabel(record['date'] ?? '');
      if (date === null) {
        throw new ValidationError(
          `Line ${line}: date must be YYYY-MM-DD (got "${record['date'] ?? ''}").`,
        );
      }

      const typeLabel = (record['type'] ?? '').trim();
      if (typeLabel !== 'expense' && typeLabel !== 'income') {
        throw new ValidationError(
          `Line ${line}: type must be expense or income (got "${typeLabel}").`,
        );
      }

      const amountCents = parseAmountToCents(record['amount'] ?? '');
      if (amountCents === null || amountCents <= 0) {
        throw new ValidationError(
          `Line ${line}: amount must be a positive number with at most 2 decimals (got "${record['amount'] ?? ''}").`,
        );
      }

      const categoryName = (record['category'] ?? '').trim();
      const categoryId = categories.get(categoryName);
      if (categoryId === undefined) {
        // Not created on the fly and not skipped: the user names it, so the user can fix it.
        throw new ValidationError(
          `Line ${line}: unknown category "${categoryName}". Create it first, or correct the file.`,
        );
      }

      const accountName = (record['account'] ?? '').trim();
      const accountId = accounts.get(accountName);
      if (accountId === undefined) {
        throw new ValidationError(
          `Line ${line}: unknown account "${accountName}". Create it first, or correct the file.`,
        );
      }

      const refundLabel = (record['isRefund'] ?? '').trim().toLowerCase();
      if (refundLabel !== 'true' && refundLabel !== 'false' && refundLabel !== '') {
        throw new ValidationError(
          `Line ${line}: isRefund must be true or false (got "${record['isRefund'] ?? ''}").`,
        );
      }

      const tags = (record['tags'] ?? '')
        .split('|')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== '');

      pendingRows.push({
        id,
        type: typeLabel === 'expense' ? 0 : 1,
        amountCents,
        categoryId,
        accountId,
        date,
        note: record['note'] ?? '',
        tags,
        isRefund: refundLabel === 'true',
      });
    });

    // ONE transaction: either the whole file lands or none of it does.
    const at = Date.now();
    const insert = this.db.prepare(
      `INSERT INTO transactions
         (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );
    const insertMany = this.db.transaction((rows: readonly Pending[]) => {
      for (const row of rows) {
        insert.run(
          row.id,
          row.type,
          row.amountCents,
          row.categoryId,
          row.accountId,
          row.date,
          row.note,
          JSON.stringify(row.tags),
          row.isRefund ? 1 : 0,
          at,
        );
      }
    });
    insertMany(pendingRows);

    return { inserted: pendingRows.length, skipped, total: parsed.records.length };
  }

  // ── backups ────────────────────────────────────────────────────────────────

  /**
   * Lists existing archives, newest first.
   *
   * Returns file names only. The host path is not useful to a client that cannot read the
   * filesystem, and exposing it leaks deployment detail.
   */
  listBackups(): BackupFileDto[] {
    const dir = this.backupsDir();
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // No backups yet is a normal state, not an error.
      return [];
    }

    return entries
      .filter((name) => name.endsWith('.db'))
      .map((name) => {
        const stats = statSync(join(dir, name));
        return {
          fileName: basename(name),
          sizeBytes: stats.size,
          createdAtMs: stats.mtimeMs,
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  /** Takes an archive and returns the new entry. Reuses the CLI's own backup routine. */
  createBackupNow(): BackupFileDto {
    const dir = this.backupsDir();
    mkdirSync(dir, { recursive: true });

    const dbFile = join(this.dataDir, 'jizhang.db');
    const result = createBackup(dbFile, dir, 30);

    const stats = statSync(result.file);
    return {
      fileName: basename(result.file),
      sizeBytes: stats.size,
      createdAtMs: stats.mtimeMs,
    };
  }
}
