# Conversational AI assistant workspace

## Goal

Create one dedicated AI assistant page that becomes the conversational front door to the
ledger. A user can type a request or attach a supported bill file, receive tool-backed results
and confirmation cards, and finish common accounting workflows without manually navigating and
filling every existing form.

The assistant orchestrates existing domain services; it does not replace accounting rules,
invent SQL, or let provider output write directly to SQLite.

## Confirmed product decisions

- This is a first-class assistant workspace, not another small AI control embedded in existing
  pages. Existing manual pages remain available as fallback and advanced editing surfaces.
- Read-only queries and analysis may run immediately.
- Every write—create, edit, delete, import, category/tag organization, or batch action—must first
  render a structured preview/confirmation card and run only after one explicit user confirmation.
- Existing AI features (transaction draft, monthly evaluation, semantic category suggestions,
  merge/apply/undo) move into the assistant experience instead of remaining isolated flows.
- The user can attach the existing WeChat xlsx and Alipay GBK CSV formats in the conversation.
- The assistant replaces the center “记一笔” bottom-navigation entry. Manual transaction entry
  remains reachable from the ledger and from assistant confirmation cards.
- Conversation history persists on the server so it survives refreshes and can continue on
  another authenticated device. Persist normalized user/assistant text, structured cards, tool
  status and confirmation state; never persist raw attachment bytes, provider raw responses,
  internal prompts or credentials. History remains until the user starts a new conversation or
  explicitly clears it.
- Implementation is delegated to a `gpt-5.6-luna` worker; the main agent writes the plan,
  supervises progress, reviews changes, and runs final verification.

## Confirmed repository facts

- Vue/Fastify use a same-origin authenticated API. Mutating calls already require the CSRF
  header and business validation lives in server services.
- Platform import already supports byte-safe upload, dry-run preview, per-row selection,
  category overrides, idempotent confirmation, and possible-duplicate warnings.
- AI provider configuration, encrypted secret storage, draft generation, monthly evaluation,
  category analysis, organization audit, and conditional undo already exist.
- The bottom navigation is verified at exactly six entries on a 375 px phone; adding a seventh
  tab would break an existing mobile acceptance constraint.

## Requirements

### R1. Assistant conversation surface

- A dedicated authenticated page displays user messages, assistant messages, tool progress,
  result cards, errors, and confirmation cards in one chronological conversation.
- Text input supports natural-language commands. The composer accepts supported bill files and
  shows attachment name/type/size before sending.
- AI processing uses the existing conversational progress component and never appears frozen.

### R2. Controlled tool orchestration

- The model chooses only from a server allowlist of typed tools; unknown tools or arguments are
  rejected before any domain service runs.
- Tool execution calls existing services/functions, not HTTP routes from other HTTP routes and
  not model-generated SQL.
- Read tools include recent transactions, account balances, budget overview, monthly statistics,
  monthly AI evaluation, and organization preview.
- Write tools initially include transaction creation from a confirmed draft, platform-bill import
  confirmation, organization apply/undo, and safe master-data actions added to the registry.

### R3. Confirmation cards

- A tool plan clearly names the operation, affected records/counts, important values, validation
  warnings, and whether it writes data.
- Write plans are inert until the user presses Confirm. Editing/cancelling does not write.
- Confirmation revalidates a version/fingerprint or underlying records; stale plans return a
  conflict and ask the assistant to refresh the preview.

### R4. File-based bill import

- A WeChat/Alipay file sent in chat uses the existing byte-preserving parser and dry-run response.
- The assistant renders ignored rows, hard duplicates, possible duplicates, totals, row selection,
  and category overrides before confirmation.
- The original file is never persisted as conversation content; only bounded metadata, digest,
  preview and final import result are retained.

### R5. Privacy and safety

- Provider credentials remain server-only. Tool results sent to the provider are minimized per
  feature and exclude password/session data.
- Prompts, provider bodies, secrets, and full uploaded files are not written to normal logs.
- Password changes, credential management, database restore, and unrestricted SQL/shell actions
  are never exposed as assistant tools.
- Manual accounting continues to work when AI is disabled, unavailable, slow, or offline.

### R6. Conversation persistence

- The server owns conversation/message order and returns a typed timeline; the browser does not
  treat local storage as the source of truth.
- Persisted message content is normalized and bounded. Tool cards reference normal domain ids and
  redacted summaries rather than storing provider payloads.
- Raw attachment bytes remain client-held only for the active preview/confirmation. If the page is
  refreshed before confirmation, the pending file action expires and asks the user to attach the
  file again; its conversation card remains as history.
- The user can start a new conversation and clear/archive prior conversations. Clearing history
  does not delete accounting records created by confirmed tools.

## Acceptance Criteria

- [ ] AC1 A user can open one assistant page, type a natural-language expense, review a typed
  transaction card, confirm it, and see exactly one normal transaction created.
- [ ] AC2 Uploading a supported WeChat/Alipay file yields the existing dry-run preview in chat;
  no row is written until the selected import is confirmed.
- [ ] AC3 “How much did I spend this month?” returns server-computed facts, not model arithmetic.
- [ ] AC4 Monthly evaluation and category-organization features are reachable through chat and
  preserve their evidence/preview/undo contracts.
- [ ] AC5 Every write tool is blocked without explicit confirmation and stale confirmations fail
  atomically.
- [ ] AC6 Unknown tool names, fabricated ids, invalid arguments, cross-type categories, and
  provider failures produce safe errors and no ledger writes.
- [ ] AC7 AI progress remains visible during slow provider/import operations; the composer cannot
  accidentally submit duplicate requests.
- [ ] AC8 The existing manual pages, PWA/offline shell, six-item phone navigation constraint, and
  all accounting tests remain valid.
- [ ] AC9 Conversation history survives a refresh and another authenticated device, while database
  inspection proves raw attachment bytes, provider bodies, internal prompts and secrets are absent.

## Out of scope

- Voice input, receipt/OCR image recognition, external messaging bots, multi-user collaboration,
  and background autonomous agents.
- Unconfirmed automatic writes, provider-generated SQL, direct provider-to-database access, and
  password/session/security administration through chat.
- Persisting raw uploaded files or provider transcripts.
