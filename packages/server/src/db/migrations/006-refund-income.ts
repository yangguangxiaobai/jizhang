/**
 * Migration 006 — refunds become income-typed transactions.
 *
 * Old model: a refund was an EXPENSE row (type = 0) with `is_refund = 1`, counted as
 * NEGATIVE expense and never as income. New model (product decision): a refund is an
 * INCOME row (type = 1) that still carries `is_refund = 1`, counts as +income, and no
 * longer reduces expenses — the same money lands in a different bucket, so account
 * balances are unchanged.
 *
 * Every legacy refund row — INCLUDING soft-deleted (deleted = 1) trash rows — is
 * rewritten to the new type and filed under the new 「退款」 income category. The
 * original expense category is deliberately lost; `refund_links` preserves the trace
 * back to the original bills.
 *
 * Down-compat: rolling the code back leaves the database readable — old code reads an
 * income-typed refund as 0 expense AND 0 income (both contribution functions gate on
 * type), so the rows silently vanish from aggregates but stay listed, labelled, and
 * linked.
 */
import { paletteSlot, SEED_UPDATED_AT_MS } from '@jizhang/shared';

export const MIGRATION_006_REFUND_INCOME = `
-- ① The 退款 income category. Created HERE (not left to seed.ts) because the rewrite
--    below points existing refund rows at it, and seed.ts runs AFTER migrations on
--    boot, so it cannot have created the category yet on a pre-v6 database. The
--    WHERE NOT EXISTS guard keeps the migration idempotent and preserves any user
--    edits to the row. Values mirror the SEED_INCOME_CATEGORIES entry in
--    packages/shared/src/seed-data.ts (palette slot 9, SEED_UPDATED_AT_MS) — if you
--    change one, change the other.
INSERT INTO categories (id, name, type, icon, color, sort_order, is_builtin, deleted, updated_at)
SELECT 'builtin-income-refund', '退款', 1, 'refund', ${paletteSlot(9).argb}, 2, 1, 0, ${SEED_UPDATED_AT_MS}
 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'builtin-income-refund');

-- ② Old expense-typed refund rows become income rows under 退款. updated_at is NOT
--    bumped: this is a migration, not a user edit. The update matches zero rows on a
--    fresh database and is naturally idempotent on a retry.
UPDATE transactions
   SET type = 1, category_id = 'builtin-income-refund'
 WHERE is_refund = 1 AND type = 0;
`;
