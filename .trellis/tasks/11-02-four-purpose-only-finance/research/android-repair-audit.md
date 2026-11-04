# Research: Android prior repair implementation audit

- Query: Audit the current Android implementation of docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md, covering applicable T01–T14 and R01–R20, and identify remaining actionable defects.
- Scope: Internal; bounded static review of the current filesystem, including uncommitted/untracked implementation. Planning research only. The separate four-purpose simplification inventory and allocation/remaining-versus-classification product decision are outside this audit.
- Date: 2026-11-03
- Ownership: Only this report was written. No product source, tests, specifications, task state, or other research reports were changed. No git operations, builds, or tests were run by this researcher.

## Findings

Six confirmed source-level defects remain in the inspected repair paths. They are documented below with concrete triggers, effects, and minimal plausible fixes. Passing JVM/build gates do not close these production wiring defects. Other repair behaviors are implemented, partially implemented, or outside this bounded review as distinguished in the evidence table.

All relative code anchors below are from the current working-tree files under:

- **M** = clients/android/app/src/main/java/com/yansuu1/jizhang/
- **J** = clients/android/app/src/test/java/com/yansuu1/jizhang/

Thus M/ui/MonthlyPlanWorkspace.kt:119 denotes the exact repository file clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MonthlyPlanWorkspace.kt at line 119. Anchors describe the inspected snapshot; concurrent edits can move them.

### Confirmed defects, ordered by repair relevance

#### A01 — P2: Monthly-plan and goal reads invalidate each other's completion

- Related requirements: T05/T07; R08/R02.
- Trigger: Open an existing ready monthly plan, then change refreshToken through a confirmed write or press Refresh. Both the monthly-plan effect and the goal-window effect run while the existing window remains populated.
- Source: M/ui/MonthlyPlanWorkspace.kt:117 creates one FinancialExecutionWorkOwner. The plan effect at :119 obtains its ticket at :120 and gates its response/error/finally at :126, :136, :138. The separate goal effect at :142 obtains another ticket from the same owner at :150 and gates its response/finally at :157 and :175. M/ui/FinancialExecutionWorkspace.kt:88–103 implements that owner as a single current ticket; every nextTicket invalidates the preceding ticket.
- Consequence: These independent reads cannot both retain ownership. With the plan request pending when the goal request starts, the new plan response and its finally are discarded; the old financial summary remains and loading can remain true. In the opposite ordering the goal completion is discarded. This defeats reliable refresh even though the shell refresh token is connected.
- Minimal plausible fix: Give plan and goal reads separate owners, or perform their coordinated refresh under one effect/ticket with separate explicit results. A window change should invalidate the goal read without invalidating an unrelated plan completion.
- Coverage limit: Inspected helper owner tests do not execute these two Compose effects together. No device reproduction or new test execution is claimed.

#### A02 — P2: Import mutation recovery metadata is not consumed, and replace/remove remain fresh-key writes

- Related requirements: T10; R14/R15; T12 recovery-preservation claims.
- Trigger: Replace a failed file successfully on the server but lose the response; alternatively restart after an analysis response was lost.
- Source: M/ui/feature/assistant/AssistantBatchImportWorkspace.kt:137–140 creates the store but initializes recoveryState to empty. Analysis alone creates metadata at :477–489, records it at :498, and removes it on a returned response at :520. Initial loading at :566–568 calls loadFullBatch; the inspected production workspace has **no recoveryStore.list call**. The production-source search found no consumer of that store's list method. Replacement at :670–685 keeps candidate currentFiles in a coroutine local and uses UUID.randomUUID() at :683; memoryFiles changes only on success at :687. Failure at :702–705 only shows an error. Removal at :1193–1200 likewise sends a fresh UUID and has no recorded mutation metadata. BatchMutationKind.REPLACE/REMOVE exist in M/ui/feature/assistant/AssistantBatchRecoveryState.kt:14–17 but are not used by these production branches.
- Consequence: A lost replacement response discards the replacement candidate from workspace state and loses the request key needed to recover its MutationResult and remap drafts. Restart does not hydrate the recorded analysis request into the workspace. A later action cannot resume that original operation through the specified original-key recovery flow. This confirms incomplete recovery, **not** that every analysis retry definitely repeats a Provider call: server running/complete states can still prevent that.
- What is already fixed: SHA-256 matching and the independent rebind-originals path are real. M/ui/feature/assistant/AssistantBatchImportWorkspace.kt:132–135 uses matchBatchOriginals; :714–741 rebinds by digest. Therefore the old count-only comparison defect is not being reported as still present.
- Minimal plausible fix: On owner/batch initialization, load scoped mutation metadata and reconstruct UNKNOWN recovery state. Persist metadata and retain candidate documents before replace/remove, retain their original key/version/files through failure, query authoritative batch state, then replay the exact request when required to obtain MutationResult and remap drafts. Resolve/clear metadata only after authoritative reconciliation. Do not automatically rebase to a new version/key.
- Test evidence: J/ui/feature/assistant/AssistantBatchRecoveryStateTest.kt:33 exercises the production hash matcher. Its lostMutationResponseKeepsKeyAndCandidateFiles at :96–134 only constructs an UNKNOWN object and round-trips metadata JSON; it does not invoke the production workspace, gateway, store recovery, replacement, or a restart. This is a real test-depth gap alongside the confirmed missing wiring.

#### A03 — P2: Several real outer Back/leave paths still bypass active dirty/unknown-state handling

- Related requirements: T12; R05.
- Concrete path 1: In an Assistant import with selected originals or row edits, tap the outer “return to source” button. M/ui/MainShell.kt:281–292 passes onBack = closeAssistant at :286; AssistantDestination invokes that callback directly at :513. It does not consult leaveCoordinator even though handlers are registered at :292. Assistant disposal clears platformImportEntryContext and initial documents at M/ui/AssistantTab.kt:202–209. The user receives no continue/leave choice before disposal.
- Concrete path 2: In the import main list, the workspace's top Back invokes onBack directly at M/ui/feature/assistant/AssistantBatchImportWorkspace.kt:1110. Its registered requestBack at :174–179 closes editing/review or calls onBack, without invoking the unsafe-leave prompt; it also omits the comparison layer. The local BackHandler at :746 is only enabled for comparison/edit/review. PlatformImportHost returns at M/ui/feature/imports/PlatformImportHost.kt:210 when a workspace is visible, before its own main-list BackHandler at :213. Registering handlers above the return does not make the direct/system Back paths call them.
- Concrete path 3: With goal details open under Plan, bottom-tab leave reaches the plan guard, but that guard immediately sets showingManualGoals=false and allows navigation at M/ui/MonthlyPlanWorkspace.kt:79–88. M/ui/ManualGoalProgressWorkspace.kt:86–92 exposes neither active nor navigation-registration parameters; its Back at :128 and top button at :226 call onBack directly. There is no goal dirty/busy/unknown leave decision to consult.
- Concrete path 4: The secondary financial entry under My has a parent top Back at M/ui/MyTab.kt:146 which directly closes the section. The nested FinancialHostScreen at :156–165 does not forward onRegisterNavigation. Only the Data section forwards handlers at :108–115. This leaves the secondary financial route outside the advertised outer registration chain.
- Consequence: Draft/original state can be discarded without consultation, or Back exits the source instead of the innermost layer. Pending operations may remain in persistent stores, but their continued existence does not preserve unsaved row/form bytes or implement the required navigation decision. This is a source wiring defect, independent of missing device evidence.
- Minimal plausible fix: Route every outer top/system Back through the active requestBack/leave protocol; forward financial handlers from MyTab as well as Data. Register a real goal handler with dirty/busy/unknown state. Have batch main-list Back request guarded exit and close comparison/edit/review first. Selected originals/start-pending state in PlatformImportHost needs its own guard (its default handlers at :83–89 currently allow immediately). Pass active ownership into retained children so hidden workspaces cannot own Back.
- Existing strengths: MainShell selectTab at :110–123 genuinely uses NavigationLeaveCoordinator. The coordinator and retained non-placement layout exist. The defect is incomplete caller wiring, not their absence.
- Test evidence: J/ui/NavigationLeaveGuardTest.kt:11 and :66 exercise an explicitly registered coordinator with synthetic handlers; they do not mount MainShell, MyTab, PlatformImportHost, or these direct buttons.

#### A04 — P2: A late template/category rejection during new salary creation never reaches the template-repair refresh branch

- Related requirements: T08; R06.
- Trigger: Load a valid default template, delete one referenced category elsewhere, then save a new salary from the still-open form. Server rejects the stale template/category.
- Source: M/ui/SalarySheet.kt:630–631 calls applySalaryOutcome(salaryReplay.create(...)). M/ui/SalaryOperationReplay.kt:277–283 catches the ApiException and converts a definitive rejection into SalaryMutationOutcome.DefinitiveFailure. applySalaryOutcome at M/ui/SalarySheet.kt:492–496 only clears pending state and assigns formError. The category/template reread logic at :644–668 is an outer exception catch, so this new-create rejection cannot reach it. The repair button is conditioned on an unavailable default at :1343–1352, while the local templates/categories remain the pre-rejection snapshot.
- Consequence: The new-create form retains a locally “usable” stale default and repeatedly receives the server error instead of exposing the required refreshed repair state. The initial-load validation is fixed, but the specified category-deleted-after-load path is not.
- Minimal plausible fix: Preserve rejection status/code in DefinitiveFailure, or handle a typed template/category rejection before flattening it to a message. In that outcome handler reread templates/categories, select repair mode, and retain amount/date/account/note. Avoid treating unrelated 4xx as template failure.
- Existing strengths: M/ui/SalaryTemplateState.kt:13–25 correctly checks every module category against active IDs; initial missing defaults are blocked at M/ui/SalarySheet.kt:560–569, and templateRefreshToken supports repairing without destroying the form. Frozen date formatting is a separate fixed behavior.
- Catalogue mismatch: clients/android/README.md:283 claims the definite-rejection reread/repair path. The inspected new-create call chain does not implement that claim.

#### A05 — P2: Goal forms can start fresh operations while a previous submission is pending/unknown, and definite failures discard input

- Related requirements: T04/T12; R03.
- Trigger: Submit a goal record over a slow connection, dismiss/reopen its dialog and submit again; or receive an UNKNOWN outcome and use an enabled record/correct action while the previous operation remains unresolved. A revision-conflict response also demonstrates the input-loss branch directly.
- Source: M/ui/ManualGoalProgressWorkspace.kt:345–362 always supplies enabled opening/create callbacks, with no unresolvedOperation/sending check. The POST branch at :514–547 generates UUID.randomUUID() for every invocation at :516, uses the current revision at :529, and on UNKNOWN closes the dialog at :544 while retaining only op at :545. PUT at :453–483 and PATCH at :559–589 follow the same pattern. Dialog confirm buttons at :921–931, :986–1000, :1040–1049 have no busy parameter or submission lock, and onDismissRequest remains active at :905, :953, :1019. Definitive failures clear showOpeningDialogFor at :477, showCreateEntryDialogFor at :540, and editingEntry at :583, destroying the locally entered dialog fields.
- Consequence: The UI can issue distinct keys for an unresolved logical action and loses the user's amount/note after a definite rejection. The backend's expectedRevision check can reject competing writes; this report does **not** claim that every double tap creates two entries or that server atomicity is broken. The confirmed client defects are missing pending/busy admission control and discarded correction input.
- Minimal plausible fix: Keep a workspace mutation state and one immutable operation per form attempt; disable new mutation actions while sending or resolving that attempt, expose original-key recovery, and keep a definite rejection in its originating dialog with the input intact. Route parent leave handling through the same state. Validate ownership before callbacks/state changes, including recovery feedback.
- Existing strengths: The replay coordinator itself persists exact JSONObject-encoded payloads before sending; the four operations, old valid metadata normalization, unknown outcomes, and special-note recovery have production-helper test coverage. This finding concerns the Compose callers, not a missing coordinator.

#### A06 — P2: Statistics silently presents retained goal actuals after a known refresh failure

- Related requirements: T05/T07; R08/R02.
- Trigger: Successfully load same-window goal actuals, then refresh that window after a write while the financial-goals read fails transiently.
- Source: M/ui/StatsTab.kt:235–238 sets goalError but leaves goalView populated. Rendering at :322–333 takes the goalView.window branch and displays those prior actuals. goalLoading/goalError are rendered only in the null-view branch at :333–339.
- Consequence: The known failed refresh is hidden whenever a prior value exists. Old manual actuals remain visually current with no stale/error label, contrary to the same-query stale-data contract. The retained data itself is allowed; the missing status is the defect.
- Minimal plausible fix: Render loading/stale/error status independently of whether the retained goalView exists; label old values as stale after failure or suppress them until refreshed. Keep their original window label.
- Existing strengths: The read passes the server from/to unchanged at :212–220, validates it at :222, and account-filter wording at :323–331 explicitly says goal values cover all targets and do not join account totals.

### Task-by-task evidence table

“Present” below means supported by inspected source/helper tests, not device acceptance. Where a source was only searched or a test was only inventoried, that limit is explicit.

| Task / original review | Current production evidence | Test evidence and bounded verdict |
|---|---|---|
| T01 / R01 — salary actual body and legacy unknown | M/ui/SalaryOperationReplay.kt:25–29 writes operationId into the actual JSONObject; :38–48 requires matching POST/path/key; :208–213 preserves unsafe legacy operations without sending. SalarySheet :517–521 blocks legacy retry; :275–305 restores a safe/manual-reconciliation form, and explicit local-dismiss UI is present. Production gateway at SalarySheet :117–132 sends JSONObject(payloadJson). | J/ui/SalaryOperationReplayTest.kt:20, :29, :40, :109, :147, :172 cover construction, legacy zero-send, persistence/replay and lookup-first recovery. J/net/SalaryCreateNetworkContractTest.kt:17 and :52 send the production-built body and apiRequest through MockWebServer; these tests use raw OkHttp, not the whole SalarySheet/ApiClient stack. Original missing-key defect is corrected in inspected source. Salary legacy malformed-JSON reconciliation and dismissal UI were not exhaustively traced. |
| T02 / R04 — session ownership/cancellation | M/net/ApiRequestOwner.kt:16–36 provides monotonic generation/current/ifCurrent. M/net/ApiTransport.kt:49–51 checks before dispatch; :87–108 gates response cookies/401; :113–123 rejects stale/cancelled completion; :127–134 cancels Call on coroutine unwind. ApiClient integrates transport for JSON at :327, download at :216, SSE at :253. AuthRepository :26–93 scopes refresh/login/logout state/finally. | J/net/ApiTransportTest.kt:33, :128, :153, :195, :233, :366 inventory covers delayed response/cookies, A→B→A, current/login 401, cancellation, late logout. Transport and auth source read; complete test bodies were not exhaustively reviewed. No additional confirmed T02 defect from this bounded pass. Atomic cross-call identity/session interleavings and every old API consumer remain unreviewed. |
| T03 / R10 — exact cents | M/ui/ManualGoalInput.kt:19–41 uses decimal regex, BigDecimal exact conversion, safe integer bound, and allowZero. Actual opening/create/edit dialogs call it at ManualGoalProgressWorkspace :924, :989, :1043. | J/ui/ManualGoalProgressStateTest.kt is the relevant production-parser regression path. No confirmed remaining rounding defect. No tests run here. |
| T04 / R03 — goal write recovery | M/ui/ManualGoalOperationReplay.kt:34–64 builds complete JSON; :177–217 records before send; :247–347 queries pending, capability-checks 404, validates key/method, and recovers response. M/repo/FinancialGoalRepository.kt:129–150 dispatches exact stored bodies and validates the returned operation key. Goal workspace :163–193 performs recovery and reloads view/list. | J/ui/ManualGoalOperationReplayTest.kt:130 parameterizes four writes; :244 special-note restart recovery; :306 legacy/corrupt records. Coordinator present, but A05 and A03 remain in caller behavior. Full resource/path validation on recovered operation results and all cancellation/owner callbacks were not closed; do not mark the entire T04 contract verified. |
| T05 / R08,R11 — same-window actuals/current reserve reference | M/ui/ManualGoalProgressReadState.kt:28–39 verifies manual source and exact echoed from/to. MonthlyPlanWorkspace :91–113 passes frozen window to goal details; :142–175 reads exact window. StatsTab :212–223 likewise reads/validates server window; :323–331 separates all-target goal values from account filters. | J/ui/ManualGoalWindowStateTest.kt and J/repo/FinancialGoalModelsTest.kt are relevant. A01 and A06 remain. R11 current-reference selection and all arithmetic are backend-owned and deliberately not re-audited here; no backend correctness claim. |
| T06 / R09 — goal history >100 | M/ui/ManualGoalEntryListState.kt:45–111 validates page shape/revision/cursor/duplicates; ManualGoalProgressWorkspace :130–159 requests limit=100 plus cursor; :365–438 presents loaded/total, more/error/restart states and real-entry edit actions; :377–388 switches period/all history. | J/ui/ManualGoalEntryListStateTest.kt:53 (235 entries), :95 (failure/retry), :125 (revision), :144/:155/:187/:199 (invalid pages). First-page-only defect is corrected. Tests prove reducer reachability rather than device edit on oldest record. includeDeleted query is supported by repository/model, but the inspected workspace exposes no includeDeleted selector and does not pass it in its page loads; treat “includeDeleted history” as API capability, not a confirmed visible Android entry. |
| T07 / R02 — financial invalidation | M/ui/MainShell.kt:146–152 invalidates on editor save; :330 passes token to transactions; :333–357 connects salary/plan callbacks and retained host. MyTab :163–184 forwards token and saved/confirmed changes. Execution workspace has onDataChanged at :484 and sub-sheet onSaved callbacks :1088–1127. SalaryFinancialPrompt declares a separate onPlanConfirmed; salary and plan writes remain separate. | Relevant J/ui/FinancialHostAndWorkOwnerTest.kt and salary/proposal/replay tests. A01 and A06 prevent full closure. All execution mutations, pending-recovery notifications, salary restart callbacks, and period-confirmation success paths were not exhaustively traced. Device two-entry-path refresh scenario remains unverified. |
| T08 / R06,R07 — template/date | M/ui/SalaryTemplateState.kt:13–25 checks active category references; SalarySheet :560–569 blocks absent usable default; :237–265 refreshes after repair. M/ui/format.kt:45–57 uses explicit ZoneId and exclusive-end label. SalaryFinancialPrompt consumes frozen formatting. | J/ui/SalaryTemplateStateTest.kt and J/ui/FrozenFinancialWindowFormatTest.kt are relevant. R07 formatting is supported by source; A04 leaves the late-rejection R06 branch incomplete. Real UTC/device display not verified. |
| T09 / R12,R13 — manual import and attachment scope | M/repo/AssistantRepository.kt:225–229 defaults analyse=false; PlatformImportHost :367–371 explicitly sends false. AssistantTab :793–807 captures conversation-bound picker ticket and opens the same host at :1036–1058. PlatformImportState :10–65 binds financial scope, request identity, source, conversation, and generation. Host :96–129 validates owner and API identity; workspace :247–256 gates requests. Optional AI checks provider/current originals and is an explicit button. | J/ui/feature/imports/PlatformImportStateTest.kt, PlatformImportEntryStateTest.kt; J/net/AssistantBatchNetworkContractTest.kt. Default manual flow and scoped entry are implemented in inspected source. All historical card pathways and protocol retry edge cases were not exhaustively audited; attachment A→B→A device flow remains unverified. |
| T10 / R14,R15 — mutation recovery/original matching | Production matchBatchOriginals at M/ui/feature/assistant/AssistantBatchRecoveryState.kt:121–146 consumes each digest match once and reorders. Workspace :714–741 permits rebind even for parsed files. Mutation-store data types exist. | A02 remains: metadata hydration and replace/remove original-key recovery are missing. J/ui/feature/assistant/AssistantBatchRecoveryStateTest.kt:96 is serialization/state evidence only. Successful hash matcher tests cannot establish mutation recovery. |
| T11 / R16,R17,R18 — review and category units | Workspace default filter at :126 is “待核对”; filter helpers and attention/category-assignment logic exist in AssistantImportState. Original notes are shown at workspace :1011–1048; choosing an empty note stores an explicit override at :1043 and invalidates review. | J/ui/feature/assistant/AssistantBatchImportStateTest.kt:1082 and :1138 are the relevant attention/original-note cases. Reviewed the note UI and helper presence, not every attention predicate. R16/R17 have source support; R18 distinct backend entity counting is outside this audit and not independently verified. |
| T12 / R05 — outer leave/back | Coordinator exists; MainShell bottom tabs consult it at :110–123. FinancialHost preserves four compositions and places only selected child at :153–205 and :211–228. Scenario receives active at :202. | A03 remains in multiple actual caller paths. J/ui/NavigationLeaveGuardTest.kt tests coordinator behavior rather than mounted navigation. Hidden Back-handler ownership in all retained children and rejection/continue-edit lifecycle were not exhaustively audited. |
| T13 / R19 — earliest historical month boundary | Android consumes server windows; the planned arithmetic change belongs to packages/shared/src/stats-window.ts and server tests. | Not re-audited by instruction; defer to main/backend review. Absence of Android arithmetic is intentional and correct. |
| T14 / R20 — catalogue/evidence | README :3 explicitly limits the 2026-11-01 repair audit to affected IDs and distinguishes current working tree. README :283 overstates the late-template-rejection repair path (A04). README :276 describes goal replay and includeDeleted history more broadly than the inspected visible UI proves. | Catalogue status must distinguish source/JVM/build from actual device acceptance. The old plan's “T01–T14 pending” header describes its planning handoff and is not proof that current code is absent. Complete acceptance artifacts, all catalogue APIs/claims, and all 46 acceptance items were not reviewed. |

### Relevant files found and responsibilities

| Repository path or group | Description |
|---|---|
| docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md | Authoritative repair constraints, R-to-T mapping, interfaces, and evidence limits. |
| .trellis/tasks/10-30-core-finance-simplification-review/review.md | Original R01–R20 finding headings and historical context; used to identify original scope, not as current defect proof. |
| clients/android/README.md | Maintained stable-ID catalogue, claimed implementation, dated changelog, and known gaps. Relevant claim sections read/searched; not a whole-catalogue reaudit. |
| M/ui/SalaryOperationReplay.kt; M/ui/SalarySheet.kt; M/ui/SalaryTemplateState.kt; M/ui/SalaryFinancialPrompt.kt; M/ui/format.kt | Salary payload/recovery, actual form callers, template availability, explicit plan confirmation, frozen-window labels. |
| M/net/ApiRequestOwner.kt; M/net/ApiTransport.kt; M/net/ApiClient.kt; M/repo/AuthRepository.kt; M/MainActivity.kt | Session generations, cancellation/cookie/401 boundary, API integration, auth and shell sign-in state. |
| M/ui/ManualGoalInput.kt; M/ui/ManualGoalOperationReplay.kt; M/repo/FinancialGoalRepository.kt | Exact cents and immutable operation construction, persistence/recovery, exact request dispatch. |
| M/ui/ManualGoalProgressReadState.kt; M/ui/ManualGoalEntryListState.kt; M/ui/ManualGoalProgressWorkspace.kt | Window validation, bounded pagination, visible goal read/write/history UI. |
| M/ui/MonthlyPlanWorkspace.kt; M/ui/StatsTab.kt; M/ui/FinancialExecutionWorkspace.kt; M/ui/StatsWindow.kt | Summary/read ownership, same-period actuals, invalidation callbacks, scoped reading helpers. |
| M/ui/MainShell.kt; M/ui/MyTab.kt; M/ui/FinancialHostScreen.kt; M/ui/NavigationLeaveGuard.kt | Main/secondary entry routing, retained layout, leave/back registration. |
| M/ui/feature/imports/PlatformImportState.kt; PlatformImportHost.kt; M/ui/AssistantTab.kt; M/ui/DataTab.kt | Both manual import entries, attachment/session ownership and host routing. |
| M/ui/feature/assistant/AssistantBatchRecoveryState.kt; AssistantBatchRecoveryStore.kt; AssistantBatchImportWorkspace.kt; AssistantImportState.kt | Mutation metadata/store, file hashes, production import actions, review state and source-note UI. |
| M/repo/AssistantRepository.kt; M/ui/feature/assistant/AssistantBatchModels.kt | Batch API/defaults and DTO definitions; repository signatures inspected, not every method/DTO exhaustively audited. |

### Related specs and workflow

- .trellis/workflow.md: planning boundary and research persistence contract, especially Phase 1.2 at :352–379; no task activation was performed.
- .trellis/spec/frontend/index.md: maintained Android scope, integer cents, server-owned accounting, historical Vue guides non-operative.
- .trellis/spec/frontend/quality-guidelines.md: source/JVM/device separation and retained financial tabs must only place the selected layout.
- .trellis/spec/backend/native-delivery.md: Android catalogue maintenance, cookie/auth/empty-body API boundary; relevant native sections consulted.
- .trellis/spec/backend/financial-plan.md and financial-execution.md: four-purpose/execution domain boundaries; consulted as contracts, not backend arithmetic audited.
- .trellis/spec/backend/merged-bill-import.md: original bytes/review-token/CAS/ownership/idempotency and atomic confirm boundaries; relevant contracts consulted.
- AGENTS.md supplied by the main session: catalogue is implementation evidence; clients/android/ui-redesign/README.md is not. No design mockup was treated as evidence.

### External references and versions

No external web research was necessary or performed: the requested evidence is the current repository's static implementation. The repair plan identifies Kotlin/Compose, coroutines, OkHttp 4.12.0, JUnit 4/MockWebServer, and AGP 8.5.2 in its toolchain/gate guidance. Installed/resolved dependency versions were not separately audited. No current external documentation claim is used to establish a defect.

## Caveats / Not Found

### Verification supplied by the main session

The main session reported these results on 2026-11-03; this researcher did not run or independently inspect the gate outputs:

- Forced Android :app:testDebugUnitTest --rerun-tasks: **580 tests / 63 suites; failures 0, errors 0, skipped 0**.
- Android lint: **43 warnings / 26 information / 0 errors**; APK assembly passed.
- Shared tests: **388 tests / 12 files passed**; server tests: **1047 tests / 49 files passed**; server production build passed.
- Main separately found server test-only lint and TypeScript typecheck errors. Their exact diagnostics and impact belong to the main/backend report and were not inspected here.

These are actual gate results reported by the coordinator, not a claim of device verification or proof that untested wiring behaves correctly. The original plan's older test counts were not reused as fresh evidence.

### Explicitly unreviewed or incompletely reviewed

- No builds, tests, devices, SAF interactions, IME/small-screen/touch/TalkBack checks, weak-network sessions, process-death recovery, provider calls, or deployed server were exercised here.
- No backend financial arithmetic, current reserve-reference selection (R11), distinct category entity counts (R18), historical stats-window implementation (R19), or SQL atomicity was re-audited.
- Not all branches of salary legacy cleanup/malformed pending UI, salary plan-confirmation/restart invalidation, execution-tool pending recovery, every auth consumer, every active/inactive BackHandler, or every owner/error/finally path were exhaustively traced.
- The goal operation lookup resource/path check and capability/cancellation edge cases deserve further review; only key/method checks were confirmed in the inspected recovery branch. This is incomplete verification, not an additional confirmed exploit or corruption report.
- Test paths and named methods are static coverage evidence; many test bodies were inventoried rather than exhaustively reviewed. In particular, a test name matching the plan does not imply it tests the production Compose caller.
- Attention-priority sorting and every original-note/category variant were not exhaustively reviewed; the default attention filter and explicit empty-note adoption UI were inspected.
- No whole-catalogue or original 46-item acceptance-matrix closure audit was performed. This report should not be used to mark all T01–T14 or R01–R20 accepted.
- Research stopped at the main session's timebox. No further exploration or speculative issues were added.

### Intentional old behavior and evidence gaps that are not new defects

- The server's legacy unkeyed salary route remains compatible. The new Android safe-key gate and manual reconciliation are the client-side repair; preserving that old server path is intentional.
- Salary creation and explicit plan inclusion remain separate operations; skipping inclusion does not mean salary failed and must not create another salary.
- Ordinary refunds remain income and ordinary expense remains gross; attributed four-purpose spending and manual reserve/investment facts are separate domains. Android should display server calculations, not derive new arithmetic.
- Imported bytes and review tokens remain memory-only by design. Having to reselect originals after process death is an acknowledged limitation; abandoning the original mutation metadata/key is the confirmed A02 defect.
- A ready goal history reducer and API includeDeleted support do not prove an Android deleted-history selector exists. This is a catalogue/API-presentation distinction, not evidence that deleted records disappeared from the backend.
- Historical plan status text and missing device acceptance do not by themselves establish a product source bug. The six findings above are based on concrete current call chains or state transitions.

Recommended integration priority: preserve A01–A06 as prior-repair findings separate from the new four-purpose simplification requirements. The allocation/remaining-versus-classification decision belongs to the main session and was not resolved or expanded by this audit.
