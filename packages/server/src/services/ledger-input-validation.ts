import { ValidationError } from './transaction-errors.js';

const MIN_DATE_MS = Date.UTC(2000, 0, 1);
const FUTURE_SLACK_MS = 86_400_000;

/** Salary and transfer amounts share this exact positive safe-integer contract. */
export function requirePositiveSafeIntegerCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('amountCents must be a positive integer number of cents.');
  }
  return value;
}

/** Validate salary/transfer dates without reading the clock for malformed or old values. */
export function requireLedgerDate(value: unknown, now: () => number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('date must be an epoch-millisecond timestamp.');
  }
  if (value < MIN_DATE_MS) throw new ValidationError('date is before the year 2000.');
  if (value > now() + FUTURE_SLACK_MS) {
    throw new ValidationError('date is in the future.');
  }
  return value;
}
