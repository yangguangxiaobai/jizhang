import { createRequire } from "node:module";
const require = createRequire("/app/packages/server/package.json");
const D = require("better-sqlite3");
const db = new D("/data/jizhang.db", { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT id, conversation_id, status, outcome, source_generation_id, question_id, question_json, answered_option_id, answered_at, created_at, input_json FROM assistant_generations ORDER BY created_at").all();
console.log("GEN_TOTAL=" + rows.length);
for (const x of rows) {
  console.log([
    x.id.slice(0,8),
    x.conversation_id.slice(0,8),
    x.status,
    x.outcome,
    "src=" + (x.source_generation_id ? x.source_generation_id.slice(0,8) : "null"),
    "answeredOpt=" + (x.answered_option_id === null ? "null" : x.answered_option_id.slice(0,8)),
    "answeredAt=" + (x.answered_at === null ? "null" : "SET"),
    "bornAnswered=" + (x.answered_at !== null && x.answered_at === x.created_at),
    "created=" + x.created_at,
  ].join(" "));
  if (x.question_json) console.log("   input=" + x.input_json + " | q=" + x.question_json.slice(0, 240));
}
const e = db.prepare("SELECT COUNT(*) c FROM assistant_generation_events").get();
console.log("EVENT_TOTAL=" + e.c);
db.close();
