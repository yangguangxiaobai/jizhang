# Native Client Delivery and API-only Hosting

## 1. Scope / Trigger

The current Android feature catalogue is [`clients/android/README.md`](../../../clients/android/README.md). Android UI/repository or consumed API changes must update the affected stable feature IDs, fields, limits, entry points, API coverage and known gaps in the same change. Keep source-audit evidence distinct from device acceptance; preserve removed IDs. The UI redesign document describes intent, not verified runtime capability.

The repository's target is API-only hosting; the `packages/web` client and its
dedicated tooling are retired. This repository change does not establish that the
existing production server has been upgraded. Android and HarmonyOS 4 use the Kotlin
APK; HarmonyOS 5/6 work is deferred. This supersedes earlier plans requiring a
production SPA or a replacement domain.

## 2. Signatures

- Public backend: `https://jz.yansuu1.xyz/api/v1/**`.
- Health: `GET /api/v1/health` returns the existing status/version/uptime object.
- `buildApp(options: BuildAppOptions)` builds an API-only Fastify instance;
  static files and SPA fallbacks are not production responsibilities.
- Android continues to send `X-Requested-With: fetch` for mutations and uses the
  `jizhang_session` cookie. Preserve backend auth and shared ledger signatures.
- Android `apiRequest(method, url, body)` in `net/ApiClient.kt` centralizes request
  construction; `JizhangCookieJar(read, write)` centralizes cookie storage/matching.
- Known-server helper: `bash deploy/cutover-known-server.sh [--preflight-only]`.
  Its fixed topology is specific to the inspected Ubuntu server, not a portable
  installer. Preflight includes protected inspection capture, rollback tagging
  and prepared deployment-key updates; it never stops a container.

## 3. Contracts

- `/`, old page URLs, `index.html`, old JS assets, service workers and manifests
  must never return the former Web UI, even when old build files remain on disk.
- `WEB_DIST_DIR` from an old container configuration must not re-enable hosting.
- Preserve `/data`, actual existing volume identity, SQLite data and required
  encryption/configuration secrets during upgrades. Do not create an empty volume
  and call it a migration.
- Host Caddy, including a Linux container using `network_mode: host`, forwards
  to `127.0.0.1:8081`. A bridge-network Caddy container needs a reachable service
  on a shared Docker network instead. Inspect the actual network mode before
  selecting an overlay; do not infer it merely from Caddy running in Docker.
  Neither application variant takes ownership of the host's ports 80/443.
- Android's default server URL is configurable. Changing it must not send the
  previous server's credentials to the new server.
- Bodiless POST/PUT/PATCH must use an empty OkHttp body with no media type;
  passing a null body is rejected by OkHttp before HTTP. Do not add JSON content
  type, which Fastify rejects for an empty JSON body.
- Match stored cookies by expiry, domain, path and Secure rules, and persist
  sessions across process restart. Logout and authorization expiry clear them.
- Returning from an expired session must not trust a remembered username. The
  login screen can auto-enter the shell only after an existing cookie and an
  actually completed successful `/auth/me` refresh; timeout or absent cookie
  cannot reuse stale account state.
- Do not restore static hosting or a Web reference-host switch in `buildApp`;
  preserve API-only regression coverage instead.
- Compare credentials, AI encryption-key presence/value and effective session
  lifetime with the old container's actual environment, not just an old `.env`
  file. Never shell-source the environment or print secret values. Docker-run
  maintenance needs an effective env file; rollback Compose must escape literal
  dollars and explicitly restore the old image's `WEB_DIST_DIR=/app/public`.
- The base Compose heap setting is a new-install default, not evidence of the
  old container's actual `NODE_OPTIONS`. Known-server cutover captures the old
  value in a private runtime override and includes that file in config, recreation,
  recovery and recorded future management commands. Keep the equality guard;
  changing the immutable uploaded source or skipping validation is not a fix.
- Compose canonical JSON can serialize literal dollars as doubled dollars.
  Detect raw versus escaped output using a private config-only literal sentinel
  on the same CLI before comparing environments. Decode exactly one serialization
  layer only when proven escaped; genuine literal `$$` must remain unchanged in
  raw output. The probe performs no pull or container operation.
- Cutover preserves the exact original volume and existing Compose project,
  snapshots after quiescing the app and recreates only the API with `--no-deps`.
  Worker and Caddy IDs remain unchanged. Protect old inspect/env/config and image
  references outside source/build contexts. Failure before recreation restarts
  the original app; later failure stops the new app and provides manual recovery,
  never silently restores a snapshot over possible new writes.

## 4. Validation & Error Matrix

| Request / condition | Required outcome |
|---|---|
| `GET /api/v1/health` | Existing JSON health response |
| `GET /` or old non-API page/asset path | `404`, JSON `error.code=NOT_FOUND` |
| Unknown API while authenticated | `404 NOT_FOUND`, JSON |
| Unknown API while unauthenticated | Preserve the auth guard's `401` contract |
| Mutation missing the required CSRF header | Preserve `403 CSRF_REQUIRED` |
| Leftover Web files or legacy `WEB_DIST_DIR` | Same API-only behavior |
| Expired native cookie or API 401 | Clear session, show login, no empty-shell loop |
| Startup auth timeout with old username | Remain on login with visible feedback |
| Changed data mount, credentials or AI key during cutover preflight | Reject before service stop; diagnostics contain key names only |
| Final backup/cold archive fails before recreation | Restart original app |
| Post-recreation health/data verification fails | Stop new API; keep protected rollback evidence; no automatic DB overwrite |
| No connected device or accessible server | Mark runtime acceptance pending |

## 5. Good / Base / Bad Cases

- Good: an APK logs in over Caddy HTTPS, records a transaction and reads the
  server-computed budget while the domain root returns JSON 404.
- Base: local API tests and APK compilation pass, but device/server access is
  absent. Record those checks separately; do not claim full delivery.
- Bad: a stale `index.html` silently re-enables the SPA, or an image rebuild uses
  a new empty Compose volume and hides the user's old ledger.

## 6. Tests Required

- `packages/server/test/app.test.ts`: assert status, JSON content type and
  `NOT_FOUND` for root, former pages, JS, manifest and service-worker paths with
  leftover build files and the obsolete environment setting.
- Existing auth/ledger tests: preserve authentication, CSRF, data persistence
  and server/shared accounting behavior.
- Android: test empty-body mutations, cookie matching/persistence/isolation and
  critical API payload contracts; then record device evidence for the complete
  feature checklist and login -> record -> budget-change flow.
- Native regression files: `net/NetworkContractTest.kt` and
  `ui/InputContractTest.kt` under `clients/android/app/src/test/java/`. Device
  tests must also expire an isolated server session while the shell is mounted,
  request protected data and verify return to login without automatic reentry.
- Deployment: build/run the actual image, verify HTTPS, restore a consistent
  backup into an isolated location and compare the ledger after migration.
- `python -m unittest deploy.test_cutover -v`: run the actual helper and embedded
  Python against fake Docker/HTTP in temporary directories. Assert only the API
  is recreated, critical effective values match, preflight rejects unsafe state,
  backup failure restarts the old app and later failure performs no DB restore.
- Check delivered helper bytes/checksum match reviewed source. These mock checks
  do not establish that production has switched; record operator evidence.
- Regressions must include old heap options differing from the base default and
  raw/canonical dollar output with genuine doubled-dollar literals. Assert the
  generated override participates in both validation and recreation.
- Delivered shell scripts and SHA256 sidecars use LF, including when packaged
  on Windows; check exact source bytes and checksum filename handling.

## 7. Wrong vs Correct

- Wrong: restore `sendFile('index.html')` or a static-hosting switch for old Web tests.
  Correct: keep the server API-only and return JSON 404 for non-API requests.
- Wrong: treat APK compilation or local API tests as full Android or production
  acceptance. Correct: retain relevant non-UI API regressions, and record device
  and deployment acceptance separately. Explicit Web retirement authorization
  replaces the old requirement to finish Android parity before deletion.
- Wrong: copy only a live WAL-mode `.db` file for a deployment backup.
  Correct: use the existing consistent backup/verification commands and verify
  restoration before upgrading; preserve the old image/config for rollback.
- Wrong: skip `/auth/me` when there is no cookie, then auto-enter on a stale
  `auth.username`. Correct: require an existing cookie and completed refresh
  before using the refreshed username to enter the shell.
- Wrong: assume every container's loopback is isolated and apply the bridge
  Caddy overlay to the user's host-network Caddy. Correct: host-network Caddy
  shares the host network namespace and can use the API's loopback publication;
  validate/reload it through `docker exec`, not the host's service manager.

## Android bill-account query contract

### Scope and signatures

The bill page selects funding accounts, not login users or separate ledgers.
Reuse `GET /api/v1/transactions?from=&to=&accountId=&type=&categoryId=&tag=&q=&limit=&offset=`
and `GET /api/v1/accounts?includeDeleted=true`; do not add a parallel account-ledger
endpoint merely to expose an existing filter. Bill-page choices reuse the native
`ListChoice(label, choices, selected, onSelect)` component.

### Contracts

- All accounts means **omit** `accountId`; a single account means its exact ID,
  never its display name or type. Other applied predicates remain AND-composed.
- The native monthly window is `[from,to)`. The bill page now automatically
  reads complete monthly results in batches up to 500 (100000-row safety cap),
  with no visible page controls; linked pickers retain their own pagination.
  Scope changes reset offset to 0. Reject changed totals, duplicate IDs and
  missing pages rather than showing a partial month as complete. `total` comes
  from the server matching COUNT, not the current page length.
- Historical account metadata uses `includeDeleted=true`. The existing account
  DTO has no deletion flag: a missing name means unavailable information, not
  evidence that the account was deleted. Live historical bills remain queryable
  after their funding account is soft-deleted; deleted bills remain excluded.
- Account choices must load independently of transaction success. A metadata
  failure offers retry and must not silently switch the selected account.
- Each list result belongs to a complete immutable query/page and a load
  generation. Scope changes invalidate old success, error and finalization;
  rendering must not relabel previous-scope rows or counts before a new effect
  starts. Same-scope refresh may retain explicitly identified old results.
- Salaries, transfers and all-history balances remain separate contracts.
  GET `/api/v1/transactions/daily-summary` returns daily ordinary-transaction
  expense/income/count under the same filters, ignoring pagination. Require a
  bounded range (at most 32 days) and validated IANA `timeZone`; day keys are
  `yyyy-MM-dd` in that zone. Android whole-hour fixed-offset IDs are normalized
  to equivalent IANA `Etc/GMT` names (inverted sign); unsupported custom fractional
  fixed-offset IDs fail visibly instead of guessing historical regional rules.
  Import current shared contribution rules (refunds
  count as income, never revive obsolete negative-expense semantics). Do not
  include salaries/transfers or sum bills on Android. Old servers may return
  404: preserve working rows, show unavailable totals rather than fake zero.
  Summary state shares query/generation ownership with rows; changed day counts
  between list and summary are unavailable, not silently accepted.

### Error / validation cases and required tests

| Condition | Required behavior / assertion |
|---|---|
| Two real funding accounts | Account-specific rows and total are isolated; all-account result is their union |
| Account A page 2 -> account B | B requests offset 0; delayed A success/error/finally cannot mutate B |
| A -> B -> A or refresh overlap | Earlier generation cannot win merely because its query equals the current query |
| New scope loading/failure | No old-scope rows/count; distinguish unknown/loading count from a successful empty result |
| Transaction request fails | Account metadata still loads and remains selectable |
| Metadata fails | Visible retry, stable selection, previous successful choices retained |
| Tail page emptied by delete | Correct the page within the same query; use the owned load path rather than unguarded recursion |
| Soft-deleted account with live bills | Include its historical metadata and bills without enabling deleted transactions |

**Good:** production-used query/state helpers have deterministic JVM ownership
regressions; isolated `app.inject` tests cover account predicates and pagination.
**Base:** source wiring, unit tests, compilation and lint pass; device dropdown,
large-font and TalkBack acceptance is still pending. **Bad:** helper tests never
exercise the UI's actual query/state path, or build success is called device proof.

**Wrong:** rely on one `LaunchedEffect(accountId)` cancellation while refresh and
delete use unrelated `scope.launch { reload() }`. **Correct:** every load entry
shares request ownership, and stale error/finally paths are rejected alongside
stale rows. Coroutine cancellation of a synchronous ordinary OkHttp request does
not establish immediate socket cancellation; do not promise that behavior.

### Provider configuration presentation

Keep three facts distinct in native settings: persisted enabled state, unsaved draft changes, and the outcome of an explicit connectivity test. A draft switch is not evidence that the server is enabled or the provider is reachable. A successful model listing is metadata, not an inference capability test. Fixed save/test actions sit outside the settings scroll with bounded IME-aware content; moving controls must preserve secret retention/clear confirmation, unreadable-template omission and explicit save semantics. Popular presets remain clearly separate from fetched model IDs. UI layout compilation and pure-state tests do not establish actual small-screen/keyboard/touch acceptance.

## Scenario: native fuzzy bill search

### 1. Scope / Trigger

An Android ledger search spans the list, daily-summary, SQLite and client paging. Ordinary monthly views and older callers must retain their prior contracts.

### 2. Signatures

- `GET /api/v1/transactions?search=<keyword>&limit=<1..500>&offset=<n>`; omit `from`/`to` for all history, or send both for the selected month.
- `GET /api/v1/transactions/daily-summary?search=<keyword>&from=<ms>&to=<ms>&timeZone=<IANA>`; summary retains its existing maximum 32-day window.
- A nonblank `search` response from either endpoint includes `searchVersion: 1` and `searchRevision: <64 lowercase hexadecimal SHA-256>` even for empty results.

### 3. Contracts

- Search literally matches the note, historical category/account name, decoded tag elements, or integer-cents amount formatted as `yuan.two_digits`. SQLite ASCII case-folding applies; non-ASCII is case-sensitive. `%`, `_`, backslash and NUL are literal. The older `q` is still note-only.
- Other filters combine with search using AND. Live bills only by default; salary and transfers are separate. List pages and monthly summary use the same predicate.
- For searching only, results have stable `date DESC, updated_at DESC, id ASC` ordering. The revision is a hash of the exact ordered matching rows and refund summary; list rows/count/revision and summary/revision each share one read transaction. Client must compare every page and the matching summary revision, and must clear invalidated results on a mismatch. This detects observable changes, not a change followed by perfect restoration between requests.
- All-history search does not call the 32-day summary or fabricate daily totals. The client must verify the version on every response: old servers can silently ignore unknown query parameters.
- The server prechecks at most 10,000 matching bills and 16 MiB of raw UTF-8 transaction text fields per search, before hashing, without truncating. Preflight scans the predicate and is not a hard latency guarantee. Non-search views retain their previous limits.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing session | 401 for both endpoints |
| Missing or malformed search marker/revision | Reject as unsupported/invalid; never present unfiltered results as a search |
| Match count > 10,000 or raw text > 16 MiB | 400 validation with a Chinese prompt to narrow scope; no partial list |
| Revision changes between pages or list and summary | Invalidate searched rows and prompt refresh; do not mix snapshots |
| Ordinary monthly summary request fails | Keep valid rows and show summary unavailable |

### 5. Good / Base / Bad Cases

Good: `12` finds displayed `12.00` and `112.50`, including across years, and the same filtered month yields matching list/summary revisions. Base: an older server supports non-search monthly viewing but a search fails explicitly. Bad: compare only page totals (same-count replacements are missed) or use `LIKE` for the new search (NUL is not matched literally).

### 6. Tests Required

Use isolated API tests for note/category/account/tag/amount, Unicode and NUL literals, legacy `q`, auth, stable ordering, both exact limit boundaries, equal-count replacement, amount/refund changes and list-summary revisions. Android JVM tests must exercise actual request params, missing/changed marker and revision on all pages including empty, stale generation, summary invalidation, and error display; build/lint and real-device interaction are distinct evidence.

### 7. Wrong vs Correct

**Wrong:** accept `total` and unique IDs as proof that multiple pages form one snapshot, or silently truncate an expensive query. **Correct:** compare a server-issued revision across the complete query, invalidate on mismatch, and explicitly reject an over-limit search before hashing.

