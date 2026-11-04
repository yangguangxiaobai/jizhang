import type { Db } from '../index.js';
import { backfillFundHistory } from '../../services/financial-fund-store.js';

/** Additive facts only; balances remain derived and all legacy rows remain intact. */
export const MIGRATION_021_FOUR_PURPOSE_FUNDS = `
CREATE TABLE financial_fund_config_revisions (
  revision INTEGER PRIMARY KEY, ratios_json TEXT NOT NULL, time_zone TEXT NOT NULL,
  actor_id TEXT, operation_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE financial_fund_grants (
  id TEXT PRIMARY KEY, origin_kind TEXT NOT NULL, origin_ref TEXT NOT NULL,
  active_revision INTEGER NOT NULL, status TEXT NOT NULL,
  UNIQUE(origin_kind, origin_ref)
);
CREATE TABLE financial_fund_grant_revisions (
  grant_id TEXT NOT NULL, revision INTEGER NOT NULL, source_amount_cents INTEGER NOT NULL,
  ratios_json TEXT NOT NULL, targets_json TEXT NOT NULL, sources_json TEXT NOT NULL,
  actor_id TEXT, operation_id TEXT, created_at INTEGER NOT NULL, reason TEXT NOT NULL,
  PRIMARY KEY(grant_id, revision)
);
CREATE TABLE financial_fund_grant_sources (
  salary_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, source_token TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, date INTEGER NOT NULL, account_id TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX idx_fund_grant_sources_grant ON financial_fund_grant_sources(grant_id);
CREATE TABLE financial_fund_purposes (
  transaction_id TEXT PRIMARY KEY, purpose TEXT, revision INTEGER NOT NULL, source TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  CHECK (purpose IS NULL OR purpose IN ('growth','reserve','essentials','joy'))
);
CREATE TABLE financial_fund_purpose_events (
  transaction_id TEXT NOT NULL, revision INTEGER NOT NULL, purpose TEXT,
  source TEXT NOT NULL, evidence_json TEXT NOT NULL, actor_id TEXT, operation_id TEXT,
  created_at INTEGER NOT NULL, PRIMARY KEY(transaction_id, revision),
  CHECK (purpose IS NULL OR purpose IN ('growth','reserve','essentials','joy'))
);
CREATE TABLE financial_fund_migration_issues (
  source_kind TEXT NOT NULL, source_id TEXT NOT NULL, reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL, status TEXT NOT NULL,
  PRIMARY KEY(source_kind, source_id, reason)
);
`;

/** Called by the transactional runner; also exposed for explicit idempotency testing. */
export function backfillFourPurposeFunds(db: Db): void {
  backfillFundHistory(db);
}
