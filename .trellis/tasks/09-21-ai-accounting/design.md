# Design: Configurable AI transaction drafts

## Status and change boundary

This design covers the first deliverable only:

- Add an authenticated AI configuration section to the existing settings page.
- Support OpenAI-compatible chat completions, an OpenAI Responses-style preset, and an advanced custom HTTP template mode.
- Add a natural-language input to the new-transaction flow that asks the configured provider for an editable draft.
- Reuse the existing transaction form and `TransactionService` for the final save.

The AI draft endpoint is advisory and read-only with respect to the ledger. It must not create, update, delete, or reclassify any accounting row. Batch cleanup, voice, OCR, and autonomous actions remain follow-up tasks.

The next slice is an on-demand current-natural-month evaluation. It persists neither the
evaluation nor a new ledger fact, and sends aggregate facts—not transaction rows or notes—to
the configured provider.

## Architecture and boundaries

```text
SettingsView / TransactionEditView
        │ typed API client, authenticated cookie + CSRF for writes
        ▼
Fastify /api/v1/ai/* routes (inside auth plugin)
        │
        ├─ AiConfigService       load/validate summary; encrypt/decrypt secret
        ├─ AiProviderService      render request; fetch with timeout; extract output
        └─ AiTransactionService   build prompt; validate normalized draft
        │
        ├─ existing categories/accounts (read only)
        └─ existing TransactionService.create (only after user confirmation in UI)
```

Keep provider code in `packages/server`. The browser never calls a provider directly and never receives the provider key. The client only receives a redacted configuration summary and a normalized draft DTO.

The route registrar must be passed through the existing authenticated route module, preserving the project's Fastify hook boundary. Provider failures become a stable application error shape; raw provider bodies, prompts, headers, and secrets are not returned or logged.

## Configuration persistence and encryption

Reuse the existing `settings` key/value table; no schema migration is needed. Store one versioned row under `ai.provider.v1`:

```ts
type AiProviderMode = 'chat-completions' | 'responses' | 'custom';

interface StoredAiProviderConfig {
  version: 1;
  enabled: boolean;
  mode: AiProviderMode;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  model: string;
  timeoutMs: number;
  headers: Record<string, string>; // non-secret static headers only
  auth: { kind: 'none' | 'bearer' | 'header'; headerName?: string };
  bodyTemplate: string | null;
  responsePath: string;
  encryptedSecret: {
    version: 1;
    iv: string;
    tag: string;
    ciphertext: string;
  } | null;
  updatedAt: number;
}
```

Only the secret value used by `auth` is encrypted. Custom headers reject `authorization` and the configured auth header name so users cannot accidentally create a second untracked secret channel. Multiple credentials, OAuth refresh, mTLS, and provider-specific secret stores are out of scope for this slice.

`JIZHANG_AI_ENCRYPTION_KEY` is an optional startup setting so existing deployments without AI keep booting. When AI configuration is saved or tested, the server requires a valid 32-byte encryption key, uses AES-256-GCM with a fresh 12-byte IV, and stores the authentication tag with the ciphertext. The key is never stored in SQLite. If the key changes or is missing, the config summary reports that the provider secret must be entered again; the server never falls back to plaintext.

The settings API accepts an optional new secret. An omitted secret means “keep the existing secret”; an explicit clear action removes it. The read API returns only `configured`, `hasSecret`, `mode`, `name`, `url`, `method`, `model`, `timeoutMs`, and non-secret headers. It never returns `encryptedSecret` or the decrypted value.

## Provider modes and template contract

### Chat completions preset

The server builds a non-streaming JSON request with a system instruction, the user's text, live selectable category/account choices, the server-local current date, and a strict response shape. The default response path is `choices[0].message.content`. This is the primary OpenAI/DeepSeek-compatible path.

### Responses preset

The server builds the provider's Responses-style request with `model`, `instructions`, `input`, and JSON-output instructions. The default output path is configurable because providers can expose text in different response fields. Streaming is disabled in the first slice.

### Custom mode

The user provides a JSON body template and a response extraction path. Templates are not executable code and are rendered only from an allowlist:

- `input`: the natural-language text
- `categories`: live selectable categories as `{ id, name, type }`
- `accounts`: live accounts as `{ id, name, type }`
- `model`: configured model string
- `today`: server-local `YYYY-MM-DD`
- `responseSchema`: the expected normalized draft schema

For a complete JSON value, a placeholder is inserted with `JSON.stringify`; placeholders embedded in a string are string-escaped. Unknown placeholders, malformed JSON, oversized templates, and attempts to reference the secret are rejected before a request is sent. URL templates support only the same non-secret variables. Header values support plain text and non-secret variables; the auth header is injected separately.

The response path uses a bounded dot/index path such as `choices[0].message.content`. The extracted value is either a JSON object or a JSON string containing the normalized draft. No JavaScript expressions, JSONPath filters, or arbitrary eval are allowed.

## Normalized draft contract

The provider adapter returns text or JSON; `AiTransactionService` is the single owner of normalization and validation. The normalized response is:

```ts
interface AiTransactionDraft {
  type: 0 | 1 | null;
  amountCents: number | null;
  categoryId: string | null;
  accountId: string | null;
  date: number | null;
  note: string;
  tags: string[];
  confidence: number | null;
  reason: string | null;
  missing: Array<'amount' | 'type' | 'category' | 'account' | 'date'>;
}
```

Validation rules:

- Amount conversion uses the existing positive-yuan-to-cents boundary; the client never parses model money.
- Dates must be valid server-local dates and are resolved relative to the server-provided `today` value.
- Expense categories must be live, selectable categories; income categories must be live income categories. Parent modules and deleted rows are rejected.
- Account ids must reference live accounts.
- Missing or ambiguous fields remain `null` and are listed in `missing`; the service never guesses a default merely to make the draft complete.
- Notes and tags are bounded by the same limits as the existing transaction path.

The frontend overlays the returned values into the existing new-transaction form. It highlights fields that are missing or AI-suggested, lets the user edit every field, and calls the existing create path only when the user presses the normal save button.

## API contract

All routes are protected by the existing auth module:

- `GET /api/v1/ai/config` → redacted `AiProviderConfigSummary`.
- `PUT /api/v1/ai/config` → validates and stores provider configuration; accepts `secret` only on write and returns the redacted summary.
- `POST /api/v1/ai/test` → sends a deliberately small, explicit test request using the last saved configuration; it never writes ledger data and returns only success or a safe error code/message. The UI saves before testing so the request cannot silently test stale form values.
- `POST /api/v1/ai/transaction-draft` with `{ input: string }` → returns `AiTransactionDraft`; it performs no ledger write.

Request limits: input is bounded (recommended 2,000 UTF-16 code units), templates and headers are bounded, timeout is clamped to a safe range, response bodies are size-limited, and redirects are rejected. Production accepts `https` and development may use `http` for a local provider. The stored URL is the only outbound destination; callers cannot submit a URL to the draft endpoint.

Stable error categories are `AI_NOT_CONFIGURED`, `AI_ENCRYPTION_KEY_REQUIRED`, `AI_CONFIG_INVALID`, `AI_PROVIDER_ERROR`, `AI_PROVIDER_TIMEOUT`, `AI_RESPONSE_INVALID`, and `AI_INPUT_INVALID`. Provider status, timing, and a request correlation id may be logged; prompts, response bodies, headers, and secrets may not.

## Settings UI

Keep `SettingsView.vue` focused on account and general settings; add one “AI 助手” navigation
entry and use a dedicated authenticated `/settings/ai` page for the long sensitive form. This
avoids making the mobile “我的” screen excessively long and gives the key field a focused
security explanation. The dedicated page contains:

- enable/disable control;
- mode selector: OpenAI-compatible, Responses, Custom;
- display name, URL, method, model, timeout;
- auth type and header name when custom auth is used;
- secret input with masked existing-secret state and explicit clear action;
- advanced body template, response path, and static headers fields in custom mode;
- save and “测试连接” actions with a warning that a test can consume provider quota.

The page never hydrates the full secret into a model-bound value after load. It uses local component state for the form and refreshes the redacted summary after writes.

## Compatibility, migration, and rollback

- Existing databases need no migration because the settings table already supports versioned key/value rows.
- Existing deployments keep booting with AI disabled when the encryption key is absent.
- Existing manual transaction routes, budget arithmetic, imports, and exports remain unchanged.
- Rollback is code/image rollback. If an AI settings row exists, older code ignores the unknown key; the row can be cleared through the database CLI/backup restore if needed. Losing the encryption key makes the stored provider secret unusable by design, so the UI must clearly require re-entry.

## Verification strategy

- Unit-test encryption round trip, wrong-key failure, secret redaction, config validation, template rendering, response-path extraction, and provider error mapping.
- Route-test auth/CSRF, config CRUD, missing encryption key, provider timeout/non-2xx/invalid JSON, and the no-ledger-write guarantee for draft generation.
- Browser-test settings configuration, redacted reload, custom mode validation, draft fill, manual correction, and normal save.
- Run the existing shared/server/web typecheck, lint, test, build, and mobile browser checks. No test may call a real provider; use an injected fetch stub or a local test server.

## Follow-up design: current-month evaluation

- Add `POST /api/v1/ai/monthly-evaluation` with no request body or an empty JSON body.
- Derive the current natural-month `[from, to)` window from the injected server clock and
  reuse existing stats/budget owners; never treat a budget cycle as the calendar month.
- Return `period`, server-owned `facts`, and explanatory `evaluation` separately. Facts carry
  stable evidence ids (`monthly.*`, `category.*`, `trend.*`, `budget.*`); every evaluation
  statement must cite ids that exist in the same response. The UI renders facts independently
  and treats AI prose as non-authoritative.
- The provider context is feature-scoped and aggregate-only. Custom templates may use the
  additional controlled `{{facts}}` variable, but never receive transaction rows, notes, tags,
  account records, or the provider secret.
- Do not call the provider during page load, persist the response, or add a navigation tab.

## Follow-up design: AI data organization and category merge

### Change boundary

This slice adds a protected organization preview, explicit apply, and conditional undo. It
does not auto-run, auto-delete, change amounts/dates/accounts/notes, or modify confirmed and
ignored recurring-occurrence snapshots. Deterministic server analysis owns candidate ids,
dependency counts, and the preview fingerprint; AI may only rank or explain those candidates.

### Safe merge rules

- A category candidate must be a live leaf category. Source and target must have the same
  income/expense type and the same `parent_id` (including both being top-level).
- The user chooses the canonical target. A builtin source is blocked; a builtin target is
  allowed. The source is soft-deleted only after every selected dependency is migrated.
- Transactions, including soft-deleted transaction rows, move from source to target so the
  historical label is consistent. `budget_allocations.allocations_json` and
  `budget_templates.modules_json` replace source ids with target ids and combine duplicate
  entries by adding cents/ratios. Live recurring rules and pending occurrences move to the
  target; confirmed/ignored occurrences remain immutable snapshots.
- A category with a live child, a cross-type/parent match, malformed dependency JSON, or any
  dependency that cannot be rewritten is previewed as blocked and cannot be applied.

### Preview and audit contract

The preview is recomputed on every request and returns a SHA-256 `previewHash`. An action id
is stable for its kind/source/target pair. Apply accepts `{ previewHash, actionIds }`, recomputes
the preview, and aborts the whole transaction if the hash or any selected action changed.

Migration 008 adds an append-only `ai_organization_audit` event table. An apply event records
the operation id, action kind, source/target ids, affected row ids grouped by table, and
redacted before/after category references or JSON projections. An undo event appends the
reverse before/after projection instead of editing history. Undo first checks that every
affected row still equals the applied after-state; any later user edit returns a conflict and
writes no rows.

### API and provider flow

- `POST /api/v1/ai/organization-preview` → deterministic candidates plus AI explanations;
  no database write. The provider receives category/tag names, ids, counts and candidate
  metadata only, never notes or raw transaction rows. If AI is not configured, deterministic
  preview candidates remain available with a safe local reason.
- `POST /api/v1/ai/organization-apply` with `{ previewHash, actionIds }` → operation id and
  applied action summaries. It never calls the provider.
- `POST /api/v1/ai/organization-undo` with `{ operationId }` → appended undo result, or a
  conflict when any affected value no longer matches the audit after-state.
- All three routes are inside the existing authenticated module. Apply/undo require the
  existing CSRF header; preview is a bodiless POST for a fresh read.

### UI

Add a dedicated `/settings/ai/organization` page linked from the AI settings page. The page
has an explicit “扫描整理建议” button, blocked/ready action cards, counts and dependency
warnings, per-action checkboxes, one confirmation step before apply, and an operation result
with an undo button. It never calls preview during page load and never applies a whole preview
implicitly.

### Compatibility and rollback

- Migration 008 is additive and runs in its own transaction with the existing pre-migration
  backup behavior. Older code ignores the new table.
- A failed apply rolls back all row rewrites and writes no audit event. An applied operation
  can be rolled back only through the conditional undo contract; no destructive hard delete is
  introduced.
- Provider failure does not prevent a deterministic preview, but it never widens the candidate
  set beyond server-validated ids.

### Semantic category analysis correction

- The organization preview also loads the newest 200 live transactions (or fewer when the
  ledger is smaller). Provider facts contain transaction id, type, current category id/name,
  truncated note text, and normalized tags; amount, account id, and date are omitted.
- The provider can return only validated `transactionId` + `targetCategoryId` pairs for
  reclassification advice, plus a bounded proposed category name/type/parent and evidence ids
  for a new-category suggestion. Unknown ids, cross-type targets, duplicates, and malformed
  suggestions are discarded; the provider cannot create a category or write a transaction.
- The response includes `scope` (`sampledTransactions`, `totalTransactions`, `truncated`) and
  `recommendations`. Existing merge actions remain the only currently applicable actions;
  semantic reclassification and new-category entries are advice cards requiring manual action.
- If the provider is not configured or fails, the duplicate/tag/category merge preview still
  returns, while semantic recommendations are empty and the UI explains why.

### AI processing status UX

- Long-running AI requests show a reusable conversational status surface with rotating, human
  readable processing hints and an explicit “please wait” cue.
- The status is not a fake percentage or provider telemetry; it disappears on success/error and
  does not alter the request contract. It is used for natural-language drafts, monthly review,
  organization scans, and organization apply/undo.
