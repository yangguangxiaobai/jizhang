/**
 * Money formatting and parsing.
 *
 * The whole app stores integer cents (parent task AC6), so anything user-facing has
 * to convert at the edges — and only here. `formatCents` does integer arithmetic
 * rather than `cents / 100` + `toFixed`, because the float round-trip is exactly how
 * `19.99` turns into `19.99` in one place and `19.989999` in another.
 */

/** `1999` → `"19.99"`. Always two decimals, minus sign preserved. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const yuan = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${yuan}.${fraction}`;
}

/** `1999` → `"¥19.99"`. */
export function formatYuan(cents: number): string {
  return `¥${formatCents(cents)}`;
}

/**
 * Parses a user-entered yuan string into cents.
 *
 * Returns `null` for anything that is not a positive, finite amount. The `Math.round`
 * is load-bearing: `19.99 * 100 === 1998.9999999999998` (parent task AC6).
 */
export function parseYuanToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return cents > 0 ? cents : null;
}

/** Parses an optional non-negative amount; unlike transaction amounts, zero is valid for an item. */
export function parseOptionalYuanToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Integer-cents sum, so a list total cannot drift through float addition. */
export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + Math.trunc(value), 0);
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** `"2026-08-03"` in the browser's local timezone (dates are stored as epoch ms). */
export function toDateInputValue(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `"2026-08-03"` → epoch ms at local midnight.
 *
 * Parsed component-by-component instead of `new Date(string)`: the string form is
 * interpreted as UTC, which shifts the date by a day for anyone west of Greenwich.
 */
export function fromDateInputValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day).getTime();
}

/** `"8月3日 周一"` — compact, for list rows. */
export function formatDayLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAYS[date.getDay()]}`;
}

/** `"2026年8月"` — month section header. */
export function formatMonthLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

/** `year * 100 + month`, matching the budget engine's grouping key. */
export function monthKeyOf(epochMs: number): number {
  const date = new Date(epochMs);
  return date.getFullYear() * 100 + (date.getMonth() + 1);
}

/** First instant of the month containing `epochMs`, local time. */
export function startOfMonth(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** First instant of the next month. */
export function startOfNextMonth(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

/** Shifts by whole months, clamping the day to the target month's length. */
export function addMonths(epochMs: number, delta: number): number {
  const date = new Date(epochMs);
  const target = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    Math.min(date.getDate(), lastDay),
  ).getTime();
}
