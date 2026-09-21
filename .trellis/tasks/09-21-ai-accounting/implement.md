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
- Add the AI section to `SettingsView.vue`, keeping existing settings sections and visual behavior intact.
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
