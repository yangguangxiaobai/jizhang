import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import type { AiConfigService } from '../src/services/ai-config-service.js';
import { AiProviderService } from '../src/services/ai-provider-service.js';
import { AiProviderTimeoutError } from '../src/services/ai-types.js';
import { AiSpendingOrganizationService } from '../src/services/ai-spending-organization-service.js';

const RANGE = { startDate: '2026-08-01', endDate: '2026-08-31' };
const DAY = new Date(2026, 7, 5).getTime();
const empty = () => ({ reclassifications: [], tagSuggestions: [], noteSuggestions: [], newCategories: [], templateProposals: [] });
function setup(count = 23) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);
  seedDatabase(db);
  const insert = db.prepare(`INSERT INTO transactions(id,type,amount_cents,category_id,account_id,date,note,tags_json,is_refund,deleted,updated_at)
    VALUES (?,0,100,'builtin-expense-food','builtin-default-account',?,'sensitive source note','[]',0,0,0)`);
  for (let i = 0; i < count; i++) insert.run(`t${String(i).padStart(3, '0')}`, DAY);
  let now = DAY;
  let failures = 1;
  const calls: string[][] = [];
  const complete = vi.fn(async (_config, _secret, context, _options) => {
    const ids = (context.facts.transactions as { transactionId: string }[]).map((row) => row.transactionId);
    calls.push(ids);
    if (ids[0] === 't010' && failures > 0) { failures--; throw new AiProviderTimeoutError(); }
    return { ...empty(), tagSuggestions: [{ transactionId: ids[0], tags: ['午餐'], reason: 'mock', confidence: 0.8 }] };
  });
  const config = { getStoredOrThrow: () => ({ model: 'mock', timeoutMs: 20_000 }), getSecretOrThrow: () => null } as unknown as AiConfigService;
  const service = new AiSpendingOrganizationService(db, config, { complete } as unknown as AiProviderService, { now: () => now });
  return { db, service, calls, complete, config, advance: (n: number) => { now += n; }, fail: (n: number) => { failures = n; } };
}
async function terminal(service: AiSpendingOrganizationService, id: string) {
  await vi.waitFor(() => expect(service.getRun(id).status).not.toBe('running'));
  return service.getRun(id);
}

describe('bounded explicit timeout continuation', () => {
  it('keeps only private validated checkpoints and resumes only remaining ten-row batches after a user gesture', async () => {
    const f = setup();
    try {
      const before = f.db.prepare('SELECT * FROM transactions').all();
      const failed = await f.service.startAnalysis(RANGE);
      expect(failed).toMatchObject({ status: 'failed', errorCode: 'AI_PROVIDER_TIMEOUT', completedCount: 10, attempt: 1, canResume: true });
      expect(f.calls.map((x) => x.length)).toEqual([10, 10]);
      const stored = f.db.prepare('SELECT * FROM ai_analysis_runs WHERE id = ?').get(failed.runId) as Record<string, string>;
      expect(stored['suggestions_json']).toBe('[]');
      expect(stored['template_proposals_json']).toBe('[]');
      expect(stored['checkpoint_json']).not.toContain('sensitive source note');
      expect(JSON.parse(stored['checkpoint_json'] ?? '{}').suggestions).toHaveLength(1);
      expect(f.db.prepare('SELECT COUNT(*) AS n FROM ai_note_suggestions').get()).toEqual({ n: 0 });
      expect(() => f.service.getCard(failed.runId)).toThrow();
      expect(() => f.service.apply(failed.runId, ['anything'])).toThrow();
      f.service.getRun(failed.runId);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.calls).toHaveLength(2);
      const resumed = await f.service.resumeAnalysis(failed.runId, { clientRequestId: 'resume-1' });
      expect(resumed).toMatchObject({ runId: failed.runId, status: 'running', attempt: 2, completedCount: 10 });
      const ready = await terminal(f.service, failed.runId);
      expect(ready).toMatchObject({ status: 'ready', completedCount: 23, attempt: 2, canResume: false });
      expect(f.calls).toHaveLength(4);
      expect(f.calls[2]).toEqual(f.calls[1]);
      expect(f.calls[3]).toHaveLength(3);
      expect(f.calls.slice(2).flat()).not.toContain('t000');
      expect(f.service.getCard(ready.runId).actions).toHaveLength(3);
      expect(f.db.prepare('SELECT * FROM transactions').all()).toEqual(before);
      expect((await f.service.resumeAnalysis(failed.runId, { clientRequestId: 'resume-1' })).status).toBe('ready');
      expect(f.calls).toHaveLength(4);
    } finally { await f.service.close(); f.db.close(); }
  });

  it('replays a failed resume without another paid attempt and caps explicit attempts at three', async () => {
    const f = setup(); f.fail(9);
    try {
      const first = await f.service.startAnalysis(RANGE);
      await f.service.resumeAnalysis(first.runId, { clientRequestId: 'one' });
      const second = await terminal(f.service, first.runId);
      expect(second).toMatchObject({ attempt: 2, canResume: true, completedCount: 10 });
      const calls = f.calls.length;
      await f.service.resumeAnalysis(first.runId, { clientRequestId: 'one' });
      expect(f.calls).toHaveLength(calls);
      await f.service.resumeAnalysis(first.runId, { clientRequestId: 'two' });
      const third = await terminal(f.service, first.runId);
      expect(third).toMatchObject({ attempt: 3, canResume: false });
      await expect(f.service.resumeAnalysis(first.runId, { clientRequestId: 'three' })).rejects.toMatchObject({ code: 'AI_ORGANIZATION_CONFLICT' });
      expect(f.calls).toHaveLength(4);
      expect(f.db.prepare('SELECT checkpoint_json FROM ai_analysis_runs WHERE id = ?').get(first.runId)).toEqual({ checkpoint_json: '{}' });
    } finally { await f.service.close(); f.db.close(); }
  });

  it.each([
    "UPDATE transactions SET note='changed' WHERE id='t000'",
    "UPDATE transactions SET amount_cents=200 WHERE id='t011'",
    "UPDATE transactions SET date=0 WHERE id='t011'",
    "UPDATE transactions SET deleted=1 WHERE id='t011'",
    "UPDATE categories SET deleted=1 WHERE id='builtin-expense-food'",
    "UPDATE budget_templates SET name='changed'",
    "INSERT INTO transactions (id,type,amount_cents,category_id,account_id,date,note,tags_json,is_refund,deleted,updated_at) SELECT 'extra',type,amount_cents,category_id,account_id,date,note,tags_json,is_refund,deleted,updated_at FROM transactions WHERE id='t000'",
  ])('rejects changed source/catalog before any continuation call: %s', async (sql) => {
    const f = setup();
    try {
      const run = await f.service.startAnalysis(RANGE);
      f.db.exec(sql);
      await expect(f.service.resumeAnalysis(run.runId, { clientRequestId: 'stale' })).rejects.toMatchObject({ code: 'AI_ORGANIZATION_CONFLICT' });
      expect(f.calls).toHaveLength(2);
    } finally { await f.service.close(); f.db.close(); }
  });

  it('rejects stale state during final publish and never creates a card from mixed snapshots', async () => {
    const f = setup(1);
    f.complete.mockImplementationOnce(async () => {
      f.db.prepare("UPDATE transactions SET note='changed in-flight' WHERE id='t000'").run();
      return empty();
    });
    try {
      const run = await f.service.startAnalysis(RANGE);
      expect(run).toMatchObject({ status: 'failed', errorCode: 'AI_ORGANIZATION_CONFLICT', canResume: false });
      expect(() => f.service.getCard(run.runId)).toThrow();
    } finally { await f.service.close(); f.db.close(); }
  });

  it('expires timeout checkpoints without paid retry and does not make historical failures resumable', async () => {
    const f = setup();
    try {
      const run = await f.service.startAnalysis(RANGE);
      f.advance(24 * 60 * 60 * 1000 + 1);
      expect(f.service.getRun(run.runId).canResume).toBe(false);
      await expect(f.service.resumeAnalysis(run.runId, { clientRequestId: 'expired' })).rejects.toMatchObject({ code: 'AI_ORGANIZATION_CONFLICT' });
      f.db.prepare("UPDATE ai_analysis_runs SET source_hash='', checkpoint_json='{}' WHERE id=?").run(run.runId);
      expect(f.service.getRun(run.runId).canResume).toBe(false);
      expect(f.calls).toHaveLength(2);
    } finally { await f.service.close(); f.db.close(); }
  });

  it('preserves fixed snapshot boundaries and batch size across service restart without auto-calling AI', async () => {
    const f = setup();
    try {
      const run = await f.service.startAnalysis(RANGE);
      await f.service.close();
      const restored = new AiSpendingOrganizationService(f.db, f.config, { complete: f.complete } as unknown as AiProviderService, { now: () => DAY });
      expect(restored.getRun(run.runId).canResume).toBe(true);
      expect(f.calls).toHaveLength(2);
      await restored.resumeAnalysis(run.runId, { clientRequestId: 'restart' });
      expect((await terminal(restored, run.runId)).status).toBe('ready');
      expect(f.calls[2]).toEqual(f.calls[1]);
      await restored.close();
    } finally { await f.service.close(); f.db.close(); }
  });
});
