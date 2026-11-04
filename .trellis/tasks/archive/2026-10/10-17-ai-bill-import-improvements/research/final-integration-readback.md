# Final integration readback — Android boundaries & server response fixtures

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`  
Date: 2026-10-17  
Scope: read-only source verification of the five Android findings recorded in `research/final-cross-layer-review.md`, plus local production-route response generation. No product/test/spec/README/config changes; no device/provider/deployment/financial confirmation; no dependency install or Git staging/commit.

## Five prior Android findings — independently rechecked

| Finding | Current evidence | Result |
|---|---|---|
| Review row omitted category type and approved new-category name | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt:728-750` declares/decodes `categoryType` and `approvedNewCategoryName`; workspace at `AssistantBatchImportWorkspace.kt:1549-1652` displays category plan/type and “拟新建”. | Fixed in current source. |
| Strict Long reader could accept 2^63 via Double rounding | `AssistantBatchModels.kt:14-40` checks finite floating point and uses `BigDecimal(...).longValueExact()`; tests in `clients/android/app/src/test/java/com/yansuu1/jizhang/net/AssistantBatchNetworkContractTest.kt:600-655` cover Long boundaries and 2^63/overflow. | Fixed in current source/tests. |
| Review count dimensions missing or conflated | Typed `ReviewSummaryCounts` at `AssistantBatchModels.kt:769-804`; UI distinguishes `ruleIgnored` and nullable `userExcluded` (`AssistantBatchImportWorkspace.kt:1471-1491`), showing “未提供” for null. | Fixed in current source. |
| Five-page load could accept an incomplete 450/500 collection | Workspace calls `validateAndReduceBatchPages` (`AssistantBatchImportWorkspace.kt:177`); pure validation in `AssistantBatchModels.kt:1012+` checks totals/cursors/unique IDs; regression case at `AssistantBatchImportStateTest.kt:801+`. | Fixed in current source/tests. |
| Empty `viewRevision` could bypass consistency validation | Required non-empty decoding for batch/rows/categories/review at `AssistantBatchModels.kt:289,490,620,888`; strict equality guard at `AssistantBatchImportWorkspace.kt:138-139`. | Fixed in current source. |

This is a source/test readback only. It does not rerun Android tests, lint, build, APK, or device verification.

## Local integration evidence

Generated JSON files under `artifacts/import-integration-fixtures/` by running the checked-in generator against the real Fastify route handlers (`app.inject`) and an in-memory SQLite database. The create route was called with `analyse:false`; no provider request occurred. A repository synthetic WeChat CSV fixture supplied the actual input. Only the temporary test database had the expense Other category soft-deleted to exercise the existing server-fallback suggestion and explicit approval path.

- `batch.json`: actual GET batch response.
- `rows.json`: actual GET rows response pages combined, 34 server rows.
- `categories.json`: actual GET categories response, including `server-fallback` Other suggestion.
- `review.json`: actual POST review response, with only `reviewToken` replaced by the literal `<SYNTHETIC_REDACTED_REVIEW_TOKEN>`; no auth cookie/session/header exported.
- `manifest.json`: generator conditions, source SHA-256s, response counts, provider call count, before/after financial table hashes and successful exit code.
- `generate-import-fixtures.mts`: reproducible local generator; run from repository root with `node node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs artifacts/import-integration-fixtures/generate-import-fixtures.mts`.

Observed in generated actual review response:
- two selected rows: one existing-category assignment and one server-fallback Other suggestion explicitly approved;
- selected suggested row reports `categoryType: 0`, `approvedNewCategoryName: "其他"`, `note: ""`;
- `counts.userExcluded` is JSON `null`, and ruleIgnored remains separately reported;
- provider calls: 0;
- hashes of temporary `categories` and `accounts` tables are identical before vs after review; review did not confirm or write financial data.

`manifest.json` currently records exitCode 0 and the source hashes. The JSON outputs were parsed with Node JSON.parse successfully. The fixture is intentionally synthetic and does not prove device/provider/production behavior. `rows.json` includes source row labels/notes from the project’s existing synthetic test fixture; it contains no live user data.

## Evidence boundary

No complete server or Android test gates were rerun. Existing test totals/build notes elsewhere in this task remain prior-session evidence. This readback only attests source inspection and the successful local route generation described above.
