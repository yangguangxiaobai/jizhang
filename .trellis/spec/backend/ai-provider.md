# AI Provider Integration

## Scenario: Configurable provider-backed transaction drafts

### 1. Scope / Trigger

- Trigger: a cross-layer integration adds authenticated HTTP routes, settings persistence,
  an external provider secret, and a frontend draft contract.
- The AI endpoint is advisory. It may read live categories/accounts and call a configured
  provider, but it must not write transactions, categories, accounts, tags, budgets, or
  balances.
- Provider-specific code stays under `packages/server/src/services`; routes remain thin and
  are registered inside the authenticated plugin.

### 2. Signatures

- Environment: optional `JIZHANG_AI_ENCRYPTION_KEY`, exactly 64 hexadecimal characters
  (32 bytes). Existing deployments boot without it; saving/using an encrypted provider
  secret requires it.
- Settings row: `settings.key = 'ai.provider.v1'`, with a versioned JSON envelope containing
  mode, URL, method, model, timeout, non-secret headers, auth mode, body template, response
  path, and AES-GCM ciphertext `{ version, iv, tag, ciphertext }`.
- Protected routes:
  - `GET /api/v1/ai/config` → redacted provider summary.
  - `PUT /api/v1/ai/config` → configuration input; `secret` is write-only and `clearSecret`
    explicitly removes it.
  - `POST /api/v1/ai/test` → tests the last saved provider configuration.
  - `POST /api/v1/ai/models` (bodyless) → `{items:[{id:string}]}`; explicit metadata discovery against the saved connection only (disabled config allowed for initial setup). Never accepts a destination or secret in its body, changes config, or performs inference.
  - `POST /api/v1/ai/transaction-draft` with `{ input: string }` → normalized draft only.
- Draft response fields: `type`, `amountCents`, `categoryId`, `accountId`, `date`, `note`,
  `tags`, `confidence`, `reason`, and `missing`.

### 3. Contracts

- Provider modes are `chat-completions`, `responses`, and `custom`.
- Custom templates may reference only `input`, `categories`, `accounts`, `model`, `today`,
  `responseSchema`, and the feature-scoped aggregate `facts` value; JavaScript, eval, JSONPath
  expressions, and `secret` references are forbidden.
- API keys are encrypted with AES-256-GCM before SQLite persistence. The encryption key is
  never written to SQLite, returned to the browser, logged, or included in exports.
- Reads return `hasSecret` and `encryptionKeyConfigured`, never the secret or ciphertext.
- Live expense parent modules and deleted categories/accounts cannot become draft references.
- Amounts are converted to integer cents server-side; dates are local-day epoch milliseconds.
- Provider failures use the normal `{ error: { code, message } }` contract and never expose
  provider response bodies, prompts, headers, URLs containing secrets, or API keys.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| missing/empty natural-language input | `400 AI_INPUT_INVALID` |
| malformed URL, unsupported method, bad template, invalid response path | `400 AI_CONFIG_INVALID` |
| custom header named `Authorization`, `Cookie`, or common API-key header | `400 AI_CONFIG_INVALID` |
| encrypted secret save/use without a valid 64-hex env key | `503 AI_ENCRYPTION_KEY_REQUIRED` |
| ciphertext cannot be decrypted with the current env key | `503 AI_SECRET_UNAVAILABLE` |
| absent/disabled provider | `503 AI_NOT_CONFIGURED` |
| provider timeout | `504 AI_PROVIDER_TIMEOUT` |
| provider non-2xx, oversized response, or network failure | `502 AI_PROVIDER_ERROR` |
| response JSON/path/draft cannot be normalized | `502 AI_RESPONSE_INVALID` |
| unauthenticated read or mutation | existing `401/403` auth/CSRF contract |

Outbound requests validate `http(s)` URLs, reject redirects, clamp timeout/body sizes, and
do not accept a destination URL from the draft request itself. Production provider URLs use
HTTPS; local HTTP is for non-production development.

### Model discovery (2026-10-26)

- Explicit authenticated CSRF-protected POST; no scheduled fetch or inference. Disabled saved configs may list models so initial setup can save URL/secret without a model. Existing inference still requires enabled config.
- Revalidate disabled saved destinations: production HTTPS, no userinfo/fragments/templates or encoded/noncanonical paths. Only mode-matching terminal `/chat/completions` or `/responses` maps to same-prefix `/models`, preserving origin/query. Custom or unknown routes reject `AI_CONFIG_INVALID`; do not guess unrelated endpoints.
- Reuse saved auth/decrypted credential server-side. GET without body, no redirects/retries, configured deadline including body reads, 2 MiB cap. OpenAI `{data:[{id}]}` only, at most 2000 raw rows. IDs trimmed/nonempty/max 200 UTF-16 units/control-free; deduplicate in source order. Invalid/over-cap lists reject, not truncate; empty list succeeds. Return IDs only.
- Fixed safe errors; never echo upstream error bodies/metadata or transport exceptions. Unified 5xx handler preserves code with generic message; Android maps codes to model-specific guidance.
- Android fetch/save/test are mutually exclusive. Connection/secret changes must be saved before discovery; model-only edit may still list. In-memory list invalidates on connection edits; service/session guards reject late results. Selecting never saves/tests automatically; failure preserves current model. Manual input remains.
- Mocked service/route/transport tests and Android DTO/search/bootstrap/state tests are separate from device/live-provider acceptance. A listed model is not proof of inference compatibility.

### 5. Good / Base / Bad Cases

- Good: a saved Bearer configuration encrypts the key, a provider returns a JSON draft, the
  API returns valid category/account ids, and the user confirms through the existing save form.
- Base: the provider is disabled, unavailable, or returns an ambiguous field; manual entry
  remains usable and the draft marks the field in `missing` instead of guessing.
- Bad: a template references `{{secret}}`, a parent category id, a deleted account, or an
  invalid amount; reject before ledger write and return a stable safe error.

### 6. Tests Required

- Crypto unit tests assert AES-GCM round trip, wrong-key failure, and no plaintext in the
  stored envelope.
- Config tests assert redaction, encryption-key requirement, URL/method/header/template
  validation, and settings round trip.
- Provider tests assert preset/custom request shapes, encoded URL variables, timeout,
  non-2xx, response-size and invalid-path handling without a real network call.
- Route tests assert auth/CSRF, stable error bodies, normalized draft values, and that the
  transaction row count is unchanged before confirmation.
- Browser tests mock the draft endpoint, assert fields are filled, then assert no row exists
  until the normal Save button is pressed.

### 7. Wrong vs Correct

#### Wrong

```ts
// Sends the API key to the browser and lets a component call the provider directly.
return reply.send({ apiKey: decryptAiSecret(row.encryptedSecret, key) });
```

#### Correct

```ts
// Provider calls stay server-side; the browser receives only a redacted summary.
return reply.send(configService.summary());
```

The same boundary prevents a database backup, browser response, or normal request log from
becoming a second copy of the provider credential.

## Scenario: On-demand current-month evaluations

### 1. Scope / Trigger

- Trigger: a follow-up cross-layer feature uses the same configured provider to explain
  server-computed monthly aggregates.
- The endpoint is read-only and on-demand. It never writes the ledger, settings table, or
  an evaluation history row, and it must not run during page load.
- The provider receives aggregate facts only: no transaction ids, notes, tags, account rows,
  or raw ledger records.

### 2. Signatures

- `POST /api/v1/ai/monthly-evaluation` with no body (an empty JSON body is also accepted) →
  `{ period, facts, evaluation }`.
- `AiMonthlyPeriod`: `{ month, monthStart, from, to }`, where `[from, to)` is the current
  server-local natural month.
- `AiMonthlyFacts`: current-month income/net expense, category aggregates, a six-point
  server trend, and either `budget: null` or the newest configured budget-cycle aggregate.
- `AiEvaluationStatement`: `{ text, evidenceIds }`; summary, highlights, risks, and
  suggestions all use this shape.

### 3. Contracts

- The monthly window is derived from one captured server clock value. It is never replaced
  by the configured budget cycle. A budget fact carries its own `cycle` and `periodStart`
  so the UI cannot label it as a calendar-month budget by accident.
- Each server fact has a stable evidence id (`monthly.income`, `monthly.expense`,
  `category.<id>`, `trend.<YYYY-MM>`, `budget.total`, `budget.pool`, or
  `budget.module.<id>`). Every returned AI statement must reference one or more ids that
  exist in the returned facts.
- The custom template allowlist additionally includes `facts`; it is a controlled JSON value,
  not executable code. Transaction templates continue to use the existing variables.
- The frontend renders `facts` independently from AI prose and exposes generation as an
  explicit user action. The provider is never called when the statistics page mounts.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| no enabled provider or unavailable encrypted secret | existing `503 AI_NOT_CONFIGURED` / `AI_SECRET_UNAVAILABLE` |
| provider timeout, network failure, non-2xx, or oversized body | `504 AI_PROVIDER_TIMEOUT` / `502 AI_PROVIDER_ERROR` |
| provider response is not valid JSON or configured path is absent | `502 AI_RESPONSE_INVALID` |
| summary/statement text is empty, too long, or has no evidence ids | `502 AI_RESPONSE_INVALID` |
| statement references an unknown or duplicate evidence id | `502 AI_RESPONSE_INVALID` |
| unauthenticated request or missing CSRF on a mutation | existing `401/403` auth/CSRF contract |

### 5. Good / Base / Bad Cases

- Good: current-month salary and expenses are aggregated by the existing statistics and
  budget owners; the provider explains them and cites the returned evidence ids.
- Base: an empty month returns zero-valued facts and the UI still shows the authoritative
  facts; the provider may say that there is insufficient data, but must cite facts.
- Bad: a provider receives a transaction note, invents a category amount, or cites
  `category.secret`; the first is excluded from the prompt and the latter is rejected.

### 6. Tests Required

- Route tests pin the clock, assert natural-month boundaries, salary/refund/soft-delete
  aggregation, empty-month zero facts, authenticated access, and unchanged transaction count.
- Provider tests assert the `facts` template variable is allowlisted and the request body
  contains no raw note or API key.
- Normalization tests reject unknown evidence ids and malformed statement shapes with the
  stable `AI_RESPONSE_INVALID` body.
- Browser tests mock the endpoint, click the explicit generation button, and assert facts
  remain visible beside the evidence-backed explanation.

### 7. Wrong vs Correct

#### Wrong

```ts
// Calls the budget HTTP route and sends raw ledger rows for the model to aggregate.
const budget = await fetch('/api/v1/budget/overview');
return provider.complete(config, secret, { transactions: db.prepare('SELECT * FROM transactions').all() });
```

#### Correct

```ts
// Reuse the domain services, freeze the clock, and send only typed aggregate facts.
const facts = monthlyEvaluationFacts(db, capturedNow);
return provider.complete(config, secret, { feature: 'monthly-evaluation', facts, ...context });
```

The evidence-id check is the second boundary: even a successful provider response cannot
make a statement about a number that the server did not return.

## Scenario: Previewed AI data organization

### 1. Scope / Trigger

- Trigger: an authenticated cross-layer feature proposes tag and category cleanup while
  protecting a single-user ledger from broad AI writes.
- Deterministic server analysis owns candidate ids, dependency counts, rewrite payloads, and
  stale-preview detection. AI may rank or explain candidates only.
- Apply and undo are explicit user actions; page load and provider responses never mutate data.

### 2. Signatures

- `POST /api/v1/ai/organization-preview` → `{ previewHash, generatedAt, scope, semanticAvailable, actions, recommendations }`.
- `POST /api/v1/ai/organization-apply` with `{ previewHash, actionIds }` → operation id and
  applied action summaries.
- `POST /api/v1/ai/organization-undo` with `{ operationId }` → an appended undo result.
- `AiOrganizationActionKind` is `tag-merge | category-merge`; each action carries source/
  target ids and names, `ready | blocked`, blockers, dependency counts, sample ids, reason,
  and confidence.
- `recommendations` may contain transaction reclassification advice or a proposed new
  category; these are advice-only in this slice and do not enter apply/undo.

### 3. Contracts

- Category merge is restricted to live leaf categories with equal type and equal parent;
  builtin sources are blocked, builtin targets are allowed.
- Apply rewrites transactions (including soft-deleted rows), budget allocation/template JSON,
  live recurring rules, and pending occurrences in one SQLite transaction. Confirmed/ignored
  occurrence snapshots are immutable. The source category is soft-deleted after rewrites.
- Migration 008 provides append-only `ai_organization_audit` events. Audit JSON contains only
  ids, category references, tag arrays, and budget/template projections—never notes, prompts,
  provider responses, secrets, or full transaction rows.
- Semantic preview sends at most 200 live transactions as bounded redacted note summaries,
  tags, type, current category id/name, and no amount, account id, or date. The redacted note
  is never persisted in an audit event.
- Undo is conditional: every affected field must still equal the apply after-state, otherwise
  the whole undo returns `409 AI_ORGANIZATION_CONFLICT` and writes no event or data.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| missing/empty action selection or malformed body | `400 AI_ORGANIZATION_INVALID` |
| preview hash changed, action disappeared, or affected field changed | `409 AI_ORGANIZATION_CONFLICT` |
| blocked parent/builtin/cross-type/malformed-JSON category action | preview `blocked`; apply `400 AI_ORGANIZATION_INVALID` |
| provider absent or provider failure during preview | deterministic server preview remains available |
| provider cites an unknown action id | ignore the invalid explanation; never expand the candidate set |
| unauthenticated request or missing CSRF on apply/undo | existing `401/403` auth/CSRF contract |

### 5. Good / Base / Bad Cases

- Good: two same-parent leaf categories are previewed, all affected references are shown,
  apply preserves money totals, and undo restores the exact category/tag/JSON projections.
- Base: a provider is unavailable; deterministic duplicate candidates still render with a
  local explanation and remain explicitly selectable.
- Bad: a category has a child, a builtin category is the source, or a template JSON is
  malformed; the action is blocked rather than guessed or partially rewritten.

### 6. Tests Required

- Migration tests assert version 008 and the audit table survive idempotent initialization.
- Service/route tests assert duplicate-tag and category candidates, all dependency rewrites,
  confirmed-occurrence immutability, atomic rollback, stale hash rejection, audit redaction,
  conditional undo, and auth/CSRF.
- Provider tests assert only candidate facts are sent and provider suggestions cannot invent
  action ids.
- Browser tests assert no scan on page load, explicit selection/apply confirmation, blocked
  actions, and undo UI behavior.

### 7. Wrong vs Correct

#### Wrong

```ts
// Let the model choose an arbitrary category id and update rows one endpoint at a time.
for (const row of modelResponse.rows) await api.categories.update(row.id, row.categoryId);
```

#### Correct

```ts
// Server creates the candidate and fingerprint; apply revalidates and commits one transaction.
const preview = organizationService.previewFacts();
organizationService.apply({ previewHash, actionIds });
```

The preview hash and append-only audit make a broad cleanup inspectable, atomic, and
conditionally reversible instead of an opaque AI batch edit.

## Scenario: Date-range AI spending organization

- The Android A105/A106 workspace uses dedicated routes, not the generic assistant card
  confirmation workflow:
  `POST /api/v1/ai/organization-runs`, `GET /api/v1/ai/organization-runs/:id`,
  `GET /api/v1/ai/organization-runs/:id/card`,
  `POST /api/v1/ai/organization-runs/:id/apply`, and
  `POST /api/v1/ai/organization-operations/:id/undo`.
- The server owns the inclusive server-local `startDate`/`endDate` interpretation, eligible
  row snapshot, category/tag validation, review fingerprint, apply revalidation and undo
  comparison. Android submits only the reviewed action ids and never replays a transaction
  editor payload.
- Analysis is capped at 500 eligible live rows; new runs freeze 10-row sequential provider
  batches (legacy runs retain their stored size). An over-cap request is rejected before
  provider work. Any failure publishes no actionable partial card. Provider deadlines remain
  the user's configured per-call limit; do not silently increase configuration to mask slow calls.
- Migration018 stores normalized completed results/cursor privately, frozen numeric boundaries,
  source/catalog digest, batch size and attempt. No original note/prompt/raw output is retained.
  Public results and note-suggestion rows are published only after all batches succeed.
- Timeout-only `POST /api/v1/ai/organization-runs/:id/resume` requires explicit user action and
  a distinct clientRequestId for each attempt. Exact replay returns the existing attempt even
  after failure; GET/start replay/boot never repeats AI work. Max3 attempts/run, 24h non-sliding
  resume-admission lifetime and 10min monotonic budget per attempt. Source/catalog changes
  reject before paid resume and within final publication transaction. Expired failed checkpoints
  are purged at startup/resume admission, not during GET. Successful committed batches are not
  requested again; a timed-out upstream call may still have billed. Resume uses current saved
  Provider settings but never changes them.
- `SpendingSuggestion` carries display-only transaction date/amount/type and category
  before/after names; these fields do not expand the apply scope. Apply still revalidates
  every selected transaction against the run snapshot.
- Note suggestions are stored/displayed separately and are never applied. New-category
  suggestions are advice-only in the Android workspace. Template proposals may exist on the
  card, but the Android workspace does not apply them; future-only template semantics remain
  server-owned.
- Apply accepts at most 100 distinct action ids and records one operation projection in a
  single SQLite transaction. Replaying the same run/action ids returns the existing operation.
  Undo is conditional: if any operation-owned after-state changed, it returns
  `AI_ORGANIZATION_CONFLICT` with no partial restoration.
- Android uses asynchronous background start and bounded GET observation (15min), rendering
  persisted stages/batches/events, not invented percentages or model thoughts. Explicit
  cost-disclosed resume retains the same run and immutable resume UUID on uncertainty;
  failed-to-running/new-attempt transitions require that explicit authorization. Transport
  timeout diagnosis omits structural-field wording when field is null. Scope/lifecycle guards
  cover reads/writes; uncertain apply/undo stays locked for the same-request replay.
- Tests cover inclusive date boundaries, over-cap rejection before provider calls, whole-run
  failure with no card, note separation, card display facts, idempotent apply, conditional
  undo, and Android DTO/state/cap/error parsing. Device, live Provider, deployment and
  independent review remain separate acceptance gates.

## Scenario: Human-reviewed assistant bill import

- Attachment analysis is advisory-only and reuses saved encrypted provider configuration and bounded HTTP handling. Deterministic shared parsing owns amount/date/order/status/refund facts.
- At most 200 preview rows are analysed in sequential batches of 25. Each response must contain exactly one `id/include/reason/categoryId` decision per known batch row. Unknown/duplicate/omitted IDs, extra financial fields, wrong-type/nonbookable category IDs and reasons longer than 300 characters invalidate the analysis. Partial batch failure discards recommendations and exposes `analysis.status=failed`, not rule-only AI success.
- File strings are untrusted data, not instructions. The bill-import feature prompt has no tools. Only validated recommendations are stored in pending/message JSON, never raw provider output, prompts, credentials or attachment bytes.
- `POST /assistant/actions/:id/analyse` requires original bytes with matching size/SHA-256 and a pending import action. Explicit retry produces a replacement card and closes the old one; human edits are reset, as disclosed in Android.
- Confirm requires explicit 1–100 selected IDs from the displayed preview; categoryOverrides values are existing active same-type bookable IDs for assistant import only. `noteOverrides` preserves exact strings including `""` (clear); absence preserves the full generated source note. Legacy data-management category-name imports retain their independent contract.
- Confirmation never reruns AI. Fingerprints cover digest, deterministic source/ledger preview, current category projection, selection and reviewed overrides. Reparse/revalidation and inserts run under existing pending-action transaction/idempotence guards. Provider recommendations are not hash inputs.
- Refunded originals remain gross expenses; income rows with explicit source refund trade/category evidence carry independent isRefund. Status alone neither creates income nor links purchases. Only explicit terminal refund status labels may supplement the existing success-status predicate; a substring such as `退款中`, `待退款` or `退款审核中` is not completion evidence and remains blocked. A refunded original warning asks the user to verify actual refund movements.
- Android review drafts may cover the bounded 200-row preview, but confirmation projects category/note overrides to the explicit at-most-100 selection. Never silently discard the 101st edited category merely because an earlier edited row is now deselected. Retry completion may update only its owning workspace; failed refresh must retain uncertain-result gates.
- Evidence: shared refund fixture, analysis normalization tests, mocked provider/assistant route tests, rollback/stale-category tests and Android pure helper tests. Live Provider/device acceptance remains separate.

## Scenario: Read-only import duplicate comparison

- `GET /assistant/conversations/:conversationId/actions/:id/rows/:rowId/duplicates?limit=20&cursor=<id>` lives in the authenticated API plugin. The service resolves a pending platform-import action owned by a live conversation and a row among its first 200 stored preview rows. The client never supplies matching amounts, dates or account IDs.
- Preview facts add `comparisonAccountId` (nullable) and original `externalId`; they participate in existing deterministic row fingerprints. Legacy previews missing comparison facts return a 400 refresh/re-upload instruction; do not infer them from client inputs.
- Only live transactions with equal captured platform account, server-local calendar day, type and integer-cent amount qualify. Refund identity is displayed, not an added matching restriction. Stable-ID hard blockers are unchanged.
- ID keyset pagination uses default 20, strict 1–50 limit and nonempty at-most-100-character cursor. Return current total, bounded transaction detail DTOs with historical account/category labels, nextCursor, readAt and a heuristic-not-proof rationale. Deleted cursor rows do not break pagination; pages are live reads, not an immutable confirmation snapshot.
- No provider call, ledger write, automatic merge or existing-ledger edit. Candidate responses are never embedded into pending cards or provider context. Final confirmation still uses digest/fingerprint/staleness/atomic/idempotence checks.
- Android overlays comparison without unmounting the workspace list and gates completion by action+row+request generation. Close/disposal/terminal action invalidates responses. Only explicit include/exclude changes the source selection, respecting eligibility, busy/uncertain gates and the 100-row cap; category/note drafts remain untouched.
- Tests cover auth, wrong conversation, absent displayed row, cancelled/replaced/archived action, old preview, query bounds, multiple/empty-note matches, day/type/amount/account/refund identity, deleted references/candidates, database byte equality and no extra AI calls. Android helper tests cover typed full notes/pagination/refunds, malformed results, late-response isolation and selection/draft independence. Device scroll/back/large-font/weak-network acceptance remains separate.

## Scenario: Assistant conversation failure and presentation correctness

### 1. Scope / Trigger
Persisted assistant chat can fail independently of a successful provider connection test; progress is not evidence of ledger mutation.

### 2. Signatures
`POST /api/v1/assistant/conversations/:id/messages` continues returning `{items}`; a caught error appends `kind=error`, `content.error={code,message}`. `AssistantProgress.state` accepts `running | complete | failed` without a schema migration.

### 3. Contracts
- Failed turns set their running progress to failed, never successful completion. Legacy complete means processing ended only. No automatic financial retries or confirmation.
- Known provider/config errors have stable codes and safe fixed guidance. Unknown error messages, raw provider bodies and credentials are not serialized.
- Android renders one safe error block and no raw content.text when an error exists. Empty historical complete progress is omitted; displayed scroll indices must use the same filtered list.
- Known date fields are formatted, never naked milliseconds; integer cents display explicit currency. Expanded before/after details retain public account/category reference changes while excluding credentials and fingerprints.

### 4. Validation & Error Matrix
| Condition | Message behavior |
|---|---|
| Provider abort at configured timeout | AI_PROVIDER_TIMEOUT, failed progress, no ledger write |
| Provider/network/non-2xx error | AI_PROVIDER_ERROR, safe guidance (not proof of network cause) |
| Invalid response path/turn | Stable AI/assistant error, no raw response |
| Old complete progress | Readable, not evidence of successful booking |
| Unknown error code | Generic safe fallback |

### 5. Good / Base / Bad Cases
Good: model prepares a pending card; human must confirm separately. Base: connection test passes but real assistant call times out; report that difference. Bad: failed request shows completed/saved or raw provider error.

### 6. Tests Required
Server assistant route/contracts test failed state, safe known/unknown errors and unchanged ledger. Android helper tests error dedup inputs, terminal filtering, malformed dates, currency, sensitive parent objects, retained public before/after references. Build/unit/mock evidence is not live acceptance.

### 7. Wrong vs Correct
Wrong: catch -> complete; render both content.text and error.message; date.toString(). Correct: catch -> failed; one code-mapped error; explicit date and cent formatting with no automatic ledger confirmation.

## Scenario: Human-reviewed merged bill import

- The dedicated multi-file workspace contract (routes, dedicated DTOs, migration 012, feature-scoped limits, live view/review token, idempotency, category approval and atomic confirm) is specified in [Merged Bill Import](./merged-bill-import.md). Keep the legacy single-file path separate; its 200-preview/100-confirm and the generic assistant JSON 200/100 bounds are not batch capacity.
- The batch analysis remains advice only. GET/review/confirm do not call the provider. The final confirm retransmits source bytes and never reruns AI; original byte content is not persisted.
- Category suggestions are not approval. Only an explicitly approved suggestion referenced by selected rows is created/reused within the final ledger transaction. The current wire encoding is `resolution:'create'` plus optional `reuseCategoryId`.
- Analysis publication is all-or-nothing for AI-origin suggestions; failure clears partial AI output and leaves manual review available. Deterministic fallback is independent and never described as successful AI classification.
- Numeric file/parser/inflate/time limits are source-enforced caps but remain uncalibrated until tested against representative exports. Synthetic evidence is not real-export benchmark evidence.

### Wrong vs Correct

#### Wrong

```ts
// Do not widen generic assistant JSON or treat advisory classification as user approval.
normalizeAssistantJson({ rows: merged500Rows });
const approved = allAiSuggestions;
```

#### Correct

```ts
// Use dedicated batch contracts; explicit review approval and selected rows gate category writes.
const review = batchService.review(conversationId, batchId, normalizedUserReview);
const committed = batchService.confirm(conversationId, batchId, {
  reviewToken: review.reviewToken,
  expectedVersion: review.version,
  files: retransmittedOriginals,
});
```

## True assistant streaming
The additive generation/choice protocol, parser/timeout bounds, atomic finalization and Android cancellation rules live in [Assistant streaming](./assistant-streaming.md). Preserve ordinary buffered endpoints. A successful connection test does not prove live streaming or draft-flow acceptance.
