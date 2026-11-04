# Research: Backend/shared prior-repair audit

- Query: Audit the actual current dirty worktree against docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md, concentrating on the backend/shared portions of T01, T04–T07, T10–T11, T13–T14.
- Scope: internal; source and test inspection during PLANNING, with fresh main-session gate logs read as evidence. Simplification dependency inventory and implementation are outside this assignment.
- Date: 2026-11-03

## Findings

The inspected allocation, salary compatibility, goal replay, current-plan reference, matching-window actuals, and statistics boundary paths do not establish a defect in retaining the four-purpose calculation. Two concrete import edge defects remain, and two test-only quality gates currently fail. Passing runtime suites and production compilation do not close those findings. This is a bounded source audit, not complete product or device acceptance.

### Applicable T01–T14 table

| Task | Backend/shared assessment | Key evidence and limits |
|---|---|---|
| T01 salary idempotency | No confirmed defect in inspected server path. Optional-key compatibility is intentional. | packages/server/src/services/salary-service.ts:285–320 branches unkeyed writes separately and uses operation replay before live template validation. packages/server/test/salary-operation-replay-regression.test.ts:71 proves two legacy writes; :108–166 proves one keyed salary, one balance increase, no ordinary income, and operation lookup. Android HTTP payload/pending migration not audited. |
| T02 session ownership/cancellation | Outside this backend audit. | Android request/cookie/session timing and transport cancellation were not reviewed; no acceptance conclusion. |
| T03 manual money input | Outside this backend audit. | Android parsing and actual form wiring were not reviewed. Server safe-integer validation is visible in packages/shared/src/manual-goal-progress.ts:100–112. |
| T04 goal write recovery/identity | No confirmed server defect in inspected four-mutation protocol. | packages/server/src/services/financial-goal-store.ts:421–475 fingerprints method/resource/payload, checks replay before commit, and records business writes plus response in one immediate transaction. API tests at packages/server/test/financial-goals.test.ts:672–870 cover exact replay, changed payload, opening, PATCH/DELETE after deletion, special notes, and rejected-history rollback. Android restart/exact pending persistence not audited. |
| T05 current reference/window actuals | Historical-reference defect is repaired in inspected source. | packages/server/src/services/financial-goals-service.ts:811–833 uses MonthlyPlanService with the captured clock, rejects missing/disabled/changed-source references, and catches only specified domain failures. :602–648 uses explicit window and separate net additions; :721–728 suppresses current reference for window views. Tests :1063–1090 and :1163–1208 anchor historical no-period and exact endpoints. Client display/races not audited. |
| T06 bounded complete goal history | No confirmed backend pagination defect. | packages/server/src/services/financial-goal-store.ts:225–269 uses matching date/id ordering and cursor predicate, limit+1, total and hasMore; service :299–327 echoes revision and cursor. packages/server/test/financial-goals.test.ts:1213–1261 exercises 2/2/1 pages and rejects limit 101; :1264–1319 covers deleted history/illegal deletion. Android 235-row accumulation and oldest-row actions not audited. |
| T07 overview source/refresh | Inspected monthly-plan source uses confirmed execution facts; client refresh acceptance unreviewed. | packages/server/src/services/monthly-plan-service.ts:265–278 selects the frozen period containing now; :300–323 derives summary from collectExecution. packages/server/test/monthly-plan.test.ts:489, :536, :582, :640 cover consumption/refund/provisional/no-period cases. MainShell callbacks and retained summaries not audited. |
| T08 invalid template/frozen date | Backend regression exists; test typing gate is broken (F04). | packages/server/test/salary-operation-replay-regression.test.ts:227–268 targets invalid default template and zero writes. Android repair navigation and timezone display not audited. |
| T09 manual import/session files | Limited server observation; no Android conclusion. | Explicit analyse=false is exercised by packages/server/test/core-finance-repair-integration.test.ts:290–302. Existing backend default is a compatibility contract (.trellis/spec/backend/merged-bill-import.md:20); it is not evidence that new Android entry points send the wrong flag. SAF/attachment ownership/legacy cards not audited. |
| T10 analysis/rebind recovery | Confirmed remove replay defect F01. Inspected analysis replay avoids restarting provider work. | packages/server/src/services/import-batch-service.ts:1673–1719 returns created=false for an accepted key; routes/import-batches.ts:277–282 starts analysis only for created=true. File-removal guards precede lookup at service :1770–1789. Android hashes/rebinding/restart persistence not audited. |
| T11 distinct categories/original notes | Confirm has entity sets, but review still overcounts converging new proposals (F02). | packages/server/src/services/import-batch-service.ts:2471–2525 counts new categories by suggestion; :2735–2819 confirms by entity IDs. Existing regression packages/server/test/import-batch-confirm.test.ts:1031–1133 covers rows sharing one suggestion or one existing entity. noteAlternatives are returned at service :750 and note overrides preserve empty strings at :2454–2465; Android attention/notes UI not audited. |
| T12 navigation guards | Outside this backend audit. | Back, outer navigation, hidden-page ownership, and unresolved-state persistence need separate client review/device evidence. |
| T13 repeated midnight | No confirmed defect in the specified repaired case. | packages/shared/src/stats-window.ts:272–325 enumerates offset candidates, validates civil midnight, and selects earliest epoch; :328–350 handles skipped midnight. packages/shared/test/stats-window.test.ts:178–206 anchors St_Johns and Asuncion; packages/server/test/stats.test.ts:866–876 anchors the HTTP historical case. No claim about all historical timezone transitions or salary-cycle handling. |
| T14 gates/evidence | Current runtime suites/builds pass; two test-only gates fail (F03/F04). Device closure remains separate. | Fresh main-session logs under research/evidence-2026-11-03/ show shared 388/12 and server 1047/49 passing, lint exit 1 and server test typecheck exit 2. See verification table below. |

### F01 — P2 runtime/protocol: an accepted file removal cannot replay its original result

- Trigger: Start with two originals [A,B]. Remove index 1 using expectedVersion=1, one request key, and resulting files [A]. The server commits version 2 and the response is lost. Repeat exactly the original request.
- Evidence: packages/server/src/services/import-batch-service.ts:1770–1771 compares the original index against the already-reduced current file list and throws before :1785–1789 can retrieve the accepted operation. Removing index 0 instead reaches the last-file guard at :1779–1780. With more originals, :1781–1782 compares the replay payload against another removal from the current set. The public route calls this path at packages/server/src/routes/import-batches.ts:286–304.
- Consequence: Exact same-key recovery receives 400 even though the removal committed. It cannot retrieve the stored idRemap/droppedDraftItemIds outcome needed for draft recovery. A GET can show current files but does not return that original mutation result. This is not evidence of duplicate ledger writes.
- Contract: Repair plan T10 :337–347 explicitly includes REMOVE and recovery of the same original mutation outcome. The operation lookup and stored outcome already exist.
- Minimal plausible fix: After ownership and basic request-shape validation, compute the original request digest and resolve an existing operation before validating index/cardinality against current mutable files. Run current-state/version guards only for a new operation; preserve payload-mismatch rejection.
- Test gap: packages/server/test/import-batch-confirm.test.ts:428–446 proves only the first removal. Add an exact retry after successful removal (both indices of a two-file batch, plus a larger batch), asserting the original remap/outcome, no second version increment, and changed-payload rejection. Not executed by this researcher.

### F02 — P2 runtime/reporting: review counts proposals instead of distinct planned new category entities

- Trigger: Two selected rows use different valid suggestion IDs. The user approves both with the same new normalized name, type and parent, with no matching live category. Approval names are editable, so initially distinct suggestions can converge at review.
- Evidence: packages/server/src/routes/import-batches.ts:110–129 accepts each approved suggestion and name independently. packages/server/src/services/import-batch-service.ts:2418–2451 validates them against live categories without building a shared planned-entity set. At :2495–2522 each used suggestion appends a new categoriesToCreate entry. During confirm, :2781–2812 rereads the live catalogue per row: the first creates the category, the second finds that category and uses it. :2817–2819 correctly reports one created entity and zero reused existing entities.
- Consequence: Review announces two new categories while successful confirmation reports one. Per-category selectedRows is split across duplicate entries. The financial rows and amounts still import once; this is a summary contract defect.
- Contract: T11 :369–375 requires review and confirm to share distinct-entity units; matching must distinguish type and parent.
- Minimal plausible fix: Group planned creations by normalized [name,type,parentId], sum selectedRows, and reference that common plan from each suggestion. Continue grouping reuse by real category ID and preserve explicit approval and atomic confirmation.
- Test gap: packages/server/test/import-batch-confirm.test.ts:1031–1133 covers three rows with ONE suggestion and then ONE existing category. Add two approved suggestions converging to one new entity, and same-name/different-type-or-parent cases. Not executed by this researcher.

### F03 — P2 quality gate, test-only: final unused revision assignment breaks lint

- Trigger/evidence: pnpm -r run lint fails at packages/server/test/financial-goals.test.ts:1177:5 with @typescript-eslint/no-unused-vars. The final rev assignment is never read. Fresh evidence: research/evidence-2026-11-03/lint.log:5–11, exit 1.
- Consequence: T14's required lint gate is red; this does not indicate a production finance calculation failure.
- Minimal plausible fix: Keep the final awaited record insertion and its helper assertions, but remove the unused assignment/result projection. Rerun the required lint gate in the implementation phase.

### F04 — P2 quality gate, test-only: unchecked array access breaks server test typecheck

- Trigger/evidence: pnpm -r run typecheck fails at packages/server/test/salary-operation-replay-regression.test.ts:233:31 with TS2532 on modules[0].categoryId. The preceding expect(modules.length).toBeGreaterThan(0) does not narrow indexed access for TypeScript. Fresh evidence: research/evidence-2026-11-03/typecheck.log:4–12, exit 2.
- Consequence: Server test typecheck is red although Vitest and production compilation pass. packages/server/package.json:10–15 and tsconfig.test.json:12 show the different build/test check scopes.
- Minimal plausible fix: Capture the first module and explicitly guard undefined before accessing categoryId, retaining the fixture validity assertion. Rerun the server test typecheck in the implementation phase.

### Key contract/source/test anchors and files found

| File/anchor | Purpose |
|---|---|
| docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md:19–32 | Cross-task money, replay, frozen-window, import and evidence constraints. Detailed applicable task contracts appear in the table/findings above. |
| packages/shared/src/financial-execution.ts:281–324 | Pure BigInt largest-remainder four-purpose allocation with deterministic order and exact cent conservation. |
| packages/shared/test/financial-execution.test.ts:177–220 | Acceptance allocation, one cent, equal remainders, nonnegative/safe output and conservation through MAX_SAFE_INTEGER. No confirmed allocation defect from inspected code. |
| packages/server/src/services/financial-operation-store.ts:150–190 | Recursive canonical payload hashing includes method/resource; null/absence semantics are explicit. |
| packages/server/src/services/financial-goals-service.ts:345–404, :455–498, :551–581 | Four mutation resources and canonical fields, including original expectedRevision. |
| packages/server/src/services/financial-goal-store.ts:387–411 | Actor-filtered operation lookup returns original method/resource/status/response. |
| packages/shared/src/manual-goal-progress.ts:115–125 | Existing intentional note trimming; quoted/internal newline text remains supported. Do not call boundary trimming a replay corruption defect. |
| packages/server/src/services/monthly-plan-service.ts:478–479 | Changed/empty salary-source flags consumed by the current reference guard. |
| packages/server/test/core-finance-repair-integration.test.ts:200–367 | Fixed-clock app.inject integration for salary, plan, spending, manual reserve progress and manual import. Its broad T14/R01–R20 suite name does not prove every repair or device case. |
| .trellis/tasks/10-30-core-finance-simplification-review/evidence/repair-checks.md:9–38 | Historical counts and synthetic integration claims; not fresh current-worktree gate evidence. |
| .trellis/tasks/10-30-core-finance-simplification-review/evidence/repair-closure.md:34–39 | Explicit device/product-acceptance limits. |

### Related specs and external references

Read .trellis/workflow.md and the backend index, financial-plan.md, financial-execution.md, statistics-window.md, merged-bill-import.md and quality-guidelines.md before assessment. Relevant contracts include operation replay before live validation (financial-execution.md:17–20), original-byte review/atomic confirm (merged-bill-import.md:63–69), repeated-midnight scope (statistics-window.md:19), and separate tests/typecheck/lint/device evidence (quality-guidelines.md:6–9, :15–32, :73–82).

No external network reference was needed or used; conclusions concern local source and recorded commands. Manifest context, not a verified installed-version claim: package.json:7–9 declares pnpm 10.12.2 and Node >=22.12.0; packages/server/package.json:21–31 declares better-sqlite3 ^12.2.0, Fastify ^5.2.1, TypeScript ^5.7.3 and Vitest ^3.0.5.

### Fresh verification evidence available at report time

These commands were run by the main session, not this researcher. Paths below are relative to this task's research/evidence-2026-11-03/ directory.

| Check | Observed result | Evidence |
|---|---|---|
| Shared build | PASS, main-session confirmed | shared-build.log:2–3 |
| Shared tests | 388 tests / 12 files PASS | shared-test.log:21–24 |
| Shared lint/typecheck | PASS before server failures | lint.log:2–3; typecheck.log:2–3 |
| Server tests | 1047 tests / 49 files PASS | server-test.log:118–121 |
| Workspace lint | FAIL, exit 1 | lint.log:5–11; F03 |
| Workspace typecheck | FAIL in server tests, exit 2 | typecheck.log:4–12; F04 |
| Server production build | PASS, main-session confirmed | server-build.log:2–3 |
| Android lint/assemble | Main session reported success | No independent device conclusion. |
| Fresh Android unit rerun | Final result not supplied to this researcher before report | Earlier task was UP-TO-DATE; main session owns the forced rerun result and final evidence integration. |

## Caveats / Not Found

- Product source stayed read-only. Only this owned report was written. No Git command, task activation, build, test, deployment or provider request was run by this researcher.
- F01/F02 are confirmed by deterministic reachable source paths and existing API contracts; no new failing regression was executed. Main-session passing suites do not contain the identified edge assertions.
- No confirmed defect was found in the inspected retained four-purpose allocation, optional-key salary compatibility, manual-goal server replay/atomicity, current-period reference selection, matching-window totals, backend history cursor, or specified repeated-midnight repair. This bounded conclusion is not an exhaustive safety certificate.
- Android implementation, device behavior, transport/session races, SAF/IME/TalkBack/Back, actual restart recovery, old-server compatibility, real provider behavior and production business operations were not audited. The applicable table explicitly marks these areas unreviewed.
- T05 additional combinations (corrupt configuration, overlapping current periods, changed/empty salary facts plus unrelated expenses) were source-traced at the guards but not independently exhaustively reviewed or executed. T06 server pagination coverage read here is five rows over three pages; the 235-row Android scenario remains outside this audit.
- The T14 integration test uses 10_000 cents and proportional smaller fixture values despite yuan labels (test :208–235; historical repair-checks.md:27). Its ratio assertions are useful, but it is not literal evidence of every full-size monetary fixture, refund/statistics scenario, or all R01–R20. Focused monthly-plan/goal/statistics tests supply separate assertions.
- Historical 1038-server-test/570-Android counts are historical claims; the current observed server count is 1047. Missing device evidence and different test counts are not themselves runtime defects. A final all-green gate claim is contradicted by the current lint/typecheck logs until the two test-only failures are repaired and checked.
- Source line anchors describe files inspected on 2026-11-03. Other agents were active; no attempt was made to reset, overwrite, snapshot via Git, or attribute their changes. Main session owns any later gate results and simplification/product decision.
