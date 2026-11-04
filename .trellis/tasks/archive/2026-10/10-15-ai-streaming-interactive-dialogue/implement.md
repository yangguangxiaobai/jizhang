# Execution plan

- [x] Archive old task at user request, with closure gaps and --no-commit preserving mixed WIP.
- [x] Create new task; Pi native planner/frontend investigate in parallel.
- [x] User approved visual-only final MVP and parallel implementation with “开始”.
- [x] Actual Ardot design delivered via native frontend agent: 5 editable frames, corrected semantic issues and screenshot/readback evidence. Visual MVP design baseline established.
- [x] Final PRD convergence and final review approved; protocol v1 frozen before task start.
- [x] Parallel native backend transport/parser/generation persistence/routes/tests and Android network/repository/reducer/UI/tests with disjoint file ownership.
- [x] Independent review, server lint/typecheck/test/build (582 tests passed, Patch #2 deployed `31bb967e...`), shared lint/typecheck/tests (176 passed; final logs retained), Android unit/lint/assemble (91 tests passed across 10 suites, verified from Gradle Test XML).
- [x] Update stable Android inventory and stream/error/lifecycle specs (spec/backend/assistant-streaming.md updated with scroll Triple lesson, no wire contract change).
- [x] Separately authorized backend patch deployment (`jizhang:api-chained-choice-20261016T083118Z`, `sha256:31bb967e...`) and debug APK verification/installation (initial `sha256:d2a37b55...` byte identity confirmed; retained as 4-suite baseline history).
- [x] Real physical device functional verification executed across 4 targeted suites (chained choice round2, zero-delta placeholder + Stop, multi-frame visible provisional stream text growth, ABA conversation lifecycle isolation; zero real test booking).
- [x] Android scroll indicator fix: `snapshotFlow` with `Triple(newMessagesAvailable, atBottom, isScrollInProgress)` + independent review PASS + 2 new regression unit tests (HelperTest 23->25, total 89->91).
- [x] New Debug APK (`sha256:5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e`) installed via `adb install -r`, pulled `base.apk` byte-equality confirmed (`cmp` IDENTICAL). Prior APK `d2a37b55...` preserved in history.
- [x] Real physical device live retest (`phone-verifier-scroll-live-retest`): single read-only stream request; 35 native screencaps sampled at ~400ms (event payload bytes != prose chars); off-bottom swipe triggered "有新消息，跳到最新" pill appearance (frames 14~21); in `04-terminal.xml` pill remained 1 (legitimate, not yet true bottom); in `06-scroll-bottom.xml` natural scroll to bottom auto-dismissed pill to 0 (swipe performed a few minutes after terminal, not claiming terminal instant auto-dismiss or microsecond timing); zero double bubbles, zero residual pill.
- [x] Provider reliability review completed (`research/provider-reliability-review.md`): 20s timeout confirmed as saved whole-call budget (headers + body); without raw payload cannot assert parser fragility; 100% external success not contracted. Two failures (219-char `INVALID_ENVELOPE` and 20s TTFT timeout) remain FAILED. Spec retains failure partial provisional mechanism and no automatic retry, strongly advise against violating contract by silent fallback or mutating timeout/model.
- [ ] 完整验收与上游稳定性：UNCHECKED / INCOMPLETE（核心已列功能专项通过；外部 provider 可靠性有两失败记录 / 大字弱网长对话未全测，完整验收仍 PARTIAL，待 parent 验收）。
- [ ] Scoped git commit review and archive: UNCHECKED (not authorized; task lifecycle stays in_progress).

## Acceptance checks
Actual prose arrives before delayed upstream completion, no simulated typing. UTF8/framing/oversize/deadline/cancel cleanup. Duplicate/conflict/replay/restart/archival races. Stale/forged choice and double-tap protections. Android A->B->A/old GET isolation, scroll/IME/reduced motion. Existing confirmations/import hash/100 cap regressions. Fixed-clock today prompt test. Ledger unchanged during generation/choice. Evidence separated into mocks/build/provider/device.

## Rollback
Task-owned hunks only; additive migration and old-client compatibility rehearsed before production. Never restore DB over new writes or stage unrelated WIP.

## 用户要求的行政归档

已按用户指令归档，关闭任务生命周期；完整验收仍 PARTIAL，未完成项不补勾。使用 `--no-commit` 保留全部混合 WIP，未提交代码。归档说明见 `archive-status.md`。
