package com.yansuu1.jizhang.net

import com.yansuu1.jizhang.ui.feature.assistant.*
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportOwnerKey
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportSource
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportWorkspaceRef
import com.yansuu1.jizhang.ui.feature.imports.canTriggerOptionalAiAnalysis
import com.yansuu1.jizhang.ui.feature.imports.isCurrentFor
import com.yansuu1.jizhang.ui.FinancialScope
import com.yansuu1.jizhang.repo.buildImportBatchCreateBody
import com.yansuu1.jizhang.repo.parseConfirmedImportBatchResult
import com.yansuu1.jizhang.repo.parseOwnedImportBatch
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AssistantBatchNetworkContractTest {

    @Test
    fun categoryAssignmentJsonSerializationAndDeserialization() {
        val existing = CategoryAssignment.Existing("builtin-food")
        val existingJson = existing.toJson()
        assertEquals("existing", existingJson.getString("kind"))
        assertEquals("builtin-food", existingJson.getString("categoryId"))

        val parsedExisting = CategoryAssignment.fromJson(existingJson)
        assertEquals(existing, parsedExisting)

        val suggestion = CategoryAssignment.Suggestion("sug-toys")
        val sugJson = suggestion.toJson()
        assertEquals("suggestion", sugJson.getString("kind"))
        assertEquals("sug-toys", sugJson.getString("suggestionId"))

        val parsedSug = CategoryAssignment.fromJson(sugJson)
        assertEquals(suggestion, parsedSug)

        assertNull(CategoryAssignment.fromJson(JSONObject().put("kind", "unknown")))
    }

    @Test
    fun approvedCategoryJsonSerializationAndDeserialization() {
        val createApproved = ApprovedCategory(
            suggestionId = "sug-1",
            resolution = "create",
            reuseCategoryId = null,
            name = "潮玩",
            type = 0,
            parentId = null,
        )
        val createJson = createApproved.toJson()
        assertEquals("sug-1", createJson.getString("suggestionId"))
        assertEquals("create", createJson.getString("resolution"))
        assertTrue(createJson.isNull("reuseCategoryId"))
        assertEquals("潮玩", createJson.getString("name"))
        assertEquals(0, createJson.getInt("type"))
        assertTrue(createJson.isNull("parentId"))

        val parsedCreate = ApprovedCategory.fromJson(createJson)
        assertEquals(createApproved.suggestionId, parsedCreate.suggestionId)
        assertEquals(createApproved.resolution, parsedCreate.resolution)
        assertNull(parsedCreate.reuseCategoryId)
        assertEquals(createApproved.name, parsedCreate.name)
        assertEquals(createApproved.type, parsedCreate.type)

        val reuseApproved = ApprovedCategory(
            suggestionId = "sug-2",
            resolution = "create",
            reuseCategoryId = "cat-existing-1",
            name = "餐饮",
            type = 0,
            parentId = "parent-1",
        )
        val reuseJson = reuseApproved.toJson()
        assertEquals("create", reuseJson.getString("resolution"))
        assertEquals("cat-existing-1", reuseJson.getString("reuseCategoryId"))
        assertEquals("parent-1", reuseJson.getString("parentId"))

        val parsedReuse = ApprovedCategory.fromJson(reuseJson)
        assertEquals(reuseApproved.reuseCategoryId, parsedReuse.reuseCategoryId)
        assertEquals(reuseApproved.parentId, parsedReuse.parentId)
        assertEquals("create", parsedReuse.resolution)
    }

    @Test
    fun conflictDecisionSerializationSupportsChosenAndExcludeAll() {
        val chooseOne = ConflictDecision("g1", "item-123")
        val chooseJson = chooseOne.toJson()
        assertEquals("g1", chooseJson.getString("conflictGroup"))
        assertEquals("item-123", chooseJson.getString("chosenItemId"))

        val excludeAll = ConflictDecision("g2", null)
        val excludeJson = excludeAll.toJson()
        assertEquals("g2", excludeJson.getString("conflictGroup"))
        assertTrue(excludeJson.isNull("chosenItemId"))

        val parsedChoose = ConflictDecision.fromJson(chooseJson)
        assertEquals("item-123", parsedChoose.chosenItemId)

        val parsedExclude = ConflictDecision.fromJson(excludeJson)
        assertNull(parsedExclude.chosenItemId)
    }

    @Test
    fun reviewPayloadMatchesProtocolFixtures() {
        // Matches fixture review payload format from merged-import-protocol-fixtures-v1.json
        val selectedItemIds = listOf("po:wechat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        val assignments = mapOf("po:wechat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" to CategoryAssignment.Existing("builtin-expense-food"))
        val noteOverrides = mapOf("po:wechat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" to "")

        val assignmentsObj = JSONObject()
        assignments.forEach { (k, v) -> assignmentsObj.put(k, v.toJson()) }

        val notesObj = JSONObject()
        noteOverrides.forEach { (k, v) -> notesObj.put(k, v) }

        val body = JSONObject()
            .put("version", 1)
            .put("analysisRevision", 1)
            .put("viewRevision", "fixture-view")
            .put("selectedItemIds", JSONArray(selectedItemIds))
            .put("categoryAssignments", assignmentsObj)
            .put("noteOverrides", notesObj)
            .put("approvedCategories", JSONArray())
            .put("conflictDecisions", JSONArray())

        assertEquals(1, body.getInt("version"))
        assertEquals(1, body.getInt("analysisRevision"))
        assertEquals("fixture-view", body.getString("viewRevision"))
        assertEquals(1, body.getJSONArray("selectedItemIds").length())
        assertEquals("builtin-expense-food", body.getJSONObject("categoryAssignments").getJSONObject("po:wechat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").getString("categoryId"))
        assertEquals("", body.getJSONObject("noteOverrides").getString("po:wechat:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
    }

    @Test
    fun reviewResponseParserReadsStrictSummary() {
        val json = JSONObject("""
        {
            "reviewToken": "token-xyz-123",
            "version": 2,
            "analysisRevision": 3,
            "viewRevision": "view-hash-456",
            "expiresInSec": 900,
            "summary": {
                "selected": 450,
                "amountCents": 1234500,
                "expenseCents": 1000000,
                "incomeCents": 234500,
                "refundIncomeCents": 5000,
                "categoriesToCreate": [
                    { "name": "潮玩", "type": 0, "selectedRows": 2 },
                    { "name": "宠物用品", "type": 0, "selectedRows": 1 }
                ],
                "categoriesToReuse": [
                    { "categoryId": "cat-food", "name": "餐饮", "selectedRows": 5 }
                ],
                "selectedRows": [
                    { "itemId": "item-1", "type": 0, "amountCents": 1500, "categoryId": "cat-food", "suggestionId": null, "note": "午餐" }
                ],
                "files": [
                    { "fileName": "wechat.xlsx", "selectedRows": 450 }
                ],
                "excluded": 25,
                "existing": 10,
                "conflicts": 2
            }
        }
        """.trimIndent())

        val resp = ReviewResponse.fromJson(json)
        assertEquals("token-xyz-123", resp.reviewToken)
        assertEquals(2L, resp.version)
        assertEquals(3L, resp.analysisRevision)
        assertEquals("view-hash-456", resp.viewRevision)
        assertEquals(900L, resp.expiresInSec)
        assertEquals(450, resp.summary.selected)
        assertEquals(1234500L, resp.summary.amountCents)
        assertEquals(1000000L, resp.summary.expenseCents)
        assertEquals(234500L, resp.summary.incomeCents)
        assertEquals(5000L, resp.summary.refundIncomeCents)
        assertEquals(2, resp.summary.categoriesToCreateCount)
        assertEquals("潮玩", resp.summary.categoriesToCreate[0].name)
        assertEquals(1, resp.summary.categoriesToReuseCount)
        assertEquals("cat-food", resp.summary.categoriesToReuse[0].categoryId)
        assertEquals(1, resp.summary.selectedRows.size)
        assertEquals("item-1", resp.summary.selectedRows[0].itemId)
        assertEquals(1, resp.summary.files.size)
        assertEquals("wechat.xlsx", resp.summary.files[0].fileName)
        assertEquals(25, resp.summary.excluded)
        assertEquals(10, resp.summary.existing)
        assertEquals(2, resp.summary.conflicts)

        // Nullable file row counts on failure
        val failedFileJson = JSONObject("""
        {
            "fileIndex": 0,
            "fileName": "corrupted.xlsx",
            "source": "wechat",
            "sizeBytes": 1024,
            "sha256": "abc",
            "parseStatus": "failed",
            "rawRowCount": null,
            "collectedRowCount": null,
            "error": "损坏的文件"
        }
        """.trimIndent())
        val failedFile = ImportBatchFile.fromJson(failedFileJson)
        assertNull(failedFile.rawRowCount)
        assertNull(failedFile.collectedRowCount)
        assertEquals("failed", failedFile.parseStatus)

        // Batch row duplicate typed DTO
        val duplicateJson = JSONObject("""
        {
            "source": { "itemId": "item-1" },
            "total": 1,
            "items": [
                {
                    "id": "txn-999",
                    "type": 0,
                    "amountCents": 1500,
                    "categoryId": "cat-food",
                    "accountId": "acc-wx",
                    "date": 1729000000000,
                    "note": "疑似同日同额",
                    "isRefund": false,
                    "accountName": "微信支付",
                    "categoryName": "餐饮"
                }
            ],
            "nextCursor": null,
            "readAt": 1729000100000,
            "rationale": "同平台同日同额"
        }
        """.trimIndent())
        val dupPage = BatchRowDuplicatePage.fromJson(duplicateJson)
        assertEquals("item-1", dupPage.sourceItemId)
        assertEquals(1, dupPage.total)
        assertEquals("txn-999", dupPage.items[0].id)
        assertEquals("微信支付", dupPage.items[0].accountName)
        assertEquals("同平台同日同额", dupPage.rationale)
    }

    @Test
    fun confirmResponseParserReadsAuthoritativeResult() {
        val json = JSONObject("""
        {
            "batch": { "batchId": "b-1", "status": "confirmed" },
            "result": {
                "inserted": 455,
                "selected": 455,
                "excluded": 25,
                "preexisting": 20,
                "expenseCents": 1234500,
                "incomeCents": 200000,
                "accountsCreated": 1,
                "categoriesCreated": 2,
                "categoriesReused": 0,
                "categoriesSkippedUnused": 1,
                "warnings": ["部分历史未导入账单提示"]
            }
        }
        """.trimIndent())

        val res = ImportBatchResult.fromJson(json.getJSONObject("result"))
        assertNotNull(res)
        assertEquals(455, res!!.inserted)
        assertEquals(455, res.selected)
        assertEquals(25, res.excluded)
        assertEquals(20, res.preexisting)
        assertEquals(1234500L, res.expenseCents)
        assertEquals(200000L, res.incomeCents)
        assertEquals(1, res.accountsCreated)
        assertEquals(2, res.categoriesCreated)
        assertEquals(1, res.categoriesSkippedUnused)
        assertEquals(1, res.warnings.size)
        assertEquals("部分历史未导入账单提示", res.warnings[0])
    }

    @Test
    fun manualBatchRequestBodyKeepsAnalyseFalseExplicit() {
        val files = JSONArray().put(JSONObject().put("fileName", "bill.csv").put("fileBase64", "AQID"))
        val body = buildImportBatchCreateBody("req-manual-01", files, analyse = false)

        assertEquals("req-manual-01", body.getString("clientRequestId"))
        assertFalse("manual entry must not invoke AI implicitly", body.getBoolean("analyse"))
        assertEquals(1, body.getJSONArray("files").length())
    }

    @Test
    fun importBatchDecoderPreservesUnknownAnalysisStateAndRejectsWrongConversation() {
        val response = JSONObject("""
            {
              "batch": {
                "batchId": "batch-1", "conversationId": "conv-owner", "version": 1,
                "status": "prepared", "viewRevision": "view-1", "files": [],
                "summary": {}, "analysis": {"state": "future-analysis-state"}
              }
            }
        """.trimIndent())
        val batch = parseOwnedImportBatch(response, "conv-owner", "batch-1")
        assertEquals("future-analysis-state", batch.analysis.state)

        val unknownBatchStatus = JSONObject(response.toString())
            .getJSONObject("batch")
            .put("status", "future-batch-state")
            .let { JSONObject().put("batch", it) }
        assertEquals("unknown", parseOwnedImportBatch(unknownBatchStatus, "conv-owner", "batch-1").status)

        try {
            parseOwnedImportBatch(response, "conv-other", "batch-1")
            fail("Expected mismatched conversation ownership to fail closed")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message.orEmpty().contains("conversationId"))
        }
    }

    @Test
    fun confirmedImportResultRequiresMatchingConfirmedBatchAndCompleteResult() {
        val response = JSONObject("""
            {
              "batch": {
                "batchId": "batch-1", "conversationId": "conv-owner", "version": 2,
                "status": "confirmed", "viewRevision": "view-2", "files": [],
                "summary": {}, "analysis": {"state": "idle"}
              },
              "result": {
                "inserted": 2, "selected": 2, "excluded": 0, "preexisting": 0,
                "expenseCents": 1200, "incomeCents": 0, "accountsCreated": 0,
                "categoriesCreated": 0, "categoriesReused": 0, "categoriesSkippedUnused": 0
              }
            }
        """.trimIndent())
        val result = parseConfirmedImportBatchResult(response, "conv-owner", "batch-1")
        assertEquals(2, result.inserted)

        try {
            parseConfirmedImportBatchResult(response, "conv-other", "batch-1")
            fail("Expected cross-conversation confirmation to fail closed")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message.orEmpty().contains("conversationId"))
        }

        val unknownResult = JSONObject("""
            {"batch":{"batchId":"batch-1","conversationId":"conv-owner","version":2,"status":"confirmed","viewRevision":"view-2"},"result":{"inserted":2}}
        """.trimIndent())
        try {
            parseConfirmedImportBatchResult(unknownResult, "conv-owner", "batch-1")
            fail("Expected incomplete confirmation result to fail closed")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message.orEmpty().contains("result fields"))
        }
    }

    // ── Strict Numeric Readers & Malformed Wire Production Tests ───────────────

    @Test
    fun strictNumericReadersRejectFractionalAmountCentsOnProductionRowReader() {
        val json = JSONObject("""
        {
            "itemId": "item-frac",
            "identityKind": "occurrence",
            "ordinal": 0,
            "type": 0,
            "amountCents": 123.45,
            "dateLabel": "2024-10-15"
        }
        """.trimIndent())
        try {
            ImportBatchRow.fromJson(json)
            fail("Expected IllegalArgumentException for fractional amountCents")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("fractional") || e.message!!.contains("amountCents"))
        }
    }

    @Test
    fun strictNumericReadersRejectStringWrongTypeOnProductionRowReader() {
        val json = JSONObject("""
        {
            "itemId": "item-str",
            "identityKind": "occurrence",
            "ordinal": 0,
            "type": 0,
            "amountCents": "12300",
            "dateLabel": "2024-10-15"
        }
        """.trimIndent())
        try {
            ImportBatchRow.fromJson(json)
            fail("Expected IllegalArgumentException for string amountCents")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("expected number") || e.message!!.contains("amountCents"))
        }
    }

    @Test
    fun strictNumericReadersRejectFractionalVersionOnProductionPageAndReviewReader() {
        val pageJson = JSONObject("""
        {
            "batchId": "b-1",
            "version": 1.5,
            "analysisRevision": 0,
            "viewRevision": "v1",
            "total": 1,
            "items": [],
            "readAt": 1000
        }
        """.trimIndent())
        try {
            ImportBatchRowsPage.fromJson(pageJson)
            fail("Expected IllegalArgumentException for fractional version")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("fractional") || e.message!!.contains("version"))
        }

        val reviewJson = JSONObject("""
        {
            "reviewToken": "tok-1",
            "version": 1,
            "viewRevision": "rev-1",
            "expiresInSec": 900.5,
            "summary": { "selected": 0, "amountCents": 0, "expenseCents": 0, "incomeCents": 0 }
        }
        """.trimIndent())
        try {
            ReviewResponse.fromJson(reviewJson)
            fail("Expected IllegalArgumentException for fractional expiresInSec")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("fractional") || e.message!!.contains("expiresInSec"))
        }
    }

    @Test
    fun strictReadersFailCloseOnMissingCoreIdOrUnknownStatus() {
        // Missing itemId on ImportBatchRow
        val missingIdJson = JSONObject("""
        {
            "identityKind": "occurrence",
            "ordinal": 0,
            "type": 0,
            "amountCents": 1000,
            "dateLabel": "2024-10-15"
        }
        """.trimIndent())
        try {
            ImportBatchRow.fromJson(missingIdJson)
            fail("Expected IllegalArgumentException for missing itemId")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("itemId"))
        }

        // Invalid type on ImportBatchRow (not 0 or 1)
        val invalidTypeJson = JSONObject("""
        {
            "itemId": "i-1",
            "identityKind": "occurrence",
            "ordinal": 0,
            "type": 2,
            "amountCents": 1000,
            "dateLabel": "2024-10-15"
        }
        """.trimIndent())
        try {
            ImportBatchRow.fromJson(invalidTypeJson)
            fail("Expected IllegalArgumentException for invalid type")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("type"))
        }

        // Unknown parseStatus in ImportBatchFile fails close to "failed"
        val unknownFileJson = JSONObject("""
        {
            "fileIndex": 0,
            "fileName": "test.csv",
            "parseStatus": "unexpected_status"
        }
        """.trimIndent())
        val parsedFile = ImportBatchFile.fromJson(unknownFileJson)
        assertEquals("failed", parsedFile.parseStatus)
        assertNull(parsedFile.rawRowCount)
        assertNull(parsedFile.collectedRowCount)
    }

    // ── 3-Branch Production Decoder IdentityKind Tests ─────────────────────────

    @Test
    fun productionRowDecoderAcceptsPlatformOrderAndOccurrenceAndRejectsUnknownIdentityKind() {
        // Branch 1: platform_order (valid server identity)
        val platformOrderJson = JSONObject("""
        {
            "itemId": "po:item-1",
            "identityKind": "platform_order",
            "ordinal": 0,
            "type": 0,
            "amountCents": 1000,
            "dateLabel": "2026-10-17"
        }
        """.trimIndent())
        val rowPlatform = ImportBatchRow.fromJson(platformOrderJson)
        assertEquals("po:item-1", rowPlatform.itemId)
        assertEquals("platform_order", rowPlatform.identityKind)

        // Branch 2: occurrence (valid server identity)
        val occurrenceJson = JSONObject("""
        {
            "itemId": "oc:item-2",
            "identityKind": "occurrence",
            "ordinal": 1,
            "type": 1,
            "amountCents": 2000,
            "dateLabel": "2026-10-17"
        }
        """.trimIndent())
        val rowOccurrence = ImportBatchRow.fromJson(occurrenceJson)
        assertEquals("oc:item-2", rowOccurrence.itemId)
        assertEquals("occurrence", rowOccurrence.identityKind)

        // Branch 3: unknown identityKind (including rejected legacy_order and arbitrary unknown strings)
        val legacyJson = JSONObject("""
        {
            "itemId": "legacy-item",
            "identityKind": "legacy_order",
            "ordinal": 2,
            "type": 0,
            "amountCents": 3000,
            "dateLabel": "2026-10-17"
        }
        """.trimIndent())
        try {
            ImportBatchRow.fromJson(legacyJson)
            fail("Expected IllegalArgumentException for unsupported legacy_order identityKind")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("Unknown identityKind: legacy_order"))
        }

        val arbitraryUnknownJson = JSONObject("""
        {
            "itemId": "unknown-item",
            "identityKind": "custom_kind",
            "ordinal": 3,
            "type": 0,
            "amountCents": 3000,
            "dateLabel": "2026-10-17"
        }
        """.trimIndent())
        try {
            ImportBatchRow.fromJson(arbitraryUnknownJson)
            fail("Expected IllegalArgumentException for unknown identityKind")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("Unknown identityKind: custom_kind"))
        }
    }

    // ── Nullable ai.include Wire Tests ─────────────────────────────────────────

    @Test
    fun nullableAiIncludePreservesNullAndDistinguishesFromFalseOnWire() {
        // Wire null include
        val nullIncludeJson = JSONObject("""
        {
            "status": "none",
            "include": null,
            "reason": "未分析"
        }
        """.trimIndent())
        val aiNull = ImportRowAi.fromJson(nullIncludeJson)
        assertNotNull(aiNull)
        assertNull(aiNull!!.include)

        // Wire false include (explicit exclusion)
        val falseIncludeJson = JSONObject("""
        {
            "status": "ready",
            "include": false,
            "reason": "AI建议排除"
        }
        """.trimIndent())
        val aiFalse = ImportRowAi.fromJson(falseIncludeJson)
        assertNotNull(aiFalse)
        assertEquals(false, aiFalse!!.include)

        // Wire true include (explicit inclusion)
        val trueIncludeJson = JSONObject("""
        {
            "status": "ready",
            "include": true,
            "reason": "AI建议选入"
        }
        """.trimIndent())
        val aiTrue = ImportRowAi.fromJson(trueIncludeJson)
        assertNotNull(aiTrue)
        assertEquals(true, aiTrue!!.include)

        // Missing include key
        val missingIncludeJson = JSONObject("""
        {
            "status": "ready",
            "reason": "无include键"
        }
        """.trimIndent())
        val aiMissing = ImportRowAi.fromJson(missingIncludeJson)
        assertNotNull(aiMissing)
        assertNull(aiMissing!!.include)
    }

    // ── Full 500 Selected Rows Review Summary Wire Test ────────────────────────

    @Test
    fun full500RowsReviewSummaryDecodesServerAuthoritativeSummaryAndSelectedRows() {
        val selectedRowsArr = JSONArray()
        for (i in 1..500) {
            val isIncome = i % 10 == 0
            val rowObj = JSONObject()
                .put("itemId", "item-$i")
                .put("type", if (isIncome) 1 else 0)
                .put("amountCents", 1000L * i)
                .put("categoryId", if (isIncome) "cat-inc" else "cat-exp")
                .put("suggestionId", JSONObject.NULL)
                .put("note", if (i % 2 == 0) "备注-$i" else "")
                .put("dateLabel", "2024-10-15")
            selectedRowsArr.put(rowObj)
        }

        val reviewJson = JSONObject()
            .put("reviewToken", "tok-500-full")
            .put("version", 3)
            .put("analysisRevision", 2)
            .put("viewRevision", "view-hash-full")
            .put("expiresInSec", 900)
            .put("summary", JSONObject()
                .put("selected", 500)
                .put("amountCents", 125250000L)
                .put("expenseCents", 100000000L)
                .put("incomeCents", 25250000L)
                .put("refundIncomeCents", 0L)
                .put("categoriesToCreate", JSONArray().put(JSONObject().put("name", "新类").put("type", 0).put("selectedRows", 10)))
                .put("categoriesToReuse", JSONArray().put(JSONObject().put("categoryId", "cat-exp").put("name", "日常支出").put("selectedRows", 490)))
                .put("files", JSONArray().put(JSONObject().put("fileName", "all.xlsx").put("selectedRows", 500)))
                .put("selectedRows", selectedRowsArr)
                .put("excluded", 12)
                .put("existing", 5)
                .put("conflicts", 0)
            )

        val resp = ReviewResponse.fromJson(reviewJson)
        assertEquals("tok-500-full", resp.reviewToken)
        assertEquals(3L, resp.version)
        assertEquals(2L, resp.analysisRevision)
        assertEquals(500, resp.summary.selected)
        assertEquals(125250000L, resp.summary.amountCents)
        assertEquals(100000000L, resp.summary.expenseCents)
        assertEquals(25250000L, resp.summary.incomeCents)
        assertEquals(1, resp.summary.categoriesToCreate.size)
        assertEquals("新类", resp.summary.categoriesToCreate[0].name)
        assertEquals(10, resp.summary.categoriesToCreate[0].selectedRows)
        assertEquals(1, resp.summary.categoriesToReuse.size)
        assertEquals("日常支出", resp.summary.categoriesToReuse[0].name)
        assertEquals(490, resp.summary.categoriesToReuse[0].selectedRows)
        assertEquals(1, resp.summary.files.size)
        assertEquals("all.xlsx", resp.summary.files[0].fileName)
        assertEquals(500, resp.summary.files[0].selectedRows)

        // Verify selectedRows size and entries
        assertEquals(500, resp.summary.selectedRows.size)
        val first = resp.summary.selectedRows[0]
        assertEquals("item-1", first.itemId)
        assertEquals(0, first.type)
        assertEquals(1000L, first.amountCents)
        assertEquals("", first.note) // empty note preserved
        assertEquals("2024-10-15", first.dateLabel)

        val second = resp.summary.selectedRows[1]
        assertEquals("item-2", second.itemId)
        assertEquals("备注-2", second.note)
    }

    // ── Cross-Layer Full Protocol Fixture Roundtrip ────────────────────────────

    @Test
    fun crossLayerCompleteBatchFixtureRoundtrip() {
        val batchJson = JSONObject("""
        {
            "batchId": "b-cross-1",
            "conversationId": "conv-1",
            "version": 4,
            "status": "ready",
            "viewRevision": "rev-view-cross",
            "files": [
                {
                    "fileIndex": 0,
                    "fileName": "statement.csv",
                    "source": "alipay",
                    "sizeBytes": 4096,
                    "sha256": "hash-sha-256",
                    "parseStatus": "ok",
                    "rawRowCount": 20,
                    "collectedRowCount": 18,
                    "error": null
                }
            ],
            "summary": {
                "totalItems": 18,
                "importable": 15,
                "existing": 2,
                "ignored": 1,
                "mergedGroups": 0,
                "conflictGroups": 0,
                "weakDuplicateGroups": 0,
                "expenseCents": 50000,
                "incomeCents": 10000,
                "dateFrom": "2024-10-01",
                "dateTo": "2024-10-15",
                "legacyLedgerMatches": 0,
                "unparsedFiles": 0,
                "notices": [
                    { "code": "notice_test", "itemId": "i-1", "detail": "测试提示" }
                ]
            },
            "analysis": {
                "state": "complete",
                "analysisRevision": 3,
                "analysed": 18,
                "providerCalls": 1,
                "suggestedNewCategories": 1,
                "message": null
            },
            "result": null
        }
        """.trimIndent())

        val batch = ImportBatch.fromJson(batchJson)
        assertEquals("b-cross-1", batch.batchId)
        assertEquals("conv-1", batch.conversationId)
        assertEquals(4L, batch.version)
        assertEquals("ready", batch.status)
        assertEquals("rev-view-cross", batch.viewRevision)
        assertEquals(1, batch.files.size)
        assertEquals("statement.csv", batch.files[0].fileName)
        assertEquals("ok", batch.files[0].parseStatus)
        assertEquals(20, batch.files[0].rawRowCount)
        assertEquals(18, batch.files[0].collectedRowCount)
        assertEquals(18, batch.summary.totalItems)
        assertEquals(1, batch.summary.notices.size)
        assertEquals("notice_test", batch.summary.notices[0].code)
        assertEquals("complete", batch.analysis.state)
        assertEquals(3L, batch.analysis.analysisRevision)
    }

    // ── Review Boundary Fix 1: Exact Strict Number Boundaries ──────────────────

    @Test
    fun exactStrictLongAndIntReaderBoundariesFailCloseOnOverflowAndFractions() {
        // Long.MAX_VALUE and Long.MIN_VALUE must succeed
        val validBoundaries = JSONObject()
            .put("itemId", "item-bound")
            .put("type", 0)
            .put("amountCents", Long.MAX_VALUE)
        val rowMax = ReviewSelectedRow.fromJson(validBoundaries)
        assertEquals(Long.MAX_VALUE, rowMax.amountCents)

        validBoundaries.put("amountCents", Long.MIN_VALUE)
        val rowMin = ReviewSelectedRow.fromJson(validBoundaries)
        assertEquals(Long.MIN_VALUE, rowMin.amountCents)

        // 2^63 (9223372036854775808) exceeds Long.MAX_VALUE -> must fail-close!
        val overflow2To63 = JSONObject()
            .put("itemId", "item-overflow")
            .put("type", 0)
            .put("amountCents", java.math.BigInteger("9223372036854775808"))
        try {
            ReviewSelectedRow.fromJson(overflow2To63)
            fail("Expected IllegalArgumentException for 2^63 overflow")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("amountCents"))
        }

        // 2^63 + 1
        val overflow2To63Plus1 = JSONObject()
            .put("itemId", "item-overflow")
            .put("type", 0)
            .put("amountCents", java.math.BigInteger("9223372036854775809"))
        try {
            ReviewSelectedRow.fromJson(overflow2To63Plus1)
            fail("Expected IllegalArgumentException for 2^63 + 1 overflow")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("amountCents"))
        }

        // -2^63 - 1
        val underflow2To63Minus1 = JSONObject()
            .put("itemId", "item-underflow")
            .put("type", 0)
            .put("amountCents", java.math.BigInteger("-9223372036854775809"))
        try {
            ReviewSelectedRow.fromJson(underflow2To63Minus1)
            fail("Expected IllegalArgumentException for underflow")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("amountCents"))
        }

        // Double representation of 2^63
        val double2To63 = JSONObject()
            .put("itemId", "item-d-overflow")
            .put("type", 0)
            .put("amountCents", 9223372036854775808.0)
        try {
            ReviewSelectedRow.fromJson(double2To63)
            fail("Expected IllegalArgumentException for Double 2^63 overflow")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("amountCents"))
        }

        // Double NaN and Infinities fail-close (rejected by JSONObject or strict reader)
        try {
            val nanJson = JSONObject().put("itemId", "i-nan").put("type", 0)
            nanJson.put("amountCents", Double.NaN)
            ReviewSelectedRow.fromJson(nanJson)
            fail("Expected exception for NaN")
        } catch (e: Exception) {
            assertTrue(e is IllegalArgumentException || e is org.json.JSONException)
        }

        try {
            val infJson = JSONObject().put("itemId", "i-inf").put("type", 0)
            infJson.put("amountCents", Double.POSITIVE_INFINITY)
            ReviewSelectedRow.fromJson(infJson)
            fail("Expected exception for POSITIVE_INFINITY")
        } catch (e: Exception) {
            assertTrue(e is IllegalArgumentException || e is org.json.JSONException)
        }

        try {
            val negInfJson = JSONObject().put("itemId", "i-ninf").put("type", 0)
            negInfJson.put("amountCents", Double.NEGATIVE_INFINITY)
            ReviewSelectedRow.fromJson(negInfJson)
            fail("Expected exception for NEGATIVE_INFINITY")
        } catch (e: Exception) {
            assertTrue(e is IllegalArgumentException || e is org.json.JSONException)
        }

        // Fractional fails-close
        val fracJson = JSONObject().put("itemId", "i-frac").put("type", 0).put("amountCents", 1234.56)
        try {
            ReviewSelectedRow.fromJson(fracJson)
            fail("Expected IllegalArgumentException for fractional value")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("amountCents"))
        }

        // String fails-close
        val stringJson = JSONObject().put("itemId", "i-str").put("type", 0).put("amountCents", "9999")
        try {
            ReviewSelectedRow.fromJson(stringJson)
            fail("Expected IllegalArgumentException for String value")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("amountCents"))
        }

        // Safe JS integer range (e.g. 53-bit values like 9007199254740991) parses without 32-bit truncation
        val safeJsMax = 9007199254740991L
        val safeJsJson = JSONObject().put("itemId", "i-js").put("type", 0).put("amountCents", safeJsMax)
        val safeJsRow = ReviewSelectedRow.fromJson(safeJsJson)
        assertEquals(safeJsMax, safeJsRow.amountCents)
        assertTrue(safeJsRow.amountCents > Int.MAX_VALUE.toLong())
    }

    // ── Review Boundary Fix 2: Server CategoryType & ApprovedNewCategoryName ───

    @Test
    fun reviewSelectedRowReadsServerCategoryTypeAndApprovedNewCategoryNameAndPreservesEmptyNote() {
        val rowJson = JSONObject()
            .put("itemId", "item-row-1")
            .put("type", 0)
            .put("amountCents", 2500)
            .put("categoryId", JSONObject.NULL)
            .put("categoryName", "潮玩手办")
            .put("categoryType", 0)
            .put("suggestionId", "sug-toys")
            .put("approvedNewCategoryName", "潮玩手办")
            .put("note", "") // empty string note from server
            .put("dateLabel", "2024-10-16")

        val row = ReviewSelectedRow.fromJson(rowJson)
        assertEquals("item-row-1", row.itemId)
        assertEquals(0, row.type)
        assertEquals(2500L, row.amountCents)
        assertNull(row.categoryId)
        assertEquals("潮玩手办", row.categoryName)
        assertEquals(0, row.categoryType) // 支出分类
        assertEquals("潮玩手办", row.approvedNewCategoryName)
        assertEquals("", row.note) // exact empty string preserved, not null
        assertEquals("2024-10-16", row.dateLabel)

        // Reuse category row
        val reuseJson = JSONObject()
            .put("itemId", "item-row-2")
            .put("type", 1)
            .put("amountCents", 8000)
            .put("categoryId", "cat-salary")
            .put("categoryName", "工资")
            .put("categoryType", 1) // 收入分类
            .put("suggestionId", JSONObject.NULL)
            .put("approvedNewCategoryName", JSONObject.NULL)
            .put("note", "十月工资")

        val reuseRow = ReviewSelectedRow.fromJson(reuseJson)
        assertEquals("item-row-2", reuseRow.itemId)
        assertEquals(1, reuseRow.type)
        assertEquals("cat-salary", reuseRow.categoryId)
        assertEquals("工资", reuseRow.categoryName)
        assertEquals(1, reuseRow.categoryType)
        assertNull(reuseRow.approvedNewCategoryName)
        assertEquals("十月工资", reuseRow.note)
    }

    // ── Review Boundary Fix 3: ReviewSummary.counts Typed & Nullable Handling ──

    @Test
    fun reviewSummaryDecodesTypedCountsWithNullableUserExcludedAndPreservesServerAmounts() {
        val summaryJson = JSONObject("""
        {
            "selected": 15,
            "amountCents": 150000,
            "expenseCents": 120000,
            "incomeCents": 30000,
            "refundIncomeCents": 5000,
            "categoriesToCreate": [
                { "name": "潮玩", "type": 0, "selectedRows": 3 }
            ],
            "categoriesToReuse": [
                { "categoryId": "c-food", "name": "餐饮", "selectedRows": 12 }
            ],
            "files": [
                { "fileName": "alipay.csv", "selectedRows": 15 }
            ],
            "selectedRows": [],
            "excluded": 5,
            "existing": 2,
            "conflicts": 1,
            "counts": {
                "total": 20,
                "selected": 15,
                "notSelected": 5,
                "preexisting": 2,
                "ruleIgnored": 4,
                "conflictRows": 1,
                "userExcluded": null
            }
        }
        """.trimIndent())

        val summary = ReviewSummary.fromJson(summaryJson)
        assertEquals(15, summary.selected)
        assertEquals(150000L, summary.amountCents)
        assertEquals(120000L, summary.expenseCents)
        assertEquals(30000L, summary.incomeCents)
        assertEquals(5000L, summary.refundIncomeCents)
        assertEquals(1, summary.categoriesToCreate.size)
        assertEquals("潮玩", summary.categoriesToCreate[0].name)
        assertEquals(0, summary.categoriesToCreate[0].type)
        assertEquals(3, summary.categoriesToCreate[0].selectedRows)
        assertEquals(1, summary.categoriesToReuse.size)
        assertEquals("餐饮", summary.categoriesToReuse[0].name)
        assertEquals(12, summary.categoriesToReuse[0].selectedRows)

        // Counts must be typed and userExcluded must be null (not 0)
        assertNotNull(summary.counts)
        val c = summary.counts!!
        assertEquals(20, c.total)
        assertEquals(15, c.selected)
        assertEquals(5, c.notSelected)
        assertEquals(2, c.preexisting)
        assertEquals(4, c.ruleIgnored) // distinct from userExcluded
        assertEquals(1, c.conflictRows)
        assertNull(c.userExcluded) // server wire explicitly sends null; must NOT default to 0!
    }

    // ── Review Boundary Fix 5: Strict Non-Empty ViewRevision On All GET DTOs ───

    @Test
    fun strictViewRevisionRejectsBlankOrMissingAcrossAllGetDtoTypes() {
        // 1. ImportBatch requires non-empty viewRevision
        val batchMissingRev = JSONObject("""
        {
            "batchId": "b-test",
            "version": 1,
            "status": "ready"
        }
        """.trimIndent())
        try {
            ImportBatch.fromJson(batchMissingRev)
            fail("Expected IllegalArgumentException for missing viewRevision on ImportBatch")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("viewRevision"))
        }

        val batchBlankRev = JSONObject("""
        {
            "batchId": "b-test",
            "version": 1,
            "status": "ready",
            "viewRevision": "   "
        }
        """.trimIndent())
        try {
            ImportBatch.fromJson(batchBlankRev)
            fail("Expected IllegalArgumentException for blank viewRevision on ImportBatch")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("viewRevision"))
        }

        // 2. ImportBatchRowsPage requires non-empty viewRevision
        val pageMissingRev = JSONObject("""
        {
            "batchId": "b-test",
            "version": 1,
            "total": 0,
            "readAt": 1000
        }
        """.trimIndent())
        try {
            ImportBatchRowsPage.fromJson(pageMissingRev)
            fail("Expected IllegalArgumentException for missing viewRevision on ImportBatchRowsPage")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("viewRevision"))
        }

        val pageBlankRev = JSONObject("""
        {
            "batchId": "b-test",
            "version": 1,
            "viewRevision": "",
            "total": 0,
            "readAt": 1000
        }
        """.trimIndent())
        try {
            ImportBatchRowsPage.fromJson(pageBlankRev)
            fail("Expected IllegalArgumentException for blank viewRevision on ImportBatchRowsPage")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("viewRevision"))
        }

        // 3. ImportBatchCategoriesResponse requires non-empty viewRevision
        val catsMissingRev = JSONObject("""
        {
            "batchId": "b-test",
            "version": 1
        }
        """.trimIndent())
        try {
            ImportBatchCategoriesResponse.fromJson(catsMissingRev)
            fail("Expected IllegalArgumentException for missing viewRevision on ImportBatchCategoriesResponse")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("viewRevision"))
        }

        // 4. ReviewResponse requires non-empty viewRevision
        val reviewBlankRev = JSONObject("""
        {
            "reviewToken": "tok-x",
            "version": 1,
            "viewRevision": "   ",
            "expiresInSec": 900,
            "summary": { "selected": 0, "amountCents": 0, "expenseCents": 0, "incomeCents": 0 }
        }
        """.trimIndent())
        try {
            ReviewResponse.fromJson(reviewBlankRev)
            fail("Expected IllegalArgumentException for blank viewRevision on ReviewResponse")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("viewRevision"))
        }
    }

    // ── Real Server Wire Fixture Production Decoders Regression Tests ─────────

    private fun loadFixture(path: String): String {
        val stream = javaClass.classLoader?.getResourceAsStream(path)
            ?: javaClass.getResourceAsStream("/$path")
            ?: throw IllegalStateException("Test fixture resource not found: $path")
        return stream.bufferedReader().use { it.readText() }
    }

    @Test
    fun realServerWireResponsesDecodedByProductionDecodersConsistentWithViewRevisionAndCatalog() {
        // Source SHA-256 and token redaction documented in test resource manifest.json.
        // Safe synthetic fixtures generated via Fastify app.inject against repository wechat-bill-sample.csv; no cookie/key.
        val manifest = JSONObject(loadFixture("fixtures/import/manifest.json"))
        assertEquals(0, manifest.getInt("providerCalls"))
        assertEquals(34, manifest.getInt("rowsExported"))
        assertEquals(2, manifest.getInt("selectedRows"))
        assertTrue(manifest.getString("reviewTokenRedaction").contains("<SYNTHETIC_REDACTED_REVIEW_TOKEN>"))

        // 1. Production decoder for batch.json
        val batchJson = JSONObject(loadFixture("fixtures/import/batch.json"))
        val batch = ImportBatch.fromJson(batchJson)
        assertTrue("Batch ID must be non-empty string", batch.batchId.isNotBlank())
        assertEquals("prepared", batch.status)
        assertEquals(1L, batch.version)
        val expectedRevision = batch.viewRevision
        assertTrue("Expected non-blank viewRevision", expectedRevision.isNotBlank())
        assertEquals(34, batch.summary.totalItems)
        assertEquals(8, batch.summary.ignored)
        assertEquals(1, batch.files.size)
        assertEquals("synthetic-wechat.csv", batch.files[0].fileName)

        // 2. Production decoder for rows.json
        // Note: rows.json is the combined pages collection of all 34 rows from GET /rows.
        val rowsJson = JSONObject(loadFixture("fixtures/import/rows.json"))
        assertEquals(batch.batchId, rowsJson.getString("batchId"))
        assertEquals(expectedRevision, rowsJson.getString("viewRevision"))
        assertEquals(34, rowsJson.getInt("total"))
        val itemsArr = rowsJson.getJSONArray("items")
        assertEquals(34, itemsArr.length())
        val rows = (0 until itemsArr.length()).map { i ->
            ImportBatchRow.fromJson(itemsArr.getJSONObject(i))
        }
        assertEquals(34, rows.size)

        // Verify full 34 rows integrity across all items (not only the first item)
        rows.forEachIndexed { index, row ->
            assertTrue("Row $index itemId must be non-blank", row.itemId.isNotBlank())
            assertEquals("Row $index ordinal must match sequence", index, row.ordinal)
            assertTrue(
                "Row $index identityKind must be valid server identity",
                row.identityKind == "platform_order" || row.identityKind == "occurrence"
            )
            assertTrue("Row $index amountCents must be positive", row.amountCents > 0)
            assertTrue("Row $index type must be 0 or 1", row.type == 0 || row.type == 1)
            assertTrue("Row $index dateLabel must be non-blank", row.dateLabel.isNotBlank())
            assertNotNull("Row $index fallback must be present", row.fallback)
            assertNotNull("Row $index ai must be present", row.ai)
        }

        // Specific assertions on first and last row
        val firstRow = rows[0]
        assertEquals("po:wechat:07264ee30c7414e6bb5876e8d0ecfb1f", firstRow.itemId)
        assertEquals("platform_order", firstRow.identityKind)
        assertTrue(firstRow.ignored)
        assertEquals("中性交易", firstRow.ignoreReason)
        assertEquals("其他", firstRow.fallback?.categoryName)
        assertEquals("server-fallback", firstRow.fallback?.source)
        assertEquals("nc-fallback-0-1", firstRow.fallback?.newOtherSuggestionId)
        assertEquals("none", firstRow.ai?.status)
        assertNull(firstRow.ai?.include)
        assertEquals("", firstRow.ai?.reason)

        val lastRow = rows[33]
        assertEquals("po:wechat:7c3968b5588827812d4f0826c40113c2", lastRow.itemId)
        assertEquals("platform_order", lastRow.identityKind)
        assertEquals(33, lastRow.ordinal)
        assertFalse(lastRow.ignored)
        assertEquals("罗文 (stylish)", lastRow.note)
        assertEquals("builtin-income-other", lastRow.fallback?.effectiveExistingId)

        val ignoredRows = rows.filter { it.ignored }
        assertEquals(8, ignoredRows.size)

        // 3. Production decoder for categories.json
        val catsJson = JSONObject(loadFixture("fixtures/import/categories.json"))
        val categories = ImportBatchCategoriesResponse.fromJson(catsJson)
        assertEquals(batch.batchId, categories.batchId)
        assertEquals(expectedRevision, categories.viewRevision)
        // Catalog available
        assertTrue("Active categories catalog must be available", categories.categories.isNotEmpty())
        assertEquals(8, categories.categories.size)
        assertTrue(categories.categories.any { it.id == "builtin-expense-food" && it.name == "餐饮" && it.type == 0 })
        assertTrue(categories.categories.any { it.id == "builtin-income-other" && it.name == "其他收入" && it.type == 1 })
        assertTrue("Category suggestions must contain fallback suggestion", categories.items.isNotEmpty())
        val fallbackSuggestion = categories.items.first { it.origin == "server-fallback" }
        assertEquals("nc-fallback-0-1", fallbackSuggestion.suggestionId)
        assertEquals("其他", fallbackSuggestion.name)
        assertEquals(0, fallbackSuggestion.type)
    }

    @Test
    fun realServerWireReviewResponseDecodedWithSelectedRowsAndCounts() {
        // Safe synthetic review response with redacted reviewToken; no secrets/cookie/auth header.
        val reviewJson = JSONObject(loadFixture("fixtures/import/review.json"))
        val review = ReviewResponse.fromJson(reviewJson)

        assertEquals("<SYNTHETIC_REDACTED_REVIEW_TOKEN>", review.reviewToken)
        assertTrue("Review viewRevision must be non-empty", review.viewRevision.isNotBlank())
        assertEquals(900L, review.expiresInSec)

        // Review summary & selected rows
        assertEquals(2, review.summary.selected)
        assertEquals(2, review.summary.selectedRows.size)

        // Row 1: Existing category fallback
        val existingRow = review.summary.selectedRows.first { it.categoryId != null }
        assertEquals("builtin-income-other", existingRow.categoryId)
        assertEquals("其他收入", existingRow.categoryName)
        assertEquals(1, existingRow.categoryType)
        assertNull(existingRow.approvedNewCategoryName)
        assertNull(existingRow.suggestionId)
        assertEquals("罗文 (stylish)", existingRow.note)

        // Row 2: Server-fallback new Other category with explicit empty string note
        val newOtherRow = review.summary.selectedRows.first { it.suggestionId != null }
        assertNull(newOtherRow.categoryId)
        assertEquals("nc-fallback-0-1", newOtherRow.suggestionId)
        assertEquals("其他", newOtherRow.categoryName)
        assertEquals(0, newOtherRow.categoryType)
        assertEquals("其他", newOtherRow.approvedNewCategoryName)
        assertEquals("", newOtherRow.note) // explicit note ''

        // Categories to create
        assertEquals(1, review.summary.categoriesToCreate.size)
        val catToCreate = review.summary.categoriesToCreate[0]
        assertEquals("其他", catToCreate.name)
        assertEquals(0, catToCreate.type)
        assertEquals(1, catToCreate.selectedRows)

        // Counts: userExcluded is null, ruleIgnored is 8
        val counts = review.summary.counts
        assertNotNull("counts block must be present", counts)
        assertEquals(34, counts!!.total)
        assertEquals(2, counts.selected)
        assertEquals(8, counts.ruleIgnored)
        assertNull("counts.userExcluded must be null", counts.userExcluded)
    }

    @Test
    fun canTriggerOptionalAiAnalysisPredicateRules() {
        // idle and originals present -> true
        assertTrue(canTriggerOptionalAiAnalysis("idle", "parsed", hasMemoryFiles = true, providerEnabled = true))
        // failed and originals present -> true (allows retry)
        assertTrue(canTriggerOptionalAiAnalysis("failed", "parsed", hasMemoryFiles = true, providerEnabled = true))

        // running -> false (already executing, must not trigger new analyse call)
        assertFalse(canTriggerOptionalAiAnalysis("running", "parsed", hasMemoryFiles = true, providerEnabled = true))

        // no originals in memory -> false
        assertFalse(canTriggerOptionalAiAnalysis("idle", "parsed", hasMemoryFiles = false, providerEnabled = true))

        // provider disabled -> false
        assertFalse(canTriggerOptionalAiAnalysis("idle", "parsed", hasMemoryFiles = true, providerEnabled = false))

        // batch already confirmed or closed -> false
        assertFalse(canTriggerOptionalAiAnalysis("idle", "confirmed", hasMemoryFiles = true, providerEnabled = true))
        assertFalse(canTriggerOptionalAiAnalysis("idle", "closed", hasMemoryFiles = true, providerEnabled = true))
    }

    @Test
    fun platformImportOwnerKeyAndWorkspaceRefEquality() {
        val scopeA = FinancialScope("https://jz.example.com", "alice")
        val scopeB = FinancialScope("https://jz.example.com", "bob")
        val identityA1 = ApiRequestIdentity("https://jz.example.com", 1L)
        val identityA2 = ApiRequestIdentity("https://jz.example.com", 2L)

        val ownerA1 = PlatformImportOwnerKey(
            scope = scopeA,
            identity = identityA1,
            source = PlatformImportSource.ASSISTANT,
            entryConversationId = "conv-1",
        )

        val workspaceRef = PlatformImportWorkspaceRef(
            owner = ownerA1,
            conversationId = "conv-1",
            batchId = "batch-100",
        )

        // Same owner matches
        assertTrue(workspaceRef.isCurrentFor(ownerA1))

        // Different conversation matches neither
        val ownerDifferentConv = ownerA1.copy(entryConversationId = "conv-2")
        assertFalse(workspaceRef.isCurrentFor(ownerDifferentConv))

        // A->B->A generation advance rejects old workspace ref
        val ownerA2 = ownerA1.copy(identity = identityA2)
        assertFalse(workspaceRef.isCurrentFor(ownerA2))

        // Different user scope rejects old workspace ref
        val ownerB = ownerA1.copy(scope = scopeB)
        assertFalse(workspaceRef.isCurrentFor(ownerB))
    }
}
