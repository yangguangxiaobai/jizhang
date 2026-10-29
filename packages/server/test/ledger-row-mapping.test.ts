import { describe, expect, it } from 'vitest';
import { mapLedgerTransactionRow } from '../src/services/ledger-row-mapping.js';
import {
  ConflictError as DirectConflictError,
  NotFoundError as DirectNotFoundError,
  ValidationError as DirectValidationError,
} from '../src/services/transaction-errors.js';
import {
  ConflictError as LegacyConflictError,
  NotFoundError as LegacyNotFoundError,
  ValidationError as LegacyValidationError,
} from '../src/services/transaction-service.js';

describe('ledger row projection', () => {
  it('maps shared ledger fields and treats only the stored integer 1 as refund', () => {
    const row = {
      id: 'transaction-1',
      type: 1,
      amount_cents: 3_000,
      category_id: 'category-1',
      date: 1_700_000_000_000,
      is_refund: 1,
    };
    expect(mapLedgerTransactionRow(row)).toEqual({
      id: 'transaction-1',
      type: 1,
      amountCents: 3_000,
      categoryId: 'category-1',
      date: 1_700_000_000_000,
      isRefund: true,
    });
    expect(mapLedgerTransactionRow({ ...row, is_refund: 0 }).isRefund).toBe(false);
    expect(mapLedgerTransactionRow({ ...row, is_refund: 2 }).isRefund).toBe(false);
  });
});

describe('transaction error compatibility', () => {
  it('keeps the same constructors and error metadata at both import paths', () => {
    expect(LegacyValidationError).toBe(DirectValidationError);
    expect(LegacyNotFoundError).toBe(DirectNotFoundError);
    expect(LegacyConflictError).toBe(DirectConflictError);
    expect(new LegacyValidationError('invalid')).toMatchObject({
      name: 'ValidationError', statusCode: 400, code: 'VALIDATION', message: 'invalid',
    });
    expect(new LegacyNotFoundError()).toMatchObject({
      name: 'NotFoundError', statusCode: 404, code: 'NOT_FOUND', message: 'Transaction not found.',
    });
    expect(new LegacyConflictError('conflict')).toMatchObject({
      name: 'ConflictError', statusCode: 409, code: 'CONFLICT', message: 'conflict',
    });
  });
});
