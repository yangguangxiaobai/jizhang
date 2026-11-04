# AI-assisted bill import with human review

## Goal
Deliver an Android assistant bill-import loop: upload, real AI analysis, editable human review, explicit confirmation, and verified ledger persistence. User confirmed this task is limited to bill import, not all-app tool coverage.

## Requirements and acceptance
- R1 / AC1: File financial facts are extracted deterministically; the configured AI analyses the preview and proposes inclusion/exclusion with reasons and valid existing categories. AI cannot change source amount/date/order identity or execute writes. Human can reverse suggestions on otherwise eligible rows. No ledger changes before final confirmation. Provider failure is shown honestly, with explicit retry, not disguised rule-only success.
- R2 / AC2: Refunded original purchases are selectable expenses; actual refund movements are separate refund incomes. Preserve gross expense accounting. Partial refunds use actual refund movement amounts. Never manufacture refund income from original purchase status/amount. Missing refund evidence is surfaced. Refund identity is independent of category name.
- R3 / AC3: Existing stable IDs and invalid/failed transactions remain protected; possible duplicates are manually selectable. Every disabled row and the 100-selection limit has a visible explanation. AI recommends rather than determines hard eligibility.
- R4 / AC4: Select active, type-compatible bookable existing categories. No implicit category creation/restoration in assistant import. Expense parents with children cannot be selected. Missing categories must be resolved by the user before confirmation.
- R5 / AC5: Show source-generated note separately and allow explicit changes, including clearing it. The final confirmation and saved ledger use reviewed category/note values; untouched notes are preserved.
- R6 / AC6: Original-file digest, current ledger/category validation, explicit nonempty selection, atomic write, and existing duplicate-confirm protection apply to reviewed values. Confirmation does not rerun AI or discard human edits. Source mismatch/stale preview/invalid category results in no partial import. Unknown write outcome requires refresh, not automatic retry.
- R7 / AC7: Retain current bounded preview (200 rows) and selection (100 rows), clearly disclose limits and unanalysed/unshown rows; no hidden whole-file import. Update affected Android stable feature entries with source/test vs device evidence distinguished.

## Source evidence
- Attachment path bypasses model: `packages/server/src/services/assistant-orchestrator.ts:114–145`; decode/parse: `portability-service.ts:734–771`; keyword classification: `packages/shared/src/platform-bills.ts:79,381–390`.
- Decoder drops detailed ignore reason; excludes existing/ignored/nonpositive rows: `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt:18–23`. Checkbox also gates pending/busy/100 selection: `AssistantImportWorkspace.kt:82`.
- Category free text and create/restore warning: `AssistantImportWorkspace.kt:54–57`; name overrides: `portability-service.ts:831–836`.
- Generated note joins goods/counterparty/remark up to 200 chars: `platform-bills.ts:381–402`; preview note: `portability-service.ts:816`; insert: `:958`. Android uses note as title (`AssistantImportState.kt:19`), no editor.
- Blanket refund skip: `platform-bills.ts:294–300`; refund flag derived from income/category name: `portability-service.ts:932`.
- Current 30-tool catalog is not all-app coverage: `assistant-tool-registry.ts:318–350`; broader inventory work is deferred by user.

## Scope and compatibility
Implement Android assistant import, shared source/refund classification, required API/provider/review contracts and tests. Shared parsing fixes may affect data-management platform import and must have regression coverage. Strict existing-category selection belongs to assistant import; do not silently change the legacy data-management name-based contract.

## Out of scope
Full app AI tool coverage, production deployment, Harmony UI, automatic import, relaxed duplicate protection, altered gross-expense/refund-income accounting, invented refund links or movements, expanded preview limits.

## Decisions
User approved real AI analysis with mandatory human review, original expense plus separate actual refund income, existing-category picker, editable independent notes, and bill-import-only scope. No blocking product questions remain. Final plan review and subsequent implementation approval are required. No product code changed during planning.
