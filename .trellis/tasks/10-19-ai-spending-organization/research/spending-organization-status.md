# AI spending organization — implementation status

**Active task:** `.trellis/tasks/10-19-ai-spending-organization`

**Status: server-side feature and Android A105–A106 implemented and locally verified; physical device, real Provider, deployment and independent re-review remain open.**

## Implemented

### Phase 1 — bounded, complete, read-only analysis
- Migration 014: `ai_analysis_runs` (run lifecycle, coverage snapshot, fingerprint, suggestions) + `ai_note_suggestions` (separate note suggestions; original notes never stored or rewritten).
- `AiSpendingOrganizationService.startAnalysis/getRun/getCard` and routes `POST /api/v1/ai/organization-runs`, `GET /api/v1/ai/organization-runs/:id`, `GET /api/v1/ai/organization-runs/:id/card`.
- Inclusive server-local calendar days; deterministic eligible ordering; cap 500 / batch 25 (provisional synthetic calibration); sequential batches with persisted progress; provider output normalized against server-owned eligible rows and catalog; any provider/normalization failure fails the whole run with no actionable card.

### Phase 2 — review card and exact snapshot
- Card exposes `version`, `expiresAt` (24h TTL), deterministic `fingerprint`, complete `coverage`, per-category interval evidence via the shared `expenseContribution` semantics, and template proposals.
- Migration 015 adds `template_proposals_json` to `ai_analysis_runs`.
- `templateProposals` in the provider schema; normalized only when every module references a usable category, has a positive finite ratio, no duplicate category, and the ratios sum to 100% (1e-4 tolerance); `new` proposals carry the full solution, `update` proposals carry the existing template's before modules.

### Phase 3 — atomic idempotent apply and conditional undo
- Migration 016: `ai_organization_operations` (applied/undone operations with before/after projections).
- `apply(runId, actionIds)` and `undo(operationId)`, routes `POST /api/v1/ai/organization-runs/:id/apply` and `POST /api/v1/ai/organization-operations/:id/undo`.
- Apply: revalidates affected transactions against the run snapshot; one transaction covers category reclassification, tag reassignment (with tag metadata sync), new-category creation (only when selected), and template create/update (future-use only). Note suggestions are never applied. Idempotent replay for an already-applied operation; re-apply after undo creates a fresh operation.
- Undo: revalidates every after-state; reverts transactions, soft-deletes created categories/templates, restores updated template modules; conflict without partial writes when anything changed underneath.
- Card suggestions now carry display-only transaction date/amount/type and before/after category names so Android can identify each bill without a second lookup. Apply still revalidates by transaction id and the frozen run snapshot.

### Phase 4 — Android A105–A106
- `OrganizationRepository` calls `organization-runs` / `organization-operations`; the analysis POST has a dedicated 10-minute call timeout, while normal GET/apply/undo keep bounded timeouts.
- `AssistantOrganizationWorkspace` provides month/previous-month/three-month/year/custom inclusive date selection, explicit start, complete-run review, per-action category/tag before/after, separate note/new-category/template advice, 100-action selection cap, one confirmation, applied-operation result and conditional undo.
- Request identity is scoped by server base URL; late start/card/apply/undo responses are rejected after disposal or scope change. Unknown apply/undo outcomes stay locked for an explicit retry of the same action ids, which the server fingerprints idempotently.
- Entry points: AI assistant welcome card and overflow menu. The page does not chain the generic assistant confirmation workflow.
- Android catalogue updated with A105–A106, five API rows, known gaps and change log.

## Verification (this workspace)

- `cd packages/server && pnpm run typecheck` — **passed**.
- `cd packages/server && pnpm run lint` — **passed** (max-warnings 0).
- `cd packages/server && pnpm run test` — **passed: 33 files / 735 tests**.
- `cd clients/android && .\\gradlew.bat :app:testDebugUnitTest` — **passed: 22 suites / 251 tests** (new `AssistantOrganizationStateTest`, 8 tests).
- `cd clients/android && .\\gradlew.bat :app:lintDebug` — **passed: 0 errors / 43 warnings / 21 information** (warnings are existing baseline, not claimed zero).
- `cd clients/android && .\\gradlew.bat :app:assembleDebug` — **passed**; debug APK 22,218,134 bytes, SHA-256 `D91B91638AD812008C7468499698F62C19E93723697AF47A8EA787C7F8E10E74`.

New/updated files: migrations 014–016, `services/ai-spending-organization-service.ts`, `routes/ai.ts`, `services/ai-types.ts`, `test/ai-spending-organization.test.ts`, `test/ai-organization.test.ts`; Android `OrganizationRepository.kt`, `AssistantOrganizationModels.kt`, `AssistantOrganizationState.kt`, `AssistantOrganizationWorkspace.kt`, `AssistantOrganizationStateTest.kt`, `AssistantTab.kt`, `ApiClient.kt`, `clients/android/README.md`.

## Not claimed / remaining

- **Physical-device acceptance has not been run.** No APK installation, device interaction, large-font/TalkBack/weak-network/process-recovery check.
- **No live Provider call was made**; analysis behavior is covered by deterministic service tests and Android DTO/state tests only.
- **Independent re-review of the new feature code has not been run.**
- Cap/batch numbers remain provisional synthetic calibration, not production-accepted limits; Android shows 500 as a fixed user-visible cap based on current server code.
- No deployment, no production migration, and **no git commit** was performed. The workspace still contains extensive unrelated pre-existing WIP.
- Note suggestions, new-category suggestions and template proposals are displayed as advice only and are never applied by the Android workspace. There is no run/audit history list and no cross-page operation recovery.
