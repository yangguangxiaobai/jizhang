# Implementation plan: Conversational AI assistant workspace

## Preconditions and ownership

- The supervising main agent owns baseline cleanup/commit, Trellis dispatch, review, final tests,
  commit and deployment decisions.
- A `gpt-6-luna` Trellis implement worker writes the product code and may not commit, push or
  deploy.
- Before spawning, preserve unrelated user files and establish a clean committed baseline for the
  already-deployed AI work so the worker can review an unambiguous diff.

## Ordered implementation

### 1. Contracts and migration

- Add migration 009 with conversation/message/pending-action tables and indexes.
- Add defensive versioned DTOs for persisted messages, cards, provider turns, tool calls,
  pending actions and API responses.
- Extend the AI provider feature context with an `assistant` prompt/envelope without changing
  transaction/monthly/organization behavior.

### 2. Conversation persistence

- Implement `AssistantConversationService`: create/list/archive conversations, append ordered
  messages, load bounded context, persist normalized cards and update pending-action status.
- Add length/count limits and JSON decoders. Never persist raw files, provider payloads or prompts.
- Add idempotency keys for user messages and action confirmation.

### 3. Typed tool registry and orchestrator

- Implement a central registry with explicit read/write access and argument parsers.
- Add `AssistantOrchestrator` with the provider JSON envelope, unknown-tool rejection, maximum
  step count, minimized tool results and deterministic error messages.
- Read tools execute immediately. Write tools only prepare pending actions; confirmation executes
  through existing domain services after revalidation.

### 4. Domain tool adapters

- Wire the required read tools: transactions, balances, budget, stats, pending recurring,
  monthly evaluation, organization preview, backup/export links.
- Wire write/confirm tools in risk order: transaction create/update/delete/restore; platform import;
  transfer/salary; recurring confirm/ignore; organization apply/undo; safe master-data/template/
  backup actions.
- Reuse existing services or extract route-local business projections where needed. Do not call
  internal HTTP endpoints or duplicate shared arithmetic.

### 5. Attachment import

- Add byte-safe assistant message input for xlsx/CSV and file metadata.
- Invoke existing dry-run import, persist only redacted preview metadata/digest, and retain bytes in
  browser memory.
- Confirmation resends bytes, verifies digest, selection and overrides, reruns validation, then
  imports once. Refresh without bytes marks the card as requiring reattachment.

### 6. Assistant web workspace

- Add typed client endpoints, `/assistant`, conversation list/timeline/composer and card components.
- Replace the center tab with AI 助理 while keeping six tabs. Add a manual new-transaction entry
  to the ledger.
- Implement progress, duplicate-send prevention, attachment picker, confirmation/cancel,
  import row selection/category overrides, conversation create/archive and refresh restore.
- After parity, remove old embedded AI draft/monthly/organization page wiring to recover bundle
  budget; keep provider settings and backend services.

### 7. Verification and documentation

- Add migration/service/route/provider/tool tests and browser acceptance flows from the PRD.
- Assert database rows contain no raw attachment/provider/prompt/secret data.
- Update README/USAGE/API inventory and Trellis code-specs for assistant tool contracts.
- Run all canonical gates and record any real-device checks that remain manual.

## Validation commands

```text
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @jizhang/web run build
git diff --check
```

Focused browser command uses the installed Chrome fallback and assistant-specific grep before the
full phone route suite.

### Accepted PWA bundle budget (2026-09-24)

The production build measures 307,547 B of JavaScript (300.34 KiB) and 81,712 B of CSS
(79.80 KiB). The accepted budgets are less than 320 KiB of JavaScript and less than 80 KiB of
CSS. Both pass; no further bundle-size trimming is part of this task.

## Review checkpoints for the Luna worker

1. Stop after migration/contracts and report schema/API DTOs before broad tool adapters.
2. Stop after transaction + import end-to-end flows and report no-write-before-confirm evidence.
3. Stop after UI consolidation and report bundle budgets plus removed/replaced AI UI paths.
4. Final report lists files, tools implemented, deferred tools, tests and any open risk.

The supervisor will inspect channel progress at these checkpoints and interrupt the worker if it
widens scope, touches secrets/deployment, commits, or bypasses domain services.

## Rollback points

- Migration/tables are additive and can remain unused on code rollback.
- Tool registry lands before UI replacement; old UI is removed only after parity tests.
- Attachment import confirmation is isolated behind its digest check and can be disabled without
  affecting manual import.
- No deployment occurs until the supervisor completes full verification and the user requests it.
