# Organization Protocol v1 — proposed native API contract

Status: frozen proposal for parent/backend+Android review, 2026-10-19. This is a technical handoff, not implemented API behavior and not approval of provisional capacity or note-retention policy. Normative requirements come from the approved task authorization and PRD; details below are recommendations where marked proposed.

## 1. Shared DTOs

```ts
type RunStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
type RunPhase = 'queued' | 'provider' | 'normalizing' | 'ready' | 'terminal';
interface OrganizationScopeDto {
  startDate: string;              // YYYY-MM-DD, inclusive, server-local calendar
  endDate: string;                // YYYY-MM-DD, inclusive, server-local calendar
  startAt: number;                // epoch ms, inclusive
  endExclusiveAt: number;         // epoch ms; query is [startAt,endExclusiveAt)
  timeZone: string;               // server IANA zone where available
  eligibleCount: number;          // exact live transaction count at run snapshot
}
interface OrganizationCoverageDto {
  eligible: number;
  processed: number;
  batchSize: number;              // 25 proposed, provisional
  batchCount: number;
  completedBatches: number;
}
interface OrganizationRunDto {
  runId: string;                  // opaque, owner-scoped
  version: number;                // increases on each persisted transition
  status: RunStatus;
  phase: RunPhase;
  scope: OrganizationScopeDto;
  coverage: OrganizationCoverageDto;
  progressPercent: number;        // integer; 100 only after complete card is durable
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  error: null | { code: string; message: string };
  card: null | OrganizationReviewCardDto;
}
interface CategoryChangeDto {
  transactionId: string;
  transactionDate: number;
  before: { categoryId: string; categoryName: string };
  after: { categoryId: string; categoryName: string };
  reason: string;
}
interface TagChangeDto {
  transactionId: string;
  before: Array<{ id?: string; name: string; parentId?: string | null }>;
  after: Array<{ id?: string; name: string; parentId?: string | null }>;
  reason: string;
}
interface EntityProposalDto {
  proposalId: string;
  kind: 'tag' | 'category';
  name: string;
  parentProposalId?: string | null;
  type?: 0 | 1;
  evidenceTransactionIds: string[];
  reason: string;
}
interface NoteSuggestionDto {
  transactionId: string;
  suggestedNote: string;
  reason: string;
  // Original note is not copied into this DTO or persisted audit.
}
interface OrganizationReviewCardDto {
  cardVersion: number;
  fingerprint: string;             // opaque; server revalidates authoritative state
  expiresAt: number;
  coverage: { eligible: number; categorized: number; unchanged: number };
  transactionChanges: Array<CategoryChangeDto | TagChangeDto>;
  entityProposals: EntityProposalDto[];
  noteSuggestions: NoteSuggestionDto[];
  budgetEvidence: Array<{ categoryId: string; expenseCents: number }>;
  // Budget evidence only. Never a proposed budget amount.
  budgetProposal: null | {
    mode: 'structure-only' | 'template';
    target: { kind: 'new'; proposedName: string } | { kind: 'existing'; templateId: string; name: string };
    modules: Array<{ categoryId: string; categoryName: string; beforeRatio?: number; afterRatio: number }>;
    ratioTotal: 1;
    effect: 'future-template-use-only';
  };
}
```

Card includes each eligible transaction exactly once: changed transaction projection(s) or an explicit unchanged disposition. It must not expose source note, provider prompt/body, secret, raw provider response, or arbitrary model-supplied IDs. The DTO is size-bounded by accepted run count and fields; a response that exceeds transport budget fails the run rather than truncating.

## 2. Endpoints and exact payloads

### Start (user gesture; never GET)

`POST /api/v1/ai/organization-runs` (CSRF, authenticated):

```json
{"scope":{"kind":"month","month":"2026-10"},"clientRequestId":"stable-retry-id","options":{"includeNoteSuggestions":true,"includeBudgetEvidence":true}}
```

or

```json
{"scope":{"kind":"range","startDate":"2026-10-01","endDate":"2026-10-19"},"clientRequestId":"stable-retry-id","options":{"includeNoteSuggestions":true,"includeBudgetEvidence":true}}
```

Exactly one scope variant; strict Gregorian ISO dates; inclusive range; server owns timezone/bounds/count. Return `202 {run}` (identical request replay `200 {run}`). Empty count returns terminal complete with zero batches and no actionable card. Counts above proposed cap are rejected before provider work with `413 AI_ORGANIZATION_RANGE_TOO_LARGE`; no accepted-prefix analysis.

### Progress/result (read-only)

`GET /api/v1/ai/organization-runs/:runId -> 200 {run}` with `Cache-Control: no-store`. Does no work. Owner is checked. Nonterminal run after restart becomes interrupted; never auto-runs on GET.

### Cancel analysis

`POST /api/v1/ai/organization-runs/:runId/cancel` body `{"expectedVersion":4}`. Returns `200 {run}` after durable fence; cancellation aborts provider signal and cannot publish late batch. Repeat is idempotent. Cancel after complete/apply is 409 state conflict. No data writes occur.

### Apply

`POST /api/v1/ai/organization-runs/:runId/apply`:

```json
{"cardVersion":1,"idempotencyKey":"stable-apply-retry-id","selectedTransactionIds":["tx-a","tx-b"],"approvedTagProposalIds":["tag-p1"],"approvedCategoryProposalIds":["cat-p1"],"budget":{"mode":"structure-only"}}
```

or full template proposal:

```json
{"cardVersion":1,"idempotencyKey":"stable-apply-retry-id","selectedTransactionIds":["tx-a"],"approvedTagProposalIds":[],"approvedCategoryProposalIds":["cat-p1"],"budget":{"mode":"template","target":{"kind":"new","name":"日常预算"},"modules":[{"categoryId":"cat-p1","ratio":0.6},{"categoryId":"cat-p2","ratio":0.4}]}}
```

Existing template target is `{kind:"existing",templateId:"explicit-id"}`. Ratios cover all modules and sum to 1 using existing validator tolerance. User sees full new-template solution or all affected before/after ratios for a chosen existing template. One SQLite transaction revalidates all preconditions, applies exactly selected projection, inserts approved entities, writes future template only, and records audit/idempotency. No source note or finance facts change. Any mismatch rolls back all.

### Undo

`POST /api/v1/ai/organization-operations/:operationId/undo` body `{"idempotencyKey":"stable-undo-retry-id"}`. Validate all operation-owned after-state and created-entity references before any update. Restore category/tag/template changes only; any conflict results in 409 and zero changes.

## 3. Status, lifecycle and progress

- `queued -> running -> complete|failed|cancelled|interrupted`; only complete contains card. Terminal state immutable.
- `processed` advances only after full batch normalization and durable checkpoint. `completedBatches` reports committed checkpoints; never imply eligible rows are fully analyzed until `processed===eligible` and card snapshot durable.
- Progress percentage 0–99 while work active; 100 only complete. Failed run keeps diagnostic counts but card null and no actionable partial proposal.
- Every batch sequential and tied to run ID, run version, shared assistant lock owner. Late response after cancel/restart/failure cannot publish.
- Retry is a new explicit POST with new request ID. No automatic retries that can duplicate cost or mutate; same request retry only replays current run.
- All provider batches succeeding but response/card normalization failure is whole-run failure.
- Persist run snapshot/progress/cancel fence/results for process restart. On boot set queued/running to interrupted and release stale lock owner. Never call provider during boot or GET.
- Store only minimal before/after projections and hash in audit; no notes/prompts/raw output/secret. Conditional undo is all-or-none.

## 4. Error response matrix

All body shape `{error:{code,message}}`.

| HTTP | Code | Contract |
|---|---|---|
| 400 | `AI_ORGANIZATION_INVALID` | malformed scope/options/body; no work |
| 401 | existing auth code | session absent/expired |
| 403 | existing CSRF code | mutation missing CSRF header |
| 404 | `AI_ORGANIZATION_NOT_FOUND` | absent or not-owned run/operation |
| 409 | `AI_ORGANIZATION_IDEMPOTENCY_MISMATCH` | same request/idempotency key, different canonical body |
| 409 | `AI_ORGANIZATION_BUSY` | shared assistant provider lock held |
| 409 | `AI_ORGANIZATION_CONFLICT` | stale card/source state or undo reference collision |
| 409 | `AI_ORGANIZATION_STATE_CONFLICT` | operation incompatible with terminal lifecycle |
| 413 | `AI_ORGANIZATION_RANGE_TOO_LARGE` | eligible set beyond proposed hard cap, no truncation |
| 422 | `AI_ORGANIZATION_CATEGORY_PARENT_IN_USE` | parent structure conflicts with referenced existing category |
| 422 | `AI_ORGANIZATION_TAG_AMBIGUOUS` | legacy name maps ambiguously; never guess branch |
| 502 | `AI_PROVIDER_ERROR` | provider transport/non-2xx/size failure; card null |
| 502 | `AI_RESPONSE_INVALID` | malformed response, unknown ID, missing/duplicate row; card null |
| 503 | existing `AI_NOT_CONFIGURED`/`AI_SECRET_UNAVAILABLE` | provider not usable |
| 504 | `AI_PROVIDER_TIMEOUT` | provider deadline; card null |
| 500 | `INTERNAL_ERROR` | safe fixed message only |

## 5. Data compatibility and transaction filters

- Old APIs stay unchanged: `tags:string[]`, `/api/v1/tags` name-based CRUD, `?tag=name`, CSV field, import/export, transaction CRUD, assistant tools. Never require tag IDs from existing Android clients.
- Proposed additive hierarchy `GET /api/v1/tags/hierarchy -> {items:[{id,name,parentId,depth,count}]}`. Stable IDs are hierarchy identity; legacy flat JSON associations retained and never rewritten by a metadata-only backfill.
- New hierarchy-aware list filter `GET /api/v1/transactions?tagId=<id>`: parent includes direct parent plus any child; child matches only that child. Use one `EXISTS` predicate to prevent duplicate rows/count. It composes with current category/type/account/date/text filters using AND. Existing `tag` retains exact legacy behavior. Simultaneous `tag` and `tagId` is 400. Do not introduce two independent pagination/count interpretations.
- With legacy names, same-name sibling/path labels are ambiguous. Until a future ID-association DTO exists, prevent duplicates and reject ambiguous entity resolution. Do not silently remap name arrays.
- Category tree creation under an existing referenced category is rejected; use a newly created top-level node with new child leaves. Existing transaction/template/recurring/history references remain identical. Do not globally reclassify to preserve bookability.
- Category hierarchy and tags are distinct APIs, IDs, filters and tables.

## 6. Native Android implementation notes

- Month/custom date picker sends labels only; display exact server-returned interval and eligible count/timezone.
- Start analysis on explicit tap. GET polling is read-only. Keep process-death recovery from GET; interrupted requires user choice to start another run.
- Show progress batches (processed/eligible, completed/total) and distinguish running/failed/cancelled/complete. No apply button until complete card.
- Review every transaction diff; original note separate and immutable. Note suggestion has its own accept/discard action; no source note substitution.
- Apply sends exact selections and stable idempotency key; network retry reuses byte-equivalent request. If uncertain, GET current run/operation; never resubmit with altered body under old key.
- Conflict forces refresh by new analysis; no silent merge/rebase. Cancel is not undo.
- Keep flat tags UI/api compatible; hierarchical UI only uses ID endpoint and displays unresolved/ambiguous legacy names without inventing a parent.
- Budget card labels “未来模板方案”; explicit existing template selection, complete ratio diff, evidence separate from amount/current budget. Structure-only must not modify any template.
- Tests should assert all DTO fields, status/error codes, progress reset/failure/late cancellation and no mutation before explicit apply. Device and provider verification are separate from source/mock tests.

## 7. Proposed choices requiring explicit owner review

- Proposed limits 500 eligible / sequential batches of 25 are not accepted/proven; see benchmark report. No production enabling until parent review.
- Proposed note suggestion retention window in compatibility contract (24h active/30d applied) is not approved; persistence should remain disabled until owner accepts or revises it.
- Conservative reject-existing-referenced-parent is supported by bookability invariants but needs owner acceptance as product behavior.
- Same-name tags across distinct parents remain unavailable while legacy string associations are canonical; stable-ID association migration needs a separate compatibility plan.
