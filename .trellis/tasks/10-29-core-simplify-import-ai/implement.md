# C5 统一账单导入与按需 AI Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Apply Trellis before-dev/context/check routing and the approved planning version.

**Goal:** 新平台导入只需一个工作区，默认人工核对，AI按需分析；权威确认、旧卡片和其他数据格式都保持正确。

**Architecture:** Extract the batch workspace into a reusable standalone entry without mounting hidden full-size AssistantTab. New platform imports use one host for one/many supported files; Assistant origin keeps conversation/return context.

**Tech Stack:** Kotlin/Compose and existing TypeScript/Fastify/SQLite/shared tools; no new framework.

**Spec:** [prd.md](prd.md), [design.md](design.md), [parent interfaces](../10-29-core-finance-simplification/design.md), [acceptance matrix](../10-29-core-finance-simplification/acceptance.md).

## Global Constraints

Dependencies: C1、C4. Read the parent global constraints and this child's exact file/interface ownership before implementation. Keep integer cents, server-owned arithmetic, existing historical contracts, scoped request ownership and idempotence. Only implementation approval of the latest planning version permits task activation. Initial checkboxes represent future work, not completed features.

## Review Focus

- C5-01: 数据/AI的新平台导入共用工作区；取消不建空批次。
- C5-02: 无AI人工可用，全程模型调用0。
- C5-03: 1–5文件、5/8MiB及500行合同保留。
- C5-04: 异常优先仍可看全部；备注/选项/分页草稿准确。
- C5-05: 权威总计/批准/哈希/令牌验证与原子确认正确。

## Files and Interfaces

Exact inspect/modify/create/test paths are in design.md. PlatformImportEntryContext carries source=data/assistant, conversationId?, and returnRoute. Use existing AssistantRepository create/get/rows/categories/review/confirm/cancel methods and ImportBatch typed data; the standalone host obtains its real protocol context only after valid selection and explicit start. Do not define a second importer or bypass reviewToken/viewRevision/hash/category approval. C1's secondary tool route is the integration point.

## Ordered steps

- [ ] **Step 1: Pin no-AI/manual-confirm behavior**

  Add an import-batch-manual-flow API fixture with disabled/unconfigured provider. Parse/edit/review/confirm selected rows and assert Provider/generation call count0 and transaction row count increases only by selected rows.

- [ ] **Step 2: Extract the common new-entry host**

  Implement PlatformImportHost and entry context by reusing the batch workspace. Obtain a real conversation only after supported file selection and explicit start; cancel must not create an empty conversation/batch.

- [ ] **Step 3: Route new platform imports consistently**

  Wire Data and Assistant new file entry to the same host sequentially after earlier MainShell/MyTab integration. Old action cards keep their legacy host/repository calls; native CSV/transfer/backup remain separately labeled formats.

- [ ] **Step 4: Simplify review presentation and optional AI**

  Default to actionable exceptions with All access; retain remarks, choices and classifications across100-row pages. AI analysis is explicitly opt-in; failure does not block manual review. Final amounts/selectedRows come from server review.

- [ ] **Step 5: Verify limits, tokens and unknown results**

  Run current limits/regression/confirm tests with1–5 files,5/8MiB limits and500 rows. Verify original mutation, expired review, category approval, collision locks, double confirmation and query-original-batch recovery.

- [ ] **Step 6: Verify device picker and tool configuration**

  Run C5-01–C5-08 and Android behavior/lint/build; on device check SAF cancellation/replacement, keyboard, pagination, back context, disabled AI and existing Provider folding/models.

- [ ] **Step 7: Maintain inventory, review and commit**

  Update affected D and A import/navigation/API coverage only. Review old-client/file-format compatibility and commit scoped completion with evidence before G01–G06.

## First behavior assertions

These assertions pin the behavior described above; fixtures/imports use the existing test setup and the explicit design interfaces. For UI-only visibility/copy work, no new source-text or mirror test is required.

~~~typescript
expect(providerRequests).toHaveLength(0);
expect(db.prepare('SELECT count(*) AS n FROM transactions WHERE deleted = 0').get())
  .toMatchObject({n: initialTransactionCount + selectedCount});
// A cancelled picker must leave both conversation and batch counts unchanged.
~~~

Focused command before/after the new implementation (from repository root):

~~~powershell
pnpm --filter @jizhang/server test test/import-batch-manual-flow.test.ts --maxWorkers=2
~~~

Initial expected result: new helper/test behavior is absent or fails. Final expected result: exit0 with the named behavior assertions passing. Follow with the relevant existing regression suites; do not change timeouts or expected financial values to hide failures.

## Verification gate

Run server import limits/confirm/identity/regression/manual-flow tests and full server lint/typecheck/test --maxWorkers=2/build when its API changed. At clients/android run JVM/lint/assembleDebug, then actual picker/manual/unknown-result device flows.

Use the full authoritative C5 cases in parent acceptance.md; add evidence under this child only during actual execution. Inventory maintenance is part of the same feature change. Source/JVM/API fixture/device/live deployment are separate levels. A missing device leaves those acceptance cases pending rather than making this task product-complete.
