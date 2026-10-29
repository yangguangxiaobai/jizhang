import type { Transaction } from '@jizhang/shared';

export interface LedgerTransactionRow {
  readonly id: string;
  readonly type: number;
  readonly amount_cents: number;
  readonly category_id: string;
  readonly date: number;
  readonly is_refund: number;
}

export function mapLedgerTransactionRow(row: LedgerTransactionRow): Transaction {
  return {
    id: row.id,
    type: row.type,
    amountCents: row.amount_cents,
    categoryId: row.category_id,
    date: row.date,
    isRefund: row.is_refund === 1,
  };
}
