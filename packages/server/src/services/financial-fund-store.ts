import {
  allocateFinancialExecutionCents, validateFinancialExecutionConfig,
  resolveFinancialPurpose, resolveFinancialCycleWindow, validateFinancialRatiosBps,
  type FinancialMappingSnapshot, type FinancialWindow,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';
import { canonicalFinancialPayload } from './financial-operation-store.js';
import { groupMonthOf, requireTimeZone, salarySourceToken, type SalaryRow } from './financial-planning-types.js';

type Row = Record<string, unknown>;
interface PeriodRow {
  id: string; group_month: string; cycle_key: string; active_revision: number;
  revision_id: string | null; revision: number | null; revision_group: string | null;
  revision_cycle: string | null; window_json: string | null; decision_json: string | null;
  sources_json: string | null; confirmed_income_cents: number | null;
  config_revision: number | null; mapping_revision: number | null;
  actor_id: string | null; operation_id: string | null; created_at: number | null;
}
interface Membership { salary_id: string; revision: number; snapshot_json: string }
interface Snapshot { salaryId: string; amountCents: number; date: number; accountId: string; sourceToken: string; confirmedAt: number }
function object(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
}
function parse(text: string | null): unknown {
  try { return text === null ? null : JSON.parse(text) as unknown; } catch { return null; }
}
function safe(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function positive(value: unknown): value is number { return safe(value) && value > 0; }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function frozenWindow(value: unknown, groupMonth: string, cycleKey: string): FinancialWindow | null {
  const window = object(value);
  if (window === null || window['groupMonth'] !== groupMonth || window['cycleKey'] !== cycleKey ||
      !text(window['timeZone'])) return null;
  try {
    // Validate the entire frozen snapshot; never use the resolver to recompute its boundaries.
    return resolveFinancialCycleWindow({ cycle: { kind: 'natural-month' }, timeZone: window['timeZone'],
      groupMonth, salaries: [], existingWindow: window as unknown as FinancialWindow });
  } catch { return null; }
}
function snapshot(value: unknown): Snapshot | null {
  const x = object(value);
  if (x === null || !text(x['salaryId']) || !positive(x['amountCents']) || !safe(x['date']) ||
      !text(x['accountId']) || !text(x['sourceToken']) || !safe(x['confirmedAt'])) return null;
  return x as unknown as Snapshot;
}
function issue(db: Db, kind: string, id: string, reason: string, evidence: unknown): void {
  db.prepare(`INSERT OR IGNORE INTO financial_fund_migration_issues
    (source_kind,source_id,reason,evidence_json,status) VALUES (?,?,?,?, 'open')`)
    .run(kind, id, reason, JSON.stringify(evidence));
}
function initConfig(db: Db): void {
  const current = db.prepare('SELECT revision,ratios_json,time_zone,created_at FROM financial_fund_config_revisions ORDER BY revision DESC LIMIT 1').get() as {
    revision: number; ratios_json: string; time_zone: string; created_at: number;
  } | undefined;
  if (current !== undefined) {
    try {
      if (!safe(current.revision) || current.revision < 1 || !safe(current.created_at)) throw new Error('Invalid config metadata');
      validateFinancialRatiosBps(parse(current.ratios_json));
      requireTimeZone(current.time_zone);
    } catch {
      issue(db, 'fund-config', String(current.revision), 'invalid-current-config', { revision: current.revision });
    }
    return;
  }
  const config = db.prepare('SELECT * FROM financial_config_revisions ORDER BY revision DESC LIMIT 1').get() as {
    revision: number; enabled: number; ratios_json: string; essential_monthly_cents: number | null;
    target_months: number; cycle_json: string; time_zone: string; created_at: number;
  } | undefined;
  // No saved config means P04 must supply a virtual default using its injected timezone.
  if (config === undefined) return;
  // A previously observed corrupt config remains unavailable pending explicit review.
  if (db.prepare("SELECT 1 FROM financial_fund_migration_issues WHERE source_kind='config' AND reason='invalid-current-config' AND status='open'").get()) return;
  let ratios: ReturnType<typeof validateFinancialRatiosBps>;
  let zone: string;
  try {
    if (!safe(config.revision) || config.revision < 1 || !safe(config.created_at) ||
        (config.enabled !== 0 && config.enabled !== 1)) throw new Error('Invalid config metadata');
    const parsed = validateFinancialExecutionConfig({
      enabled: config.enabled === 1, ratiosBps: parse(config.ratios_json),
      essentialMonthlyCents: config.essential_monthly_cents, targetMonths: config.target_months,
      cycle: parse(config.cycle_json), timeZone: config.time_zone,
    });
    ratios = parsed.ratiosBps;
    zone = requireTimeZone(config.time_zone);
  } catch {
    // This issue distinguishes corruption from absent/virtual configuration for P04.
    issue(db, 'config', String(config.revision), 'invalid-current-config', { revision: config.revision });
    return;
  }
  db.prepare('INSERT INTO financial_fund_config_revisions VALUES (1,?,?,NULL,NULL,?)')
    .run(JSON.stringify(ratios), zone, config.created_at);
}
function importGroups(db: Db): void {
  const periods = db.prepare(`SELECT p.id,p.group_month,p.cycle_key,p.active_revision,
    r.id revision_id,r.revision,r.group_month revision_group,r.cycle_key revision_cycle,
    r.window_json,r.decision_json,r.sources_json,r.confirmed_income_cents,r.config_revision,
    r.mapping_revision,r.actor_id,r.operation_id,r.created_at
    FROM financial_periods p LEFT JOIN financial_period_revisions r
      ON r.period_id=p.id AND r.revision=p.active_revision ORDER BY p.id`).all() as PeriodRow[];
  const membersOf = db.prepare('SELECT salary_id,revision,snapshot_json FROM financial_period_sources WHERE period_id=? AND active=1 ORDER BY salary_id');
  const salaryOf = db.prepare('SELECT id,amount_cents,date,account_id,deleted,updated_at FROM salary_records WHERE id=?');
  for (const period of periods) {
    if (db.prepare("SELECT 1 FROM financial_fund_grants WHERE origin_kind='legacy-group' AND origin_ref=?").get(period.id)) continue;
    // An earlier failure is archival evidence, not permission to import on a later rerun.
    if (db.prepare("SELECT 1 FROM financial_fund_migration_issues WHERE source_kind='period' AND source_id=? AND reason='unverified-group'").get(period.id)) continue;
    const invalid = () => issue(db, 'period', period.id, 'unverified-group', { periodId: period.id, revision: period.active_revision });
    let writing = false;
    try {
      const decision = object(parse(period.decision_json));
      const window = frozenWindow(parse(period.window_json), period.group_month, period.cycle_key);
      const rawSources = parse(period.sources_json);
      const members = membersOf.all(period.id) as Membership[];
      if (!safe(period.active_revision) || period.active_revision < 1 || period.revision_id === null ||
          period.revision !== period.active_revision || period.group_month !== period.revision_group ||
          period.cycle_key !== period.revision_cycle || decision === null || window === null ||
          !safe(period.created_at) || !positive(decision['incomeCents']) ||
          decision['incomeCents'] !== period.confirmed_income_cents ||
          decision['configRevision'] !== period.config_revision || decision['mappingRevision'] !== period.mapping_revision ||
          !Array.isArray(rawSources) || rawSources.length === 0 || members.length !== rawSources.length) { invalid(); continue; }
      const zone = requireTimeZone(window['timeZone']);
      const ratios = validateFinancialRatiosBps(decision['ratiosBps']);
      const targets = allocateFinancialExecutionCents(decision['incomeCents'], ratios);
      const frozenTargets = object(decision['targets']);
      if (frozenTargets === null || (Object.keys(targets) as (keyof typeof targets)[]).some((key) => frozenTargets[key] !== targets[key])) { invalid(); continue; }
      const seen = new Set<string>();
      const snapshots: Snapshot[] = [];
      let sum = 0n;
      let valid = true;
      for (const raw of rawSources) {
        const s = snapshot(raw);
        if (s === null || seen.has(s.salaryId)) { valid = false; break; }
        seen.add(s.salaryId);
        const member = members.find((m) => m.salary_id === s.salaryId);
        const salary = salaryOf.get(s.salaryId) as SalaryRow | undefined;
        if (member === undefined || member.revision !== period.active_revision ||
            canonicalFinancialPayload(parse(member.snapshot_json)) !== canonicalFinancialPayload(raw) ||
            salary === undefined || salary.deleted !== 0 || !positive(salary.amount_cents) ||
            s.amountCents !== salary.amount_cents || s.date !== salary.date || s.accountId !== salary.account_id ||
            s.sourceToken !== salarySourceToken(salary) || groupMonthOf(s.date, zone) !== period.group_month ||
            db.prepare('SELECT 1 FROM financial_fund_grant_sources WHERE salary_id=?').get(s.salaryId) ||
            db.prepare("SELECT 1 FROM financial_fund_migration_issues WHERE source_kind='salary' AND source_id=? AND reason='unallocated'").get(s.salaryId)) { valid = false; break; }
        sum += BigInt(s.amountCents);
        snapshots.push(s);
      }
      if (!valid || sum !== BigInt(decision['incomeCents'])) { invalid(); continue; }
      const grantId = `legacy-group:${period.id}`;
      writing = true;
      db.prepare("INSERT INTO financial_fund_grants VALUES (?, 'legacy-group', ?, 1, 'active')").run(grantId, period.id);
      db.prepare(`INSERT INTO financial_fund_grant_revisions VALUES (?,1,?,?,?,?,?,?,?,?)`)
        .run(grantId, decision['incomeCents'], JSON.stringify(ratios), JSON.stringify(targets), period.sources_json,
          period.actor_id, period.operation_id, period.created_at, 'legacy-confirmed-group');
      const insert = db.prepare("INSERT INTO financial_fund_grant_sources VALUES (?,?,?,?,?,?,'active')");
      for (const s of snapshots) insert.run(s.salaryId, grantId, s.sourceToken, s.amountCents, s.date, s.accountId);
    } catch (error) {
      if (writing) throw error;
      invalid();
    }
  }
  const unclaimed = db.prepare(`SELECT id,amount_cents FROM salary_records s WHERE deleted=0
    AND NOT EXISTS (SELECT 1 FROM financial_fund_grant_sources f WHERE f.salary_id=s.id)`).all() as { id: string; amount_cents: number }[];
  for (const salary of unclaimed) issue(db, 'salary', salary.id, 'unallocated', { salaryId: salary.id, amountCents: salary.amount_cents });
}
interface WindowEvidence { start: number; end: number; mapping: FinancialMappingSnapshot | null; periodId: string; revision: number }
function importPurposes(db: Db): void {
  const revisions = db.prepare(`SELECT p.id period_id,p.active_revision,p.group_month,p.cycle_key,
    r.revision,r.group_month revision_group,r.cycle_key revision_cycle,r.window_json,r.decision_json,
    r.mapping_revision,r.config_revision,r.created_at
    FROM financial_periods p LEFT JOIN financial_period_revisions r
      ON r.period_id=p.id AND r.revision=p.active_revision`).all() as {
        period_id: string; active_revision: number; group_month: string; cycle_key: string;
        revision: number | null; revision_group: string | null; revision_cycle: string | null;
        window_json: string | null; decision_json: string | null; mapping_revision: number | null;
        config_revision: number | null; created_at: number | null;
      }[];
  const mappingOf = db.prepare('SELECT * FROM financial_mapping_revisions WHERE revision=?');
  const windows: WindowEvidence[] = [];
  let invalidWindow = false;
  for (const rev of revisions) {
    const window = frozenWindow(parse(rev.window_json), rev.group_month, rev.cycle_key);
    const decision = object(parse(rev.decision_json));
    if (!safe(rev.active_revision) || rev.active_revision < 1 || rev.revision !== rev.active_revision ||
        !text(rev.group_month) || !text(rev.cycle_key) || rev.group_month !== rev.revision_group ||
        rev.cycle_key !== rev.revision_cycle || window === null || decision === null ||
        !safe(rev.created_at) || !safe(rev.mapping_revision) || !safe(rev.config_revision) ||
        decision['mappingRevision'] !== rev.mapping_revision ||
        decision['configRevision'] !== rev.config_revision) { invalidWindow = true; continue; }
    let mapping: FinancialMappingSnapshot | null = null;
    if (safe(rev.mapping_revision) && rev.mapping_revision > 0) {
      const row = mappingOf.get(rev.mapping_revision) as { rules_json: string; topology_json: string; topology_token: string; created_at: number } | undefined;
      if (row !== undefined) mapping = { revision: rev.mapping_revision, rules: parse(row.rules_json) as FinancialMappingSnapshot['rules'], categories: parse(row.topology_json) as FinancialMappingSnapshot['categories'], topologyToken: row.topology_token, updatedAt: row.created_at };
    }
    windows.push({ start: window['start'], end: window['end'], mapping, periodId: rev.period_id, revision: rev.active_revision });
  }
  const transactions = db.prepare('SELECT id,type,is_refund,deleted,date,category_id,financial_purpose,financial_purpose_revision,updated_at FROM transactions').all() as { id: string; type: number; is_refund: number; deleted: number; date: number; category_id: string; financial_purpose: string | null; financial_purpose_revision: number; updated_at: number }[];
  const insert = db.prepare('INSERT OR IGNORE INTO financial_fund_purposes VALUES (?,?,?,?,?)');
  const event = db.prepare('INSERT OR IGNORE INTO financial_fund_purpose_events VALUES (?,?,?,?,?,NULL,NULL,?)');
  for (const tx of transactions) {
    if (db.prepare('SELECT 1 FROM financial_fund_purposes WHERE transaction_id=?').get(tx.id)) continue;
    let purpose: string | null = null;
    let source = 'unresolved';
    const evidence: { periodId: string; revision: number; purpose: string | null }[] = [];
    const unique = new Set<string | null>();
    let evidenceCount = 0;
    if (tx.financial_purpose === 'essentials' || tx.financial_purpose === 'joy') {
      purpose = tx.financial_purpose; source = 'legacy-override';
    } else if (tx.type === 0 && tx.is_refund === 0 && safe(tx.date) && !invalidWindow) {
      for (const window of windows.filter((w) => tx.date >= w.start && tx.date < w.end)) {
        let resolved: string | null = null;
        if (window.mapping !== null) {
          try { resolved = resolveFinancialPurpose({ override: null, categoryId: tx.category_id, mapping: window.mapping }).purpose; } catch { /* Not reliable frozen evidence. */ }
        }
        unique.add(resolved);
        evidenceCount += 1;
        if (evidence.length < 100) evidence.push({ periodId: window.periodId, revision: window.revision, purpose: resolved });
      }
      if (unique.size === 1 && !unique.has(null)) { purpose = evidence[0]!.purpose; source = 'legacy-mapping'; }
    }
    const evidenceJson = JSON.stringify({ legacyRevision: tx.financial_purpose_revision, evidenceCount, windows: evidence, invalidWindow });
    insert.run(tx.id, purpose, 1, source, evidenceJson);
    event.run(tx.id, 1, purpose, source, evidenceJson, safe(tx.updated_at) ? tx.updated_at : 0);
    // Issues are archival: P04 must derive current coverage from live facts, including
    // restored rows, and must not count an old issue for a deleted/resolved row.
    if (purpose === null && tx.is_refund === 0 && tx.deleted === 0) issue(db, 'transaction', tx.id, 'unassigned', { transactionId: tx.id, evidenceCount });
  }
}
/** Recheck source facts on reads; an aggregate cannot be silently reallocated on edit. */
export function fundGrantNeedsReview(db: Db, grantId: string): boolean {
  const grant = db.prepare(`SELECT g.status,r.sources_json FROM financial_fund_grants g
    JOIN financial_fund_grant_revisions r ON r.grant_id=g.id AND r.revision=g.active_revision
    WHERE g.id=?`).get(grantId) as { status: string; sources_json: string } | undefined;
  if (grant === undefined || grant.status !== 'active') return true;
  const frozen = parse(grant.sources_json);
  if (!Array.isArray(frozen) || frozen.length === 0) return true;
  const sources = db.prepare(`SELECT f.salary_id,f.source_token,f.amount_cents,f.date,f.account_id,f.status,
    s.id,s.amount_cents live_amount,s.date live_date,s.account_id live_account,s.deleted
    FROM financial_fund_grant_sources f LEFT JOIN salary_records s ON s.id=f.salary_id
    WHERE f.grant_id=?`).all(grantId) as {
      salary_id: string; source_token: string; amount_cents: number; date: number; account_id: string; status: string;
      id: string | null; live_amount: number | null; live_date: number | null;
      live_account: string | null; deleted: number | null;
    }[];
  const saved = frozen.map(snapshot);
  if (saved.some((s) => s === null) || sources.length !== saved.length ||
      new Set(saved.map((s) => s?.salaryId)).size !== saved.length) return true;
  return sources.some((s) => {
    const old = saved.find((entry) => entry?.salaryId === s.salary_id);
    if (s.status !== 'active' || old === undefined || old === null || old.amountCents !== s.amount_cents || old.date !== s.date ||
        old.accountId !== s.account_id || old.sourceToken !== s.source_token) return true;
    if (s.id === null || s.deleted !== 0 || s.live_amount !== s.amount_cents ||
        s.live_date !== s.date || s.live_account !== s.account_id) return true;
    return salarySourceToken({ id: s.id, amount_cents: s.amount_cents, date: s.date, account_id: s.account_id }) !== s.source_token;
  });
}

/** Backfill is called in a transaction by the migration runner. */
export function backfillFundHistory(db: Db): void {
  initConfig(db);
  importGroups(db);
  importPurposes(db);
}
