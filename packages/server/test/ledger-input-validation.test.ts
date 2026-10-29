import { describe, expect, it, vi } from 'vitest';
import {
  requireLedgerDate,
  requirePositiveSafeIntegerCents,
} from '../src/services/ledger-input-validation.js';
import { ValidationError } from '../src/services/transaction-errors.js';

describe('salary and transfer input validation', () => {
  it('accepts only positive safe integer cents with the existing error', () => {
    expect(requirePositiveSafeIntegerCents(1)).toBe(1);
    expect(requirePositiveSafeIntegerCents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(() => requirePositiveSafeIntegerCents(value)).toThrowError(
        new ValidationError('amountCents must be a positive integer number of cents.'),
      );
    }
  });

  it('keeps date boundaries, fractional timestamps and clock evaluation order', () => {
    const minimum = Date.UTC(2000, 0, 1);
    const now = vi.fn(() => minimum + 1_000);
    for (const value of [null, '1', NaN, Infinity]) {
      expect(() => requireLedgerDate(value, now)).toThrow('date must be an epoch-millisecond timestamp.');
    }
    expect(() => requireLedgerDate(minimum - 1, now)).toThrow('date is before the year 2000.');
    expect(now).not.toHaveBeenCalled();
    expect(requireLedgerDate(minimum + 0.5, now)).toBe(minimum + 0.5);
    expect(requireLedgerDate(minimum + 1_000 + 86_400_000, now)).toBe(minimum + 1_000 + 86_400_000);
    expect(() => requireLedgerDate(minimum + 1_000 + 86_400_001, now)).toThrow('date is in the future.');
    expect(now).toHaveBeenCalledTimes(3);
  });
});
