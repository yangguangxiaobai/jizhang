# In-workspace duplicate bill comparison

## Goal
Let Android assistant-import users inspect corresponding existing ledger records directly in the import workspace and decide whether to include a suspected duplicate, without losing review drafts.

## Consent
User explicitly requested creation and completion of this task, independently of prior import-task archival blocker. Implementation still awaits final reviewed planning summary approval.

## Requirements / acceptance
- R1: Each possible-duplicate row exposes a clear comparison entry showing source bill and the actual matching existing ledger rows, with date, integer-cent amount, type/refund identity, account, category and full note as available; source order/status/counterparty shown where available, never fabricated.
- R2: Match the existing heuristic: live transactions in the chosen platform account with equal server-local calendar day, type and amount. Explain this is a heuristic, not proof. Preserve stable-ID hard dedup; never relax existing-ID blockers.
- R3: Show all matches through bounded pagination and count, not silently first match only; support loading, failure/retry, empty or no-longer-existing candidates. Candidate reads never invoke AI or write ledger.
- R4: Compare within current workspace. Keep import selection, category/note drafts, query/filter and scroll state. User may explicitly keep/select or exclude the source row within existing eligibility/100-selection rules; opening/closing comparison alone changes nothing.
- R5: Comparison candidates come from current server records scoped to the owning authenticated conversation/action and displayed preview row. Stale/cancelled/replaced actions cannot leak into another workspace; final confirmation retains existing digest/staleness/atomic/idempotence guards.
- R6: Update affected stable Android inventory entries and tests, distinguishing source/mock/build from device evidence.
- R7: Full user autonomy over import selection: remove the artificial "不可导入" blocking restriction. Every valid transaction row (amount > 0 and unimported) in the preview is eligible for the user to select or deselect for import. Heuristic rule reasons (such as 资金划转/充值提现) are informational status tags only, not hard blockers. The UI filter provides "全部", "已选入", "未选", "疑似重复" instead of "不可导入".

## Evidence
portability-service.ts:782–817 currently stores only the first matching note in softDup; no candidate IDs are returned. assistant-tool-registry.ts:318–319 forwards possibleDuplicate and truncated duplicateOfNote. AssistantImportState.kt ignores candidate note and displays only suspicion status. Inspect affected README and detail/repository reuse before implementation.

## Scope
Android assistant import, matching read service/API, additive minimal preview candidate metadata and tests. Existing data-management contract compatible. Preserve unrelated177 working-tree changes and prior unfinished import implementation.

## Out of scope
Automatic merge/delete, existing-ledger editing, expanded match heuristic, AI latency fix, full app AI coverage, production deployment/install or real ledger writes without separate approval.

## Risks
Old pending previews lack new row facts; fail with clear refresh/re-upload instruction. Existing category/account may be deleted; historical names require deleted-reference reads. Live candidate change means comparison is timestamped current read, not guaranteed final snapshot.
