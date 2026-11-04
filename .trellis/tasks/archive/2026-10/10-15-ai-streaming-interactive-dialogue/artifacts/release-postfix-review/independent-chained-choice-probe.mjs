// Independent re-verification probe for the chained-clarification fix (task 10-15,
// release-postfix review). Written from scratch by the reviewing agent — it does NOT
// reuse the deployment-time probe. It runs the *shipped local compiled dist* against a
// THROWAWAY temp database. No provider call, no /data/jizhang.db access, no ledger write.
//
// Asserted invariants (read from SQL directly, not from the service's own snapshot):
//   I1 genB (choice hop) is born with answered_option_id/answered_at = NULL
//   I2 source row keeps the consumed answer (answered_option_id = chosen option)
//   I3 provenance kept on genB: source_generation_id + question_id + input_json verbatim
//   I4 identical replay -> created:false, same id
//   I5 consumed source rejects a second click -> ASSISTANT_CHOICE_STALE
//   I6 choice-text hop also born NULL, with answered_option_id NULL on consumption
//   I7 a *third* hop after a choice-text hop is still answerable (the original "second hop
//      is forever stuck" class, now exercised twice in a row)
//   I8 transactions count unchanged across the whole flow
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// five levels up: release-postfix-review -> artifacts -> task -> tasks -> .trellis -> repo root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const serverDir = path.join(repoRoot, 'packages', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');

// `ASSISTANT_PROBE_DIST` allows the negative control (a dist copy with the pre-fix SQL
// restored) to be probed with the identical assertions.
const distDir = process.env.ASSISTANT_PROBE_DIST ?? path.join(serverDir, 'dist');
const mod = (rel) => import(pathToFileURL(path.join(distDir, rel)).href);

const { AssistantConversationService } = await mod('services/assistant-conversation-service.js');
const { AssistantGenerationService } = await mod('services/assistant-generation-service.js');
const { initializeDatabase, closeDatabase } = await mod('db/index.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-review-probe-'));
const db = new Database(path.join(dir, 'probe.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const migrations = initializeDatabase(db, null);
const migrationRows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();

let clock = Date.parse('2026-10-16T00:00:00Z');
const now = () => clock++;

const conversations = new AssistantConversationService(db, now);
const generations = new AssistantGenerationService(db, conversations, now);
const conversation = conversations.create('rp review probe');
const seedMessage = conversations.appendMessage({
  conversationId: conversation.id,
  role: 'user',
  kind: 'text',
  content: { version: 1, text: 'seed' },
});

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};

// Insert a completed clarification generation directly, so the probe controls the question.
function seedQuestion(id, qid, options) {
  const questionJson = JSON.stringify({
    version: 1,
    id: qid,
    clarification: {
      id: qid,
      selection: 'single',
      question: 'probe question',
      options,
      allowFreeText: true,
    },
  });
  db.prepare(
    `INSERT INTO assistant_generations
       (id, conversation_id, client_request_id, request_hash, input_json, user_message_id,
        status, delivery, outcome, last_seq, message_ids_json, partials_json,
        source_generation_id, question_id, question_json, answered_option_id, answered_at,
        error_code, error_message, today, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{"type":"text","text":"seed"}', ?,
             'completed', 'stream', 'awaiting-choice', 0, '[]', '[]',
             NULL, ?, ?, NULL, NULL, NULL, NULL, '2026-10-16', ?, ?)`,
  ).run(id, conversation.id, `seed_${qid}`, `seed_hash_${qid}`, seedMessage.id, qid, questionJson, now(), now());
}

const row = (id) =>
  db.prepare(
    `SELECT id, status, outcome, source_generation_id, question_id, input_json,
            answered_option_id, answered_at
       FROM assistant_generations WHERE id = ?`,
  ).get(id);

const finish = (id, outcome) =>
  db.prepare("UPDATE assistant_generations SET status='completed', outcome=? WHERE id=?").run(outcome, id);

const ledgerBefore = db.prepare('SELECT COUNT(*) c FROM transactions').get().c;

// ── hop 1: option click ────────────────────────────────────────────────────────────
const optA = { id: 'a1', label: 'Alpha' };
seedQuestion('qa', 'qa_q', [optA, { id: 'a2', label: 'Beta' }]);
const hop1 = generations.create(
  conversation.id,
  { version: 1, clientRequestId: 'r1', input: { type: 'choice', sourceGenerationId: 'qa', questionId: 'qa_q', optionId: 'a1' } },
  { delivery: 'stream', today: '2026-10-16' },
);
const qa = row('qa');
const gb = row(hop1.generation.id);
check('I2 source keeps consumed answer', qa.answered_option_id === 'a1' && qa.answered_at !== null, qa);
check('I1 new generation born unanswered', gb.answered_option_id === null && gb.answered_at === null, gb);
check('I3 provenance kept', gb.source_generation_id === 'qa' && gb.question_id === 'qa_q', gb);
const stored = JSON.parse(gb.input_json);
check('I3 input stored verbatim', stored.optionId === 'a1' && stored.sourceGenerationId === 'qa', stored);

// ── hop 2: the SECOND hop (the historically stuck one) must itself be answerable ────
finish(hop1.generation.id, 'awaiting-choice');
db.prepare('UPDATE assistant_generations SET question_id = ?, question_json = ? WHERE id = ?').run(
  'qb_q',
  JSON.stringify({ version: 1, id: 'qb_q', clarification: { id: 'qb_q', selection: 'single', question: 'probe q2', options: [{ id: 'b1', label: 'One' }, { id: 'b2', label: 'Two' }], allowFreeText: true } }),
  hop1.generation.id,
);
let hop2 = null;
let hop2Error = null;
try {
  hop2 = generations.create(
    conversation.id,
    { version: 1, clientRequestId: 'r2', input: { type: 'choice', sourceGenerationId: hop1.generation.id, questionId: 'qb_q', optionId: 'b1' } },
    { delivery: 'stream', today: '2026-10-16' },
  );
} catch (error) {
  hop2Error = error?.code ?? String(error);
}
const sourceB = row(hop1.generation.id);
check('I2 second-hop source consumed', sourceB.answered_option_id === 'b1' && sourceB.answered_at !== null, sourceB);
check('I2b second hop created (the historically stuck hop)', hop2?.created === true, { hop2Error });
if (hop2 === null) {
  console.log(JSON.stringify({ probe: 'independent-chained-choice', result: 'FAIL', failures }, null, 2));
  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

// ── I4: identical replay is idempotent ─────────────────────────────────────────────
const replay = generations.create(
  conversation.id,
  { version: 1, clientRequestId: 'r2', input: { type: 'choice', sourceGenerationId: hop1.generation.id, questionId: 'qb_q', optionId: 'b1' } },
  { delivery: 'stream', today: '2026-10-16' },
);
check('I4 replay idempotent', replay.created === false && replay.generation.id === hop2.generation.id, replay.created);

// ── I5: consumed source rejects a second click ─────────────────────────────────────
finish(hop2.generation.id, 'awaiting-choice');
let stale = null;
try {
  generations.create(
    conversation.id,
    { version: 1, clientRequestId: 'r2b', input: { type: 'choice', sourceGenerationId: hop1.generation.id, questionId: 'qb_q', optionId: 'b2' } },
    { delivery: 'stream', today: '2026-10-16' },
  );
} catch (error) {
  stale = error?.code ?? null;
}
check('I5 stale second click rejected', stale === 'ASSISTANT_CHOICE_STALE', stale);

// ── I6: choice-text hop born NULL and consumes with answered_option_id NULL ────────
db.prepare('UPDATE assistant_generations SET question_id = ?, question_json = ? WHERE id = ?').run(
  'qc_q',
  JSON.stringify({ version: 1, id: 'qc_q', clarification: { id: 'qc_q', selection: 'single', question: 'probe q3', options: [{ id: 'c1', label: 'C' }, { id: 'c2', label: 'C2' }], allowFreeText: true } }),
  hop2.generation.id,
);
const hop3 = generations.create(
  conversation.id,
  { version: 1, clientRequestId: 'r3', input: { type: 'choice-text', sourceGenerationId: hop2.generation.id, questionId: 'qc_q', text: 'free form answer' } },
  { delivery: 'stream', today: '2026-10-16' },
);
const sourceC = row(hop2.generation.id);
const gd = row(hop3.generation.id);
check('I6a choice-text source consumed with null option', sourceC.answered_option_id === null && sourceC.answered_at !== null, sourceC);
check('I6b choice-text hop born unanswered', gd.answered_option_id === null && gd.answered_at === null, gd);

// ── I7: a question produced AFTER a choice-text hop is still answerable ────────────
finish(hop3.generation.id, 'awaiting-choice');
db.prepare('UPDATE assistant_generations SET question_id = ?, question_json = ? WHERE id = ?').run(
  'qd_q',
  JSON.stringify({ version: 1, id: 'qd_q', clarification: { id: 'qd_q', selection: 'single', question: 'probe q4', options: [{ id: 'd1', label: 'D' }, { id: 'd2', label: 'D2' }], allowFreeText: true } }),
  hop3.generation.id,
);
let hop4 = null;
let hop4Error = null;
try {
  hop4 = generations.create(
    conversation.id,
    { version: 1, clientRequestId: 'r4', input: { type: 'choice', sourceGenerationId: hop3.generation.id, questionId: 'qd_q', optionId: 'd1' } },
    { delivery: 'stream', today: '2026-10-16' },
  );
} catch (error) {
  hop4Error = error?.code ?? String(error);
}
check('I7 third chained answer still accepted', hop4?.created === true, { hop4Error });

const ledgerAfter = db.prepare('SELECT COUNT(*) c FROM transactions').get().c;
check('I8 no ledger row written', ledgerAfter === ledgerBefore, { ledgerBefore, ledgerAfter });

closeDatabase(db);
fs.rmSync(dir, { recursive: true, force: true });

const report = {
  probe: 'independent-chained-choice',
  migrations: migrationRows.map((m) => m.version),
  initializeResult: migrations,
  invariants: { I1: !failures.some((f) => f.startsWith('I1')), I2: !failures.some((f) => f.startsWith('I2')), I3: !failures.some((f) => f.startsWith('I3')), I4: !failures.some((f) => f.startsWith('I4')), I5: !failures.some((f) => f.startsWith('I5')), I6: !failures.some((f) => f.startsWith('I6')), I7: !failures.some((f) => f.startsWith('I7')), I8: !failures.some((f) => f.startsWith('I8')) },
  ledgerRows: { before: ledgerBefore, after: ledgerAfter },
  failures,
  result: failures.length === 0 ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
