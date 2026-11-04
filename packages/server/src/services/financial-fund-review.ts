import { allocateFundIncomeCents, validateFinancialRatiosBps, type FundAmounts, type FundRatiosBps } from '@jizhang/shared';
import type { Db } from '../db/index.js';
import { FinancialInvalidError, FinancialNotFoundError, FinancialRevisionConflictError, FinancialSourceChangedError, FinancialUnavailableError } from './financial-errors.js';
import { canonicalFinancialPayload, requireFinancialOperationId, runFinancialOperation, type FinancialOperationResult } from './financial-operation-store.js';
import { FINANCIAL_LIMITS, salarySourceToken } from './financial-planning-types.js';

/** Reconfirmation only. expectedRevision is the existing grant revision, not config revision. */
export interface LegacyFundGrantReview {
  readonly actorId: string;
  readonly operationId: string;
  readonly grantId: string;
  readonly expectedRevision: number;
  readonly ratiosBps: FundRatiosBps;
  readonly sources: readonly { readonly salaryId: string; readonly expectedSourceToken: string }[];
}
export interface LegacyFundGrantReviewResult {
  readonly grantId: string;
  readonly revision: number;
  readonly sourceAmountCents: number;
  readonly ratiosBps: FundRatiosBps;
  readonly targets: FundAmounts;
  readonly sources: readonly { readonly salaryId: string; readonly amountCents: number; readonly date: number; readonly accountId: string; readonly sourceToken: string; readonly confirmedAt: number }[];
}
type SourceSnapshot = LegacyFundGrantReviewResult['sources'][number];type Member = { salary_id: string; source_token: string; amount_cents: number; date: number; account_id: string; status: string };
type Salary = { id: string; amount_cents: number; date: number; account_id: string; deleted: number };
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const safe = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function changed(): never { throw new FinancialSourceChangedError('The grant sources or frozen ratios changed; refresh the review.'); }
function invalid(message: string): never { throw new FinancialInvalidError(message); }
function parseSaved(text: string): unknown { try { return JSON.parse(text) as unknown; } catch { throw new FinancialUnavailableError(); } }
function savedRatios(value: unknown): FundRatiosBps { try { return validateFinancialRatiosBps(value); } catch { throw new FinancialUnavailableError(); } }
function selectedRatios(value: unknown): FundRatiosBps { try { return validateFinancialRatiosBps(value); } catch { return invalid('Explicit valid ratios are required.'); } }
function snapshot(value: unknown): value is SourceSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  return nonempty(s['salaryId']) && safe(s['amountCents']) && s['amountCents'] > 0 && safe(s['date']) &&
    nonempty(s['accountId']) && nonempty(s['sourceToken']) && safe(s['confirmedAt']);
}

/**
 * One IMMEDIATE transaction replays first or reconfirms exactly the existing legacy group.
 * Ratios and membership cannot be replaced. Source tokens cover amount, date and account.
 * This function does not own salary lifecycle invalidation or expose an HTTP endpoint.
 *
 * `storeResponse` wraps the committed payload **for persistence only**: a lost
 * response is recovered through the operation lookup, so the stored body has to be
 * the original HTTP body rather than a bare grant. The caller still receives the
 * grant itself, and records written before the fix (bare grant) keep replaying.
 */
export function reviewLegacyFundGrant(
  db: Db,
  input: LegacyFundGrantReview,
  now: number,
  storeResponse: (grant: LegacyFundGrantReviewResult) => unknown = (grant) => grant,
): FinancialOperationResult<LegacyFundGrantReviewResult> {
  const operationId = requireFinancialOperationId(input.operationId);
  const stored = runFinancialOperation<unknown>(db, { operationId, actorId: input.actorId, method: 'POST',
    resource: '/api/v1/financial-funds/grants/review', canonicalPayload: input, now }, () => {
    if (!nonempty(input.actorId) || !nonempty(input.grantId) || !safe(input.expectedRevision) || input.expectedRevision < 1 || !safe(now)) invalid('Invalid review identity or revision.');
    const ratios = selectedRatios(input.ratiosBps);
    if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > FINANCIAL_LIMITS.selectedSources) invalid('Explicit bounded source references are required.');
    const refs = new Map<string, string>();
    for (const ref of input.sources) {
      if (ref === null || typeof ref !== 'object' || !nonempty(ref.salaryId) || !nonempty(ref.expectedSourceToken) || refs.has(ref.salaryId)) invalid('Source references must be unique and include tokens.');
      refs.set(ref.salaryId, ref.expectedSourceToken);
    }
    const grantRow = db.prepare('SELECT origin_kind,active_revision,status FROM financial_fund_grants WHERE id=?').get(input.grantId) as { origin_kind: string; active_revision: number; status: string } | undefined;
    if (grantRow === undefined) throw new FinancialNotFoundError();
    if (grantRow.origin_kind !== 'legacy-group') invalid('Only existing legacy aggregate grants can be reconfirmed.');
    if (grantRow.active_revision !== input.expectedRevision) throw new FinancialRevisionConflictError('The grant revision changed; refresh the review.');
    if (!safe(grantRow.active_revision) || grantRow.active_revision >= Number.MAX_SAFE_INTEGER || !['active', 'review-required'].includes(grantRow.status)) throw new FinancialUnavailableError();
    const old = db.prepare('SELECT source_amount_cents,ratios_json,targets_json,sources_json FROM financial_fund_grant_revisions WHERE grant_id=? AND revision=?').get(input.grantId, grantRow.active_revision) as { source_amount_cents: number; ratios_json: string; targets_json: string; sources_json: string } | undefined;
    if (old === undefined || !safe(old.source_amount_cents) || old.source_amount_cents === 0) throw new FinancialUnavailableError();
    const frozenRatios = savedRatios(parseSaved(old.ratios_json));
    if (canonicalFinancialPayload(ratios) !== canonicalFinancialPayload(frozenRatios)) changed();
    if (canonicalFinancialPayload(parseSaved(old.targets_json)) !== canonicalFinancialPayload(allocateFundIncomeCents(old.source_amount_cents, frozenRatios))) throw new FinancialUnavailableError();
    const raw = parseSaved(old.sources_json);
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every(snapshot)) throw new FinancialUnavailableError();
    const frozen: SourceSnapshot[] = raw;
    const members = db.prepare('SELECT salary_id,source_token,amount_cents,date,account_id,status FROM financial_fund_grant_sources WHERE grant_id=?').all(input.grantId) as Member[];
    if (members.length !== frozen.length || refs.size !== frozen.length || new Set(frozen.map((s) => s.salaryId)).size !== frozen.length) changed();
    let oldTotal = 0n; let total = 0n;
    const sources: SourceSnapshot[] = [];
    for (const prior of frozen) {
      const member = members.find((m) => m.salary_id === prior.salaryId);
      if (member === undefined || !refs.has(prior.salaryId) || member.source_token !== prior.sourceToken || member.amount_cents !== prior.amountCents || member.date !== prior.date || member.account_id !== prior.accountId || !['active', 'review-required'].includes(member.status)) changed();
      oldTotal += BigInt(prior.amountCents);
      const live = db.prepare('SELECT id,amount_cents,date,account_id,deleted FROM salary_records WHERE id=?').get(prior.salaryId) as Salary | undefined;
      if (live === undefined || live.deleted !== 0 || !safe(live.amount_cents) || live.amount_cents === 0 || !safe(live.date) || !nonempty(live.account_id)) changed();
      const token = salarySourceToken(live);
      if (refs.get(prior.salaryId) !== token) changed();
      total += BigInt(live.amount_cents);
      sources.push({ salaryId: live.id, amountCents: live.amount_cents, date: live.date, accountId: live.account_id, sourceToken: token, confirmedAt: now });
    }
    if (oldTotal !== BigInt(old.source_amount_cents)) throw new FinancialUnavailableError();
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new FinancialUnavailableError();
    const sourceAmountCents = Number(total);
    const targets = allocateFundIncomeCents(sourceAmountCents, frozenRatios);
    const revision = grantRow.active_revision + 1;
    db.prepare('INSERT INTO financial_fund_grant_revisions VALUES (?,?,?,?,?,?,?,?,?,?)').run(input.grantId, revision, sourceAmountCents, JSON.stringify(frozenRatios), JSON.stringify(targets), JSON.stringify(sources), input.actorId, operationId, now, 'legacy-source-review');
    const update = db.prepare("UPDATE financial_fund_grant_sources SET source_token=?,amount_cents=?,date=?,account_id=?,status='active' WHERE salary_id=? AND grant_id=?");
    for (const s of sources) {
      if (update.run(s.sourceToken, s.amountCents, s.date, s.accountId, s.salaryId, input.grantId).changes !== 1) changed();
      db.prepare("UPDATE financial_fund_migration_issues SET status='resolved' WHERE source_kind='salary' AND source_id=? AND reason='unallocated' AND status='open'").run(s.salaryId);
    }
    db.prepare("UPDATE financial_fund_grants SET active_revision=?,status='active' WHERE id=?").run(revision, input.grantId);
    const grant: LegacyFundGrantReviewResult = { grantId: input.grantId, revision, sourceAmountCents, ratiosBps: frozenRatios, targets, sources };
    return { statusCode: 200, response: storeResponse(grant) };
  });
  // A record written by an older build holds the bare grant. It replays as stored and
  // is never rewritten here, so exact history survives the envelope change.
  const replay = stored.response as Record<string, unknown> | null;
  const bare = replay !== null && typeof replay === 'object' && 'grantId' in replay;
  return {
    statusCode: stored.statusCode,
    response: (bare ? replay : (replay?.['grant'] as LegacyFundGrantReviewResult | undefined)) as LegacyFundGrantReviewResult,
  };
}
