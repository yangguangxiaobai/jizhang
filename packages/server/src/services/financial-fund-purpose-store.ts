import type { FundPurpose } from '@jizhang/shared';
import type { Db } from '../db/index.js';
import { FinancialInvalidError, FinancialRevisionConflictError } from './financial-errors.js';

/** Canonical purpose facts; absence is an unassigned decision at revision zero. */
export interface FundPurposeFacts {
  readonly purpose: FundPurpose | null;
  readonly revision: number;
  readonly source: string;
  readonly status: 'resolved' | 'unresolved';
}

export function readFundPurposeFacts(db: Db, id: string): FundPurposeFacts {
  const row = db.prepare('SELECT purpose,revision,source FROM financial_fund_purposes WHERE transaction_id=?').get(id) as
    { purpose: FundPurpose | null; revision: number; source: string } | undefined;
  const purpose = row?.purpose ?? null;
  return { purpose, revision: row?.revision ?? 0, source: row?.source ?? 'unresolved', status: purpose === null ? 'unresolved' : 'resolved' };
}

/** A legacy-only writer must not overwrite a decision it could not have read. */
export function assertFundPurposeRevision(
  current: Pick<FundPurposeFacts, 'revision' | 'source'>,
  expectedRevision: unknown,
  mode: 'canonical' | 'legacy',
): void {
  if (mode === 'legacy' && current.source === 'explicit' && expectedRevision === undefined) {
    throw new FinancialRevisionConflictError('This bill has a newer fund purpose. Reload with a client that supports fund purposes.');
  }
  if (mode === 'canonical' || expectedRevision !== undefined) {
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new FinancialInvalidError('expectedFundPurposeRevision must be a non-negative safe integer.');
    }
    if (current.revision !== expectedRevision) {
      throw new FinancialRevisionConflictError('The fund purpose revision is stale. Reload the bill and retry.');
    }
  }
}

/** Write canonical fact and event in the caller's transaction. */
export function writeFundPurpose(
  db: Db, id: string, purpose: FundPurpose | null, actorId: string | null,
  operationId: string | null, now: number, canonicalRequest: boolean,
): void {
  const existing = db.prepare('SELECT purpose,revision,source FROM financial_fund_purposes WHERE transaction_id=?').get(id) as
    { purpose: FundPurpose | null; revision: number; source: string } | undefined;
  // Never drop the explicit latch: independent legacy revisions cannot represent
  // all changes once the four-purpose protocol has touched this transaction.
  const source = canonicalRequest || existing?.source === 'explicit' ? 'explicit' : 'legacy-override';
  if (existing?.purpose === purpose && existing.source === source) return;
  const revision = (existing?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new FinancialInvalidError('Fund purpose revision is exhausted.');
  const evidence = JSON.stringify({ reason: purpose === null ? 'cleared' : 'explicit', input: canonicalRequest ? 'fundPurpose' : 'financialPurpose' });
  db.prepare(`INSERT INTO financial_fund_purposes (transaction_id,purpose,revision,source,evidence_json)
    VALUES (?,?,?,?,?) ON CONFLICT(transaction_id) DO UPDATE SET
    purpose=excluded.purpose,revision=excluded.revision,source=excluded.source,evidence_json=excluded.evidence_json`)
    .run(id, purpose, revision, source, evidence);
  db.prepare(`INSERT INTO financial_fund_purpose_events
    (transaction_id,revision,purpose,source,evidence_json,actor_id,operation_id,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, revision, purpose, source, evidence, actorId, operationId, now);
}
