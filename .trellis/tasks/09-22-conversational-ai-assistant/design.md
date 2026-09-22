# Design: Conversational AI assistant workspace

## Change boundary

Build one authenticated `/assistant` workspace that orchestrates existing accounting services
through a typed server-side tool registry. Replace the center bottom-navigation “记一笔” entry
with “AI 助理”; add an explicit manual-new-transaction control to the ledger so manual entry
remains available.

The assistant may persist normalized conversation state, but it may not persist raw uploaded
files, provider raw responses, hidden prompts, credentials, or unrestricted executable input.
All write tools are two-phase: prepare an inert preview, then execute only after a separate
authenticated confirmation request.

## Architecture

```text
AssistantView (messages, composer, file attachment, cards)
        │ typed same-origin API + CSRF for writes
        ▼
/api/v1/assistant/* routes inside authModule
        │
        ├─ AssistantConversationService   persistence, ordering, history/context window
        ├─ AssistantOrchestrator          provider JSON envelope, bounded tool loop
        ├─ AssistantToolRegistry          allowlisted schemas + read/prepare/confirm adapters
        └─ existing domain services       transactions, stats, budget, import, AI analysis, etc.
```

No assistant adapter calls one HTTP route from another. It constructs and invokes the same
service classes used by the routes, preserving server/shared accounting ownership.

## Database migration 009

Additive TypeScript migration, preserving rollback compatibility:

```text
assistant_conversations
  id TEXT PK
  title TEXT NOT NULL DEFAULT ''
  archived INTEGER NOT NULL DEFAULT 0
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL

assistant_messages
  id TEXT PK
  conversation_id TEXT NOT NULL
  role TEXT NOT NULL             user | assistant | tool
  kind TEXT NOT NULL             text | progress | tool-card | result | error | attachment
  content_json TEXT NOT NULL     normalized, versioned DTO only
  created_at INTEGER NOT NULL

assistant_pending_actions
  id TEXT PK
  conversation_id TEXT NOT NULL
  source_message_id TEXT NOT NULL
  tool_name TEXT NOT NULL
  arguments_json TEXT NOT NULL
  preview_json TEXT NOT NULL
  fingerprint TEXT NOT NULL
  attachment_sha256 TEXT
  attachment_name TEXT
  attachment_size INTEGER
  status TEXT NOT NULL           pending | confirmed | cancelled | expired
  result_json TEXT
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL
```

Indexes cover conversation recency, message timeline order, and pending actions. Conversation
clear/archive is a soft state change. Message and action JSON readers are defensive and reject
unknown versions rather than casting arbitrary persisted objects.

The database backup will contain normalized conversation text/cards because the user chose
cross-device persistence. It will not contain provider bodies or attachment bytes.

## Conversation contract

### API

- `GET /api/v1/assistant/conversations` — recent non-archived conversations.
- `POST /api/v1/assistant/conversations` — create a conversation.
- `GET /api/v1/assistant/conversations/:id/messages` — ordered typed timeline.
- `POST /api/v1/assistant/conversations/:id/messages` — append text and optional attachment,
  run the orchestrator, persist normalized results.
- `POST /api/v1/assistant/actions/:id/confirm` — revalidate and execute a pending write.
- `POST /api/v1/assistant/actions/:id/cancel` — mark a pending write cancelled.
- `DELETE /api/v1/assistant/conversations/:id` — archive/clear assistant history only.

Message input is bounded (2,000 characters). Attachment input reuses the app body limit and
accepts only current WeChat xlsx / Alipay CSV MIME/name signatures. Duplicate submit ids make
message creation and confirmation idempotent.

### Provider envelope

For portability across chat-completions, Responses and custom providers, the orchestrator asks
for one normalized JSON envelope rather than depending on vendor-specific function calling:

```ts
interface AssistantProviderTurn {
  message: string;
  toolCall: null | {
    name: AssistantToolName;
    arguments: Record<string, unknown>;
  };
}
```

The prompt contains the last bounded normalized messages, the typed tool catalog and minimized
tool results. Unknown tools, unknown fields, overlong output, invalid ids and malformed JSON are
rejected. Read tools may execute and feed one result back to the provider for a final answer;
write tools stop after prepare and return a confirmation card. Limit one user request to at most
three provider/tool steps so a model cannot loop indefinitely.

Custom provider templates may use the existing controlled `facts`/`input` variables; custom
users must include the assistant envelope/tool catalog in their template. Preset providers work
without extra configuration.

## Tool registry

```ts
interface AssistantTool<TArgs, TPreview, TResult> {
  name: AssistantToolName;
  access: 'read' | 'write';
  description: string;
  inputSchema: Record<string, unknown>;
  parseArguments(value: unknown): TArgs;
  read?(context: ToolContext, args: TArgs): Promise<TResult> | TResult;
  prepare?(context: ToolContext, args: TArgs): Promise<TPreview> | TPreview;
  confirm?(context: ToolContext, preview: TPreview, attachment?: Uint8Array): Promise<TResult> | TResult;
}
```

### Required first-release tools

Read/analysis:

- recent/filter transactions;
- account balances;
- budget overview and periods;
- monthly/category/pool statistics;
- pending recurring items;
- monthly AI evaluation;
- organization/category analysis preview;
- backup listing and data-export links.

Write with confirmation:

- create/update/delete/restore transaction;
- create transfer and salary;
- confirm/ignore recurring occurrence;
- WeChat/Alipay import confirmation;
- organization apply/undo;
- create/update/delete category/account/tag where existing service rules permit;
- apply a budget template and create a backup.

Security, password changes, provider-key edits, database restore, purge-all, arbitrary SQL/shell,
and unsupported file types are not tools. Less common manual editors remain reachable by links
from assistant cards.

## Two-phase writes and fingerprints

Preparing a write returns a versioned card DTO and stores a pending action. No domain writer is
called. Confirm reloads the pending action, verifies status, relevant `updated_at`/preview hash,
attachment digest when applicable, and the referenced live rows. It then invokes exactly one
domain service transaction and stores a redacted result.

Repeat confirmation of an already-confirmed action returns the stored result and never creates a
second accounting row. Stale/expired plans answer `409 ASSISTANT_ACTION_STALE`; cancel is
idempotent. Pending file imports expire on refresh when browser-held bytes are unavailable and ask
the user to attach the same digest again.

## File import flow

1. Browser reads bytes and sends them with file metadata in the message request.
2. Server invokes the existing platform import dry-run path; raw bytes are held only for that
   request and are not inserted into conversation tables.
3. The persisted card contains source, digest, counts, date range, warnings and bounded preview
   rows. The browser retains bytes in memory for confirmation.
4. User adjusts row selection/category overrides in the card and confirms, resending bytes.
5. Server verifies SHA-256 and reruns the existing parser/duplicate checks before importing.

## Web UX and navigation

- Route `/assistant`, `meta.nav = 'assistant'`.
- Replace the center tab in `AppShell.vue` with a sparkles “AI 助理” tab; keep six total tabs.
- Add a prominent manual “记一笔” button to `TransactionsView.vue`.
- `AssistantView.vue` owns conversation selection, timeline, composer and pending attachment.
- Presentational components: message bubble, progress bubble, generic confirmation card,
  transaction card, import preview card and tool-result card.
- Reuse `AiThinkingStatus` while waiting. Disable duplicate sends and keep visible progress/errors.
- Retire old embedded draft/monthly/organization UI routes/components after parity is covered;
  keep their backend endpoints/services as registry adapters. The AI provider settings page stays.

This consolidation is required for the existing total-JS/CSS budgets: adding a full assistant
without removing isolated AI screens would exceed the PWA checks.

## Privacy, logging and retention

- Conversation rows store normalized content only, bounded by DTO schemas.
- Provider context uses at most the recent conversation window plus current tool facts.
- Never log message bodies, attachment bytes, tool arguments containing notes, provider bodies,
  session cookies or secrets.
- Clear/archive removes assistant history from normal reads but never reverses confirmed ledger
  operations. Raw files are never retained server-side.
- AI unavailable/offline leaves manual pages usable and returns an actionable assistant error.

## Compatibility and rollback

- Migration 009 only adds tables/indexes; older images ignore them.
- Existing APIs and domain services remain available. Assistant adapters are additive.
- Removing old isolated AI UI happens only after browser parity tests pass; rollback to the prior
  image restores those routes because backend data contracts remain compatible.
- Deployment follows the existing image/backup/force-recreate/health verification procedure.

## Verification strategy

- Unit tests: persisted DTO decoding, tool argument schemas, tool allowlist, context bounds,
  redaction, fingerprints, idempotency and provider-loop caps.
- Route/service tests: auth/CSRF, read vs write split, zero writes before confirmation, stale and
  duplicate confirmation, attachment digest mismatch, no raw bytes/provider payload in SQLite.
- Cross-layer tests: transaction/import/organization cards round-trip through typed client DTOs.
- Browser tests at 375/390/430 px: nav replacement, manual entry fallback, text transaction flow,
  file preview/selection/confirm, history after reload, progress, cancel/error/offline behavior.
- Full gates: typecheck, lint, tests, PWA build budgets, Chrome phone suite and diff check.
