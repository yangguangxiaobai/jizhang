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
  and `responseSchema`; JavaScript, eval, JSONPath expressions, and `secret` references are
  forbidden.
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
