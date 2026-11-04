# Backend compatibility and API freeze — AI spending organization

Date: 2026-10-19. This freezes a source-backed proposal for backend/Android integration; it is not production code or user approval of numerical limits. Source inspection only except the synthetic harness recorded separately. No provider, database, export, production or device was exercised.

## Evidence: actual repository head and boundaries

- Migration runner `packages/server/src/db/migrate.ts` imports and registers migrations 001–012; actual current head is `012-import-batches`. Any future schema work starts at 013, additive TypeScript module only; do not alter released migrations.
- `transactions.tags_json` is a normalized JSON array of **names**, not IDs. `tags.ts` clamps names at 32 chars and associations at 20, trimming and deduplicating names. Read/write compatibility paths include `TransactionService` CRUD/list/filter and `listTags`, `MasterDataService.listTags/renameTag/deleteTag/rewriteTags`, `/api/v1/tags` GET/PATCH/DELETE, assistant transaction draft and tag management tools, organization merge/undo, CSV export/import, and merged import transaction inserts. Old clients round-trip these string arrays. Name is presently identity; duplicate same name on separate branches cannot be represented.
- Tag filtering currently matches exact quoted JSON names using LIKE; it is not hierarchy aware. Legacy `tags_json` in both live and soft-deleted transactions is retained by normal default reads in different contexts. Export is live rows; tag vocabulary counts live rows; rename/delete currently rewrite live rows only.
- Categories are a different hierarchy (`categories.parent_id` migration 007). `MasterDataService.requireParentId` allows one parent level, expense types only. `TransactionService.assertCategoryUsable` rejects an active category with any live child for *new/updated transaction* category references. Existing historical transaction references are not automatically changed; templates hold category IDs in `modules_json`; recurring rules/pending occurrences also hold category references. `TemplateService` checks live categories, positive finite ratios summing to 1 within tolerance, and no parent+child pair; it does not use TransactionService's bookability check. Category soft deletion does not cascade historical transaction labels.
- Existing AI organization `ai-organization-service.ts` semantically samples at most 200 live rows, while deterministic merge scans have different coverage; the current API is POST preview/apply/undo with merge-only writes. Existing audit migration 008 is append-only and merge-specific; conditional undo conflicts if changed fields differ. It cannot be repurposed without extending its action/projection validation.
- Existing provider-work synchronization is `assistant-active-lock.ts`, shared by generation/legacy turns and import analysis. `import-batch-analysis.ts` claims/releases it, establishes DB fences before provider work, uses an AbortController, and fences late publication. Organization analysis must use the same shared provider lock and preserve its ownership/cancellation semantics; do not create a second lock. Existing lock is conversation-scoped, so the feature needs a stable existing/created assistant conversation context, or a small generalized lock owner change explicitly reviewed. A local process `Map` is not restart-durable and is not a replacement.
- Shared expense contribution is authoritative (`packages/shared/src/types.ts`; budget/stats services use it). Refunds are income transactions with `isRefund`; do not reinterpret them as negative expenses. Ratio suggestion evidence uses the same shared engine aggregation and does not claim a newly-defined gross/refund formula.

## Compatibility decisions proposed

### Category structure, no historical reclassification

A proposed new category hierarchy must not turn an actively referenced bookable leaf into a parent. The safe default is: create a **new top-level parent/module node** and new child categories, then only assign selected in-range transactions to newly created bookable children after explicit review. Do not attach children to any existing category ID referenced by a transaction, template, recurring rule, or pending occurrence; reject that proposed structure as `CATEGORY_PARENT_IN_USE` with affected-reference counts. This stricter check avoids making existing bill-entry behavior fail merely because the category is historical/template referenced. No existing bill, recurring rule, template, snapshot, or category is moved, relabeled, deleted, or reinterpreted.

Structure-only and module-plus-budget cards must show category type/parent, created nodes, existing target categories and exact selected transaction changes. Existing categories can be targets only if they remain live, same type, and currently bookable. A template can name only categories accepted by existing template validation; do not change the current-cycle apply operation.

### Tag stable identity and legacy flat writer compatibility

Proposed schema at migration 013: additive `tags(id TEXT PRIMARY KEY, name TEXT, parent_id TEXT NULL, deleted INTEGER DEFAULT 0, created_at/updated_at)` with unique active sibling-name rule enforced in service (not global name uniqueness). Tag depth max 2. **Do not switch transaction storage to IDs in this task phase or drop/change `tags_json`.** Stable IDs may be introduced for hierarchy metadata, while transaction API continues exposing legacy names. A reversible mapping layer resolves a legacy name only when it has one unambiguous active entity; on multiple same-name entities under different parents, legacy writes/reads must remain flat and the hierarchy-aware operation must reject ambiguous name resolution rather than guessing branch. New child names must be globally unique among active entity labels until a future versioned client representation can carry IDs/path. This intentionally delays same-name labels across branches; silent aliasing is unsafe.

Backfill: distinct names from all transaction rows, including deleted rows, using defensive parser and deterministic ID derived from exact normalized legacy name (collision-checked), parent=null. Preserve original JSON bytes/association semantics; no rewrite. Unknown old-client names are not discarded: expose unresolved legacy names and ensure display/filter/export still round-trip them. A future versioned DTO may add `tagRefs[{id,name,parentId}]`, but old `tags:string[]` remains stable. No dual-writing a second associations table until every writer and import/export round-trip can participate atomically. Renaming an entity must update legacy name associations atomically using existing `MasterDataService` semantics; audit/undo records only changed projections. Same-name duplicate across branches must remain rejected while legacy flat storage is authoritative.

Hierarchy parent filtering will use a server-owned resolved set: selected parent ID -> canonical legacy names for parent and active direct children. Query membership must deduplicate transactions (`EXISTS`, not joins/count expansion), include direct parent name and any child name, and preserve exact-name matching. Child filter matches only its canonical name. Existing `tag` query remains unchanged; additive `tagId` query is versioned/feature-scoped and invalid simultaneous `tag`+`tagId` is 400. Legacy flat filters never infer hierarchy.

### Note suggestions lifecycle

Do not put original notes or provider payloads into run/card/audit storage. If notes are included in provider input, use existing bounded/redacted policy and only transiently in request memory. Suggestions are independent user-editable content: access is scoped to authenticated owner/run/card; persist only normalized proposed text, transaction ID, expiry, status; never persist source note or raw prompt/provider response. Proposed retention: active run/card TTL 24h; applied operation retains suggestion only if user explicitly chooses the note-suggestion card, then 30-day expiry, with explicit per-item clear/delete. GET must omit expired/cleared suggestions; DELETE is owner-checked and idempotent. Since the product accepted “displayed and stored separately” but has not approved a duration, 24h/30d are technical proposals, not locked policy; no product code should store them until parent review accepts exact lifecycle.

## Proposed frozen API (native contract)

All paths under `/api/v1/ai/organization-runs`; authenticated session and existing mutation CSRF (`X-Requested-With: fetch`). JSON errors retain `{error:{code,message}}`. Dates are calendar labels; server returns exact half-open epoch interval and IANA/OS timezone label returned by `Intl.DateTimeFormat().resolvedOptions().timeZone` (or explicit `server-local` if unavailable). Request uses exactly one scope form.

### Start analysis — explicit POST, never GET

`POST /api/v1/ai/organization-runs`

```json
{
  "scope": {"kind":"month","month":"2026-10"},
  "clientRequestId":"opaque-client-generated-id",
  "options":{"includeNoteSuggestions":true,"includeBudgetEvidence":true}
}
```

or `{"scope":{"kind":"range","startDate":"2026-10-01","endDate":"2026-10-19"},...}`. Strict ISO date validation, start <= end, mutually exclusive month/range. Calendar day selection is server-local and inclusive: response boundaries `[startAt,endExclusiveAt)`, `startDate`, `endDate`, `timeZone`. Query `transactions.deleted=0 AND date>=startAt AND date<endExclusiveAt`, sorted stable by date,id. Eligible count is exact before start acceptance. No sampling/truncation. Proposed bounds are provisional: 500 transactions max and 25 per sequential provider batch. Over-cap rejects before provider work and before run card (`413 AI_ORGANIZATION_RANGE_TOO_LARGE`), returns exact count/cap and suggestion to narrow range; cap not approved/calibrated. Above 500 must never return first 500 as complete.

Success `202 {"run": OrganizationRunSnapshot}` with opaque `runId`; exact identical clientRequestId+canonical body is idempotent replay (200 existing snapshot); same key/different body is 409 `AI_ORGANIZATION_IDEMPOTENCY_MISMATCH`. One user/provider-work lock is claimed before scheduling. Active lock conflict 409 `AI_ORGANIZATION_BUSY` with safe retry guidance. No rows -> 200 complete run with zero batches and no actionable proposal (not provider-called).

### Read progress / completed result

`GET /api/v1/ai/organization-runs/:runId` is read-only; no provider invocation or mutation. `Cache-Control: no-store`.

```json
{"run":{
 "runId":"...","status":"queued|running|complete|failed|cancelled|interrupted",
 "scope":{"startDate":"2026-10-01","endDate":"2026-10-19","startAt":1790812800000,"endExclusiveAt":1792454400000,"timeZone":"..."},
 "coverage":{"eligible":51,"processed":25,"batchSize":25,"batchCount":3,"completedBatches":1},
 "progress":{"phase":"queued|provider|normalizing|ready|terminal","percent":33},
 "createdAt":0,"updatedAt":0,"expiresAt":0,
 "error":null,"card":null
}}
```
Percent is integer; do not report 100/ready until every batch validated and card snapshot persisted. Failed/cancelled/interrupted always `card:null`, regardless of completed prior batches. Full result endpoint caps cards/projections explicitly; no provider raw output. `GET` never restarts work. On process restart, any persisted `queued|running` becomes `interrupted`, no auto-rerun, no card; user must explicitly start new run.

### Cancel

`POST /api/v1/ai/organization-runs/:runId/cancel` with `{ "expectedVersion": 3 }`. Cancels only analysis, aborts its provider signal, fences late batch completion, releases shared provider lock once terminal. 200 returns terminal snapshot. Repeated cancel is idempotent. Complete/apply states return 409 `AI_ORGANIZATION_STATE_CONFLICT`. Cancel causes no ledger/master-data writes.

### Review snapshot / card retrieval

Run GET exposes `card` only at complete. Cards contain full coverage and exact eligible transaction IDs, before/after category IDs and tag names/IDs, note proposals separately, new entity proposals with dependencies, template evidence/diff, version/fingerprint/expiry. Every eligible row has a proposal or explicit unchanged outcome; no sampled/silent omission. Provider output is normalized against server-owned rows/catalog; provider cannot add identifiers. Card limit is provisional and must accommodate all eligible rows at accepted cap.

`POST /api/v1/ai/organization-runs/:runId/refresh` is NOT part of v1: stale catalog/transaction changes require new explicit analysis. No hidden rebase/retry.

### Apply exactly reviewed selection, atomic/idempotent

`POST /api/v1/ai/organization-runs/:runId/apply`:

```json
{"cardVersion":1,"idempotencyKey":"...","selectedTransactionIds":["tx1"],
 "approvedTagIds":["tag-proposal-1"],"approvedCategoryIds":["category-proposal-1"],
 "budget":{"mode":"structure-only"}}
```

Module-budget alternative: `{"budget":{"mode":"template","target":{"kind":"new","name":"..."},"modules":[{"categoryId":"...","ratio":0.6},{"categoryId":"...","ratio":0.4}]}}`; or target `{kind:"existing","templateId":"explicit-id"}`. Request must match exact card proposals; arbitrary target IDs not in user-visible catalog/proposal rejected. Existing target selection is explicit. Ratios are complete solution, positive finite, sum=1 per `validateModules`; new template shows full solution and existing template shows full affected before/after diff. No budget amount or current allocation write. Actual spending evidence is separate and uses shared `expenseContribution`/budget semantics.

All-or-none single SQLite transaction: revalidate owner, card/version/expiry, all selected IDs and before-state fingerprints, category type/bookability/reference constraints, tag hierarchy/name ambiguity, template state/ratio rules; create explicitly approved entities; update only selected in-scope `category_id` and `tags_json`; optionally write future template row; append minimal audit/idempotency. Never update note, amount/type/account/date/is_refund/refund_links, salary/allocation/recurring facts. Provider/network calls are outside transaction. Identical idempotency replay returns original operation result; same key/different canonical payload 409. Stale snapshot is 409 `AI_ORGANIZATION_CONFLICT`, with no partial writes.

### Conditional undo

`POST /api/v1/ai/organization-operations/:operationId/undo` body `{ "idempotencyKey":"..." }`. Compares every operation-owned after-state and entity reference set first, then restores only category/tag/template projections atomically. Any collision—including created tag/category now referenced outside operation—returns 409 `AI_ORGANIZATION_CONFLICT` and makes zero changes; never partially undo. New entity is soft-deleted only when no external transaction/template/recurring reference exists; otherwise whole undo conflicts and retains it. Identical undo replay returns original result.

## Status / error matrix

| Status / code | Condition | Client behavior |
|---|---|---|
| 400 `AI_ORGANIZATION_INVALID` | malformed scope/date, unknown field, conflicting options | show validation; no run |
| 401 existing auth | no/expired session | re-auth |
| 403 existing CSRF | mutating request lacks CSRF header | resend only after normal client CSRF handling |
| 404 `AI_ORGANIZATION_NOT_FOUND` | run/operation absent or not owned | clear inaccessible local state; do not reveal owner |
| 409 `AI_ORGANIZATION_IDEMPOTENCY_MISMATCH` | reused request key with changed body | new client request ID after user review |
| 409 `AI_ORGANIZATION_BUSY` | shared assistant provider-work lock held | show busy; explicit retry later |
| 409 `AI_ORGANIZATION_CONFLICT` | stale transaction/category/tag/template, or undo reference collision | discard card and explicitly rerun/review; no silent merge |
| 409 `AI_ORGANIZATION_STATE_CONFLICT` | cancel/apply incompatible terminal state | reload run snapshot |
| 413 `AI_ORGANIZATION_RANGE_TOO_LARGE` | eligible count exceeds provisional feature cap | narrow dates; no sample, no provider call |
| 422 `AI_ORGANIZATION_CATEGORY_PARENT_IN_USE` | proposed child under referenced existing category | reject that structure; suggest new parent/children |
| 422 `AI_ORGANIZATION_TAG_AMBIGUOUS` | legacy name maps to multiple entities/branches | retain legacy name, request explicit stable-ID mapping |
| 502 `AI_PROVIDER_ERROR` | network/non-2xx/oversize provider response | entire run failed; explicit new run only |
| 502 `AI_RESPONSE_INVALID` | malformed/incomplete/unknown references/normalization failure | entire run failed; no card |
| 503 existing `AI_NOT_CONFIGURED` / `AI_SECRET_UNAVAILABLE` | no usable provider config | explicit setup; no card |
| 504 `AI_PROVIDER_TIMEOUT` | configured provider request deadline | entire run failed; no card |
| 500 generic `INTERNAL_ERROR` | unexpected server failure | safe generic response; inspect server logs without note/token/body |

## State, ownership, retry, cancellation, restart and batch failure

`queued -> running -> complete|failed|cancelled|interrupted`; terminal state is immutable. `complete` alone owns a review card. Progress records `{phase, completedBatches, batchCount, processedTransactions, totalTransactions}`. Process chunks sequentially; run snapshot and each progress update must be durable and versioned. Lock owner includes run ID; a late result must check owner+run state+version before publication. Cancel first commits cancellation/fence, then aborts controller; failure first marks failed and clears card/proposals, finally releases lock. Retry creates a **new** run/clientRequestId and does not reuse old partials. Restart marks nonterminal records interrupted and releases/reconciles shared lock; never calls provider automatically. One failed/malformed batch invalidates all prior outputs and produces no card. Apply/undo idempotency uses a canonical request hash and persisted result in the same write transaction.

## Compatibility and general filtering API strategy

Keep existing transaction `tags:string[]`, `/tags` name endpoints, `?tag=<name>`, CSV columns and old client behavior byte-compatible. Add a separate versioned hierarchy DTO/endpoint only when implementation includes Android: `GET /api/v1/tags/hierarchy -> {items:[{id,name,parentId,depth,deleted,count}]}` and `GET /api/v1/transactions?tagId=<stableId>` (parent means parent+children, deduplicated; child means child only). Existing `tag` and all other filters remain exact legacy predicates and may be combined with existing category/account/type/date filters as AND; hierarchy filter is one OR-set internally, applied once with EXISTS, never joins that multiply rows. Reject simultaneous `tag` and `tagId`. Cursor/count query and list DTO stay unchanged. Do not make IDs required until all old writer/import/export paths are proven compatible.

## Android integration handoff

- Start with explicit POST only; expose month shortcut/custom inclusive dates; display returned server labels/time zone and exact eligible count before review.
- Poll GET progress; GET must not start work. Render all statuses and full batch counts; failed/cancelled/interrupted cards are not confirmable. Client process death reloads GET; `interrupted` requires explicit new run.
- On complete show all in-scope rows and before/after category/tag state; original note is immutable and shown separately from suggestion. Confirm only one selected card via apply POST; cancel uses cancel endpoint and makes no writes.
- On 409 conflict discard review state and ask user to rerun, never auto-merge/re-submit; on uncertain apply response GET run/operation state rather than generating again. Persist clientRequestId/idempotencyKey across network retry of identical body.
- Keep existing flat `tags` and filter query working. Add hierarchy screen/filter only against stable ID endpoint; show ambiguous legacy entries without guessing parent.
- Future-template update is opt-in and explicitly names template; display complete ratio solution/diff; do not claim current budget changed.

## Explicitly provisional / parent-review items

1. 500 eligible-row hard cap and 25 sequential batch size: proposals only; synthetic harness cannot establish production heap/provider safety. User-visible cap requires explicit review after evidence.
2. Note suggestion 24-hour active / 30-day applied retention is a proposal; approval required before persistence behavior.
3. Existing-category parent-in-use rule is conservative compatibility policy recommended by source constraints; parent may choose whether to accept it. No implementation should silently choose reclassification as an alternative.
4. Same-name tags under distinct parents are not addressable by legacy string associations. Proposed v1 rejects/defers such identities until stable-ID clients exist.

## Scope boundary for this technical gate

Expected outputs only: this contract, `research/organization-protocol-v1.md`, synthetic benchmark harness/results. Do not alter product source, task PRD/design/implement, Android files, backend specs, deployment, environment/provider configuration, dependencies, Git index/history, production data, or baseline artifacts.