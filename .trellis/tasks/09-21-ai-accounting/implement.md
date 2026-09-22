# Implementation plan: configurable AI transaction drafts

## Scope

Implement only the reviewed first slice:

1. Server-side provider configuration with encrypted secret storage.
2. OpenAI-compatible, Responses-style, and custom HTTP adapters.
3. Protected API routes for configuration, connection test, and read-only transaction draft generation.
4. Settings-page configuration UI.
5. Natural-language input in the new transaction form that fills an editable draft.
6. Tests and documentation for the configuration, privacy, and no-auto-save boundaries.

Do not implement monthly AI evaluation, batch cleanup, voice, OCR, automatic saving, autonomous reclassification, or provider-side conversation history.

## Ordered work

### 1. Load project context and define the public contracts

- Read `prd.md`, `design.md`, `research/provider-protocols.md`, the backend/frontend spec indexes, and the shared cross-layer guide.
- Record the exact change boundary before editing code.
- Add typed server/frontend DTOs for redacted config summaries, config writes, draft requests, normalized drafts, and stable AI errors.

### 2. Add server configuration and secret cryptography

- Extend `AppConfig` and `.env.example` with optional `JIZHANG_AI_ENCRYPTION_KEY`; validate the required format only when AI secret operations are requested so existing installations still boot.
- Add a small AES-256-GCM helper with versioned ciphertext, random IVs, wrong-key failure, and no secret logging.
- Add `AiConfigService` using the existing `settings` table key `ai.provider.v1`.
- Validate URL scheme, methods, auth headers, template sizes, response paths, timeout bounds, and mode-specific fields.
- Return only a redacted summary from reads and writes.

### 3. Implement provider adapters and normalized draft validation

- Add an injected-fetch transport with timeout, response-size limit, redirect rejection, and safe error mapping.
- Implement the `chat-completions` and `responses` presets without adding an SDK dependency.
- Implement custom JSON template rendering with the allowlisted variables from `design.md`; reject unknown placeholders and secret references.
- Implement bounded response-path extraction and JSON/text decoding.
- Add `AiTransactionService` to build the prompt context, validate category/account ids, convert amount to cents through the existing boundary, resolve dates against server-local `today`, and produce `AiTransactionDraft`.

### 4. Wire protected routes

- Add `routes/ai.ts` and register it inside the existing auth plugin route list.
- Add `GET/PUT /api/v1/ai/config`, `POST /api/v1/ai/test`, and `POST /api/v1/ai/transaction-draft`.
- Ensure draft generation never calls `TransactionService.create` or mutates any ledger/master-data row.
- Add request size limits, CSRF coverage for writes, correlation-safe errors, and provider failure logging without payloads.

### 5. Add typed web API and settings controls

- Extend `packages/web/src/api/client.ts` with the AI endpoints and redacted DTOs.
- Add an AI entry to `SettingsView.vue` and move the long sensitive form to a dedicated
  `AiProviderSettingsView.vue` route, keeping the existing general settings sections intact.
- Support masked-secret behavior: blank secret means keep existing, explicit clear removes it, and the full key is never loaded into component state.
- Add validation and accessible error/status feedback for save and connection test.

### 6. Add natural-language entry UI

- Add a small reusable `AiTransactionDraftPanel.vue` or equivalent local component to the new-transaction view only.
- Keep the existing manual fields and normal Save button as the source of truth.
- On a successful draft, populate editable form refs; mark missing/AI-suggested fields without locking them.
- Disable duplicate requests, show timeout/provider errors, and leave the manual form usable after every failure.
- Do not add a second client-side money/category/date parser beyond existing helpers.

### 7. Verification and documentation

- Add server unit tests for encryption, config validation, custom rendering, extraction, provider errors, auth, redaction, and no-write behavior.
- Add web/e2e coverage for settings persistence/redaction, custom-mode validation, draft fill, manual correction, and confirmed save.
- Update `.env.example`, `README.md`, and `USAGE.md` with the encryption-key requirement, provider setup, privacy boundary, and failure fallback.
- Run the full checks below and record any unavailable browser/provider checks.

## Validation commands

Canonical project commands:

```text
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @jizhang/web run build
git diff --check
```

Focused checks during implementation may run the shared/server Vitest suites and the relevant Playwright spec against an injected local provider. Never call OpenAI, DeepSeek, or a user endpoint from automated tests.

## Risk and rollback points

- **Secret encryption boundary:** if encryption or key rotation is wrong, an existing configured provider may become unusable. Keep the ciphertext format versioned and test wrong-key behavior before wiring UI writes.
- **Custom template rendering:** do not use `eval`, unrestricted JSONPath, or unbounded interpolation. Reject malformed/unknown templates before network calls.
- **Outbound HTTP:** enforce timeout, response-size, redirect, scheme, and log-redaction rules. A provider failure must not block manual accounting.
- **Transaction draft normalization:** invalid model output must remain a draft error, never a partial database write. Reuse existing category/account validation and money/date boundaries.
- **Settings page regression:** isolate AI controls from existing appearance/cycle/password/data settings and preserve current mobile accessibility checks.

Rollback points are after steps 2, 3, and 4. If a step changes a public contract incorrectly, revert that step's files before continuing; do not reset unrelated user work.

## Review gates before `task.py start`

- `prd.md` has no unresolved product questions.
- `design.md` and this `implement.md` agree on config fields, encryption, provider modes, and API routes.
- The provider research is saved under `research/`.
- The user approves the final planning summary.

## Follow-up implementation: current-month AI evaluation

1. Build aggregate facts from existing stats/budget owners without calling one HTTP route from another.
2. Add feature-scoped AI evaluation DTOs, evidence ids, and an aggregate-only provider context.
3. Add authenticated `POST /api/v1/ai/monthly-evaluation` with no persistence or ledger writes.
4. Add typed client methods and an on-demand `AiMonthlyEvaluationPanel.vue` below the existing stats trend.
5. Test current-month semantics, salaries/refunds/soft deletes, empty months, auth/CSRF, provider failure,
   evidence validation, no-write behavior, and the browser panel.

### Follow-up implementation status

- Completed in `BudgetOverviewService`, `MonthlyEvaluationService`, the authenticated AI route,
  typed web client, `StatsView`, and `AiMonthlyEvaluationPanel`.
- The existing budget route now delegates its read-only overview projection to the same service,
  preserving the previous response shape while preventing a second budget arithmetic path.
- Verified with server route tests, evidence rejection tests, a Chrome mobile browser test, and
  the repository typecheck/lint/build gates. Deployment remains a separate explicit step.

## Follow-up implementation: AI data organization and category merge

1. Add migration 008 for append-only organization audit events and migration tests.
2. Add typed organization DTOs, deterministic candidate analysis, dependency projections,
   stable action ids, and preview SHA-256 fingerprints in a new
   `ai-organization-service.ts`.
3. Add server-side provider context for organization ranking/explanations. Validate that AI
   can only refer to deterministic action ids; fall back to deterministic reasons when AI is
   unavailable.
4. Implement atomic apply for tag normalization and safe category merge. Revalidate the
   preview hash, rewrite transactions/allocations/templates/rules/pending occurrences without
   touching confirmed/ignored snapshots, soft-delete the source category, and append audit
   events without logging notes or secrets.
5. Implement conditional undo with current-value checks and conflict errors. Undo must append
   an event and must not overwrite later user edits.
6. Add authenticated routes, typed web client methods, the dedicated organization page, the
   AI settings link, confirmation/selection/undo UI, and Chrome mobile coverage.
7. Add route/service tests for duplicate tags, category dependency counts, parent/type/builtin
   blockers, malformed JSON, stale previews, atomic rollback, confirmed-occurrence immutability,
   audit redaction, conditional undo conflicts, auth/CSRF, provider fallback, and no-op scans.

### Organization validation commands

```text
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @jizhang/web run build
git diff --check
```

The browser test must mock the organization preview/apply/undo endpoints and assert that page
load performs no organization write. No test may call a real provider or mutate the user's
deployed database.

### Organization implementation status

- Completed in migration 008, `AiOrganizationService`, the authenticated AI routes, typed web
  client, `AiOrganizationView`, AI settings link, server tests, and Chrome mobile coverage.
- Full regression currently passes: shared 174 tests, server 441 tests, typecheck, lint and
  the PWA/mobile build gates. Deployment remains a separate explicit step.

## Semantic category analysis correction

1. Extend the organization preview facts with a bounded recent transaction sample: truncated
   notes and normalized tags only; never send amount, account, date, prompt, or secret.
2. Extend the provider response contract with validated transaction reclassification advice
   and bounded new-category suggestions. Keep merge apply/undo unchanged; semantic advice is
   preview-only in this correction.
3. Render scope, bill-level classification suggestions, and proposed new categories in the
   organization page, including a clear “manual confirmation required” state.
4. Test note truncation/privacy, current-category/target validation, unknown-id rejection,
   provider fallback, empty ledgers, and browser rendering when no duplicate merge actions exist.
