/** Migration 009 — server-owned conversational assistant state. */
export const MIGRATION_009_ASSISTANT = `
CREATE TABLE assistant_conversations (
  id         TEXT    PRIMARY KEY,
  title      TEXT    NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_assistant_conversations_recency
  ON assistant_conversations(archived, updated_at DESC, id);

CREATE TABLE assistant_messages (
  id                TEXT    PRIMARY KEY,
  conversation_id   TEXT    NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  client_request_id TEXT,
  role              TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  kind              TEXT    NOT NULL CHECK (kind IN ('text', 'progress', 'tool-card', 'result', 'error', 'attachment')),
  content_json      TEXT    NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_assistant_messages_request
  ON assistant_messages(conversation_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX idx_assistant_messages_timeline
  ON assistant_messages(conversation_id, created_at, id);

CREATE TABLE assistant_pending_actions (
  id                TEXT    PRIMARY KEY,
  conversation_id   TEXT    NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  source_message_id TEXT    NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
  tool_name         TEXT    NOT NULL,
  arguments_json    TEXT    NOT NULL,
  preview_json      TEXT    NOT NULL,
  fingerprint       TEXT    NOT NULL,
  attachment_sha256 TEXT,
  attachment_name   TEXT,
  attachment_size   INTEGER,
  status            TEXT    NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
  result_json       TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_assistant_pending_conversation
  ON assistant_pending_actions(conversation_id, status, updated_at DESC);

CREATE INDEX idx_assistant_pending_status
  ON assistant_pending_actions(status, updated_at);
`;
