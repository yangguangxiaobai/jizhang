# C1 核心导航与快捷记账精简 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Apply Trellis before-dev/context/check routing and the approved planning version.

**Goal:** 让普通支出通过金额、分类、保存完成；计划直接可达，AI和扩展工具按需进入，返回与草稿保持正确。

**Architecture:** Recording visibility reuses the existing draft and save owner. Remembered accounts are scoped by serverBaseUrl/username and validated against active accounts; a pinned original refund account cannot fall back.

**Tech Stack:** Kotlin/Compose and existing TypeScript/Fastify/SQLite/shared tools; no new framework.

**Spec:** [prd.md](prd.md), [design.md](design.md), [parent interfaces](../10-29-core-finance-simplification/design.md), [acceptance matrix](../10-29-core-finance-simplification/acceptance.md).

## Global Constraints

Dependencies: 无前置子任务. Read the parent global constraints and this child's exact file/interface ownership before implementation. Keep integer cents, server-owned arithmetic, existing historical contracts, scoped request ownership and idempotence. Only implementation approval of the latest planning version permits task activation. Initial checkboxes represent future work, not completed features.

## Review Focus

- C1-01: 核心底部入口与计划/＋返回正确。
- C1-02: AI及更多工具可进入、返回，无隐藏触摸覆盖。
- C1-03: 20元普通支出最多3个业务步骤。
- C1-04: 折叠和键盘切换不丢草稿或载荷。
- C1-05: 最近账户失效和作用域切换不沿用错误账户。

## Files and Interfaces

Exact inspect/modify/create/test paths are in design.md. Implement resolveRecordingAccount(lastAccountId: String?, activeAccountIds: List<String>, refundAccountId: String?): RecordingAccountResult in RecordingDefaults.kt as defined in parent design §2. MainShell remains the sole primary/secondary return owner. Expose an income-to-salary hook for C2; do not implement a second wage writer.

## Ordered steps

- [x] **Step 1: Pin default-account behavior**

  Add RecordingDefaultsTest for active last account, deleted last account, no active accounts, server/user isolation and an unavailable pinned refund account. Run the specific JVM test and observe the new helper is missing before implementing it.

- [x] **Step 2: Implement recording defaults**

  Implemented the exact helper in parent design §2 and scoped preference reads/writes. The refund seed retains its original account or surfaces the existing unavailable-account error; there is no silent fallback.

- [x] **Step 3: Reorder navigation and tool entry**

  MainShell/MyTab/Dashboard now use 首页/账单/＋/计划/我的. AI is a source-return secondary destination; assets, icons, templates and old financial tools remain reachable under 更多工具; the plan is directly available from the bottom bar and one home card.

- [x] **Step 4: Fold optional metadata**

  TransactionEditSheet folds notes/tags/purpose under 更多 with visibility-only state; existing values, explicit-null purpose payloads, keyboard focus, and single-submit owner remain. Income exposes a separate salary handoff that preserves the editor draft.

- [ ] **Step 5: Verify behavior and device usage**

  Run existing editor/refund tests and the new account tests; lint/build. Perform C1-01–C1-08 on a synthetic account, including keyboard switching, cancel/edit/save and unavailable refund source.

- [ ] **Step 6: Update inventory and review**

  Recheck L00/L04, affected B03/A001 and tool entry sections; preserve IDs and record source/device evidence separately. Independently review this scope before C2.

- [ ] **Step 7: Commit scoped completion**

  After actual checks, commit only C1 files plus its inventory/evidence. Keep device-pending cases open if a device is unavailable.

## First behavior assertions

These assertions pin the behavior described above; fixtures/imports use the existing test setup and the explicit design interfaces. For UI-only visibility/copy work, no new source-text or mirror test is required.

~~~kotlin
val result = resolveRecordingAccount("deleted", listOf("active"), null)
assertEquals("active", result.accountId)
assertNull(result.error)
val pinned = resolveRecordingAccount("active", listOf("active"), "original-deleted")
assertNull(pinned.accountId)
assertNotNull(pinned.error)
~~~

Focused command before/after the new implementation (from clients/android):

~~~powershell
./gradlew.bat :app:testDebugUnitTest --tests 'com.yansuu1.jizhang.ui.RecordingDefaultsTest'
~~~

Initial expected result: new helper/test behavior is absent or fails. Final expected result: exit0 with the named behavior assertions passing. Follow with the relevant existing regression suites; do not change timeouts or expected financial values to hide failures.

## Verification gate

From clients/android run ./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug. Exit0 and no test failures/blocking lint errors; device checks are separate.

Use the full authoritative C1 cases in parent acceptance.md; add evidence under this child only during actual execution. Inventory maintenance is part of the same feature change. Source/JVM/API fixture/device/live deployment are separate levels. A missing device leaves those acceptance cases pending rather than making this task product-complete.
