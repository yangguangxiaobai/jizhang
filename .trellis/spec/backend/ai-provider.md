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
