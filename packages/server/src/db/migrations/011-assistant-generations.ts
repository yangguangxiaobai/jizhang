/** Migration 011 — durable streamed assistant generations and their bounded event log. */
export const MIGRATION_011_ASSISTANT_GENERATIONS = `
CREATE TABLE assistant_generations (
  id                   TEXT    PRIMARY KEY,
  conversation_id      TEXT    NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  client_request_id    TEXT    NOT NULL,
  request_hash         TEXT    NOT NULL,
  input_json           TEXT    NOT NULL,
  user_message_id      TEXT    NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
  status               TEXT    NOT NULL
                               CHECK (status IN ('accepted', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  delivery             TEXT    NOT NULL CHECK (delivery IN ('stream', 'buffered')),
  outcome              TEXT    CHECK (outcome IN ('answer', 'awaiting-choice', 'pending-confirmation')),
  last_seq             INTEGER NOT NULL DEFAULT 0,
  message_ids_json     TEXT    NOT NULL DEFAULT '[]',
  partials_json        TEXT    NOT NULL DEFAULT '[]',
  source_generation_id TEXT,
  question_id          TEXT,
  question_json        TEXT,
  answered_option_id   TEXT,
  answered_at          INTEGER,
  error_code           TEXT,
  error_message        TEXT,
  today                TEXT    NOT NULL DEFAULT '',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  -- Only a completed generation may carry an outcome (it never means "booked").
  CHECK ((status = 'completed') = (outcome IS NOT NULL))
);

-- Request replay/conflict detection is per conversation and unique.
CREATE UNIQUE INDEX idx_assistant_generations_request
  ON assistant_generations(conversation_id, client_request_id);

-- At most one live generation per conversation; the assistant must not fork a second turn.
CREATE UNIQUE INDEX idx_assistant_generations_active
  ON assistant_generations(conversation_id)
  WHERE status IN ('accepted', 'running');

CREATE INDEX idx_assistant_generations_recency
  ON assistant_generations(conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_assistant_generations_source
  ON assistant_generations(source_generation_id);

CREATE TABLE assistant_generation_events (
  generation_id TEXT    NOT NULL REFERENCES assistant_generations(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  type          TEXT    NOT NULL CHECK (type IN ('state', 'text-delta', 'message', 'terminal')),
  payload_json  TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (generation_id, seq)
);
`;
