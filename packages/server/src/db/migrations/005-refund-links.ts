/**
 * Migration 005 — refund-to-original-expense links.
 *
 * A refund row carries `is_refund = 1` on the transactions table, but that flag
 * alone does not say *which* original expense it offsets. This table records that
 * relationship so a user can trace a refund back to the bill(s) it reimburses.
 *
 * One refund can link to many originals (partial refunds across several bills),
 * and one original can be linked from many refunds (returned part of an order twice).
 *
 * No foreign keys, matching the rest of the money tables: a soft-deleted expense's
 * refund history must stay readable. The application validates existence at write
 * time instead.
 */
export const MIGRATION_005_REFUND_LINKS = `
-- One row connects a refund transaction to one original expense.
CREATE TABLE refund_links (
  id              TEXT    PRIMARY KEY,
  refund_tx_id    TEXT    NOT NULL,
  original_tx_id  TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

-- "Which originals does this refund cover?" — answered once per refund.
CREATE INDEX idx_refund_links_refund   ON refund_links(refund_tx_id);

-- "Has this expense been refunded?" — answered once per original.
CREATE INDEX idx_refund_links_original ON refund_links(original_tx_id);
`;
