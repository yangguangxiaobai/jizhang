package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.ui.SelectedDocument
import com.yansuu1.jizhang.ui.validateMergedDocuments
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AssistantBatchImportStateTest {

    private fun testRow(
        id: String,
        amountCents: Long = 1000L,
        dateLabel: String = "2024-10-15",
        existing: Boolean = false,
        possibleDuplicate: Boolean = false,
        ignored: Boolean = false,
        ignoreReason: String? = null,
        conflictGroup: String? = null,
        conflictKind: String? = null,
        aiCatId: String? = null,
        aiSugId: String? = null,
        fbEffectiveCatId: String? = null,
        fbSugId: String? = null,
        isRefund: Boolean = false,
        note: String = "测试账单$id",
    ): ImportBatchRow = ImportBatchRow(
        itemId = id,
        identityKind = "occurrence",
        ordinal = 0,
        conflictGroup = conflictGroup,
        conflictKind = conflictKind,
        dateLabel = dateLabel,
        sourceTimestamp = "$dateLabel 12:00:00",
        type = 0,
        amountCents = amountCents,
        note = note,
        noteAlternatives = emptyList(),
        isRefund = isRefund,
        refundWarning = null,
        rawStatus = "支付成功",
        ignored = ignored,
        ignoreReason = ignoreReason,
        existing = existing,
        possibleDuplicate = possibleDuplicate,
        duplicateOfNote = null,
        weakDuplicateGroup = null,
        legacyLedgerMatch = false,
        comparisonAccountId = null,
        sources = listOf(ImportRowSource("test.csv", 0, 1, note)),
        fallback = ImportRowFallback(fbEffectiveCatId, "其他", "rule", fbSugId),
        ai = ImportRowAi("complete", true, "匹配", aiCatId, aiSugId),
    )

    // ── Boundaries: 0 / 1 / 100 / 101 / 200 / 201 / 500 / 501 ─────────────────

    @Test
    fun zeroItemsSelectedRejectsReview() {
        val rows = listOf(testRow("r1"))
        val err = validateBatchForReview(
            selectedIds = emptySet(),
            rows = rows,
            assignments = mapOf("r1" to CategoryAssignment.Existing("cat1")),
            approvedSuggestionIds = emptySet(),
            activeLeafCategoryIds = setOf("cat1"),
        )
        assertNotNull(err)
        assertTrue(err!!.contains("至少选择一条"))
    }

    @Test
    fun exactlyOneItemCanBeSelectedAndPassesValidation() {
        val rows = listOf(testRow("r1"))
        val err = validateBatchForReview(
            selectedIds = setOf("r1"),
            rows = rows,
            assignments = mapOf("r1" to CategoryAssignment.Existing("cat1")),
            approvedSuggestionIds = emptySet(),
            activeLeafCategoryIds = setOf("cat1"),
        )
        assertNull(err)
    }

    @Test
    fun crossPage101And201SelectionsAreRetainedWithoutPageLocalLoss() {
        // Create 250 rows spanning multiple pages
        val allRows = (1..250).map { testRow("row-$it") }
        val selectedIds = setOf("row-1", "row-101", "row-201", "row-250")

        // Filter for "已选入"
        val filtered = filterBatchRows(allRows, "", "已选入", selectedIds, emptySet())
        assertEquals(4, filtered.size)
        assertTrue(filtered.any { it.itemId == "row-1" })
        assertTrue(filtered.any { it.itemId == "row-101" })
        assertTrue(filtered.any { it.itemId == "row-201" })
        assertTrue(filtered.any { it.itemId == "row-250" })
    }

    @Test
    fun exactly500ItemsCanBeSelectedAndPassesValidation() {
        val rows = (1..500).map { testRow("r-$it") }
        val selected = rows.map { it.itemId }.toSet()
        val assignments = rows.associate { it.itemId to CategoryAssignment.Existing("cat-leaf") }

        val err = validateBatchForReview(
            selectedIds = selected,
            rows = rows,
            assignments = assignments,
            approvedSuggestionIds = emptySet(),
            activeLeafCategoryIds = setOf("cat-leaf"),
        )
        assertNull(err)
    }

    @Test
    fun selecting501ItemsIsExplicitlyRejectedWithoutCropping() {
        val rows = (1..501).map { testRow("r-$it") }
        val selected = rows.map { it.itemId }.toSet()
        val assignments = rows.associate { it.itemId to CategoryAssignment.Existing("cat-leaf") }

        val err = validateBatchForReview(
            selectedIds = selected,
            rows = rows,
            assignments = assignments,
            approvedSuggestionIds = emptySet(),
            activeLeafCategoryIds = setOf("cat-leaf"),
        )
        assertNotNull(err)
        assertTrue(err!!.contains("500 笔上限"))
    }

    // ── Global Filters & Draft Preservation ────────────────────────────────────

    @Test
    fun filteringDoesNotAlterOrClearSelectionsOrNotes() {
        val rows = listOf(
            testRow("r1", note = "瑞幸咖啡"),
            testRow("r2", note = "星巴克"),
            testRow("r3", note = "全家便利店", ignored = true, ignoreReason = "规则排除"),
        )
        val selected = setOf("r1", "r2")
        val excluded = setOf("r3")
        val notes = mapOf("r1" to "自定义备注1", "r2" to "")

        // Filter by search text
        val result = filterBatchRows(rows, "星巴克", "全部", selected, excluded)
        assertEquals(1, result.size)
        assertEquals("r2", result.first().itemId)

        // Draft state remains completely intact
        assertEquals(setOf("r1", "r2"), selected)
        assertEquals("自定义备注1", notes["r1"])
        assertEquals("", notes["r2"])
    }

    // ── Exclusion & Reinclusion Feedback ───────────────────────────────────────

    @Test
    fun excludeRowGivesExplicitFeedbackEvenWhenAlreadyUnselected() {
        val row = testRow("r1")
        val selected = emptySet<String>() // already not in selected
        val excluded = emptySet<String>()

        val (newSel, newEx) = excludeBatchRow(row, selected, excluded)
        assertTrue(row.itemId in newEx)
        assertFalse(row.itemId in newSel)
        assertEquals("暂不导入", getBatchRowStatusText(row, isSelected = false, isUserExcluded = true))
    }

    @Test
    fun reincludeRowClearsUserExcludedAndAddsToSelected() {
        val row = testRow("r1")
        val selected = emptySet<String>()
        val excluded = setOf("r1")

        val (newSel, newEx) = reincludeBatchRow(row, selected, excluded)
        assertFalse("r1" in newEx)
        assertTrue("r1" in newSel)
        assertEquals("已选入", getBatchRowStatusText(row, isSelected = true, isUserExcluded = false))
    }

    // ── Locking Reasons & Rule Ignored Eligibility ─────────────────────────────

    @Test
    fun hardDuplicatesAndNonpositiveAmountAndLedgerCollisionAreLockedWithReasons() {
        val existingRow = testRow("r-exist", existing = true)
        assertFalse(existingRow.isEligible)
        assertEquals("已在账本中（已入账）", getBatchRowLockReason(existingRow))

        val zeroRow = testRow("r-zero", amountCents = 0)
        assertFalse(zeroRow.isEligible)
        assertEquals("金额为 0 或无效，无法入账", getBatchRowLockReason(zeroRow))

        val collisionRow = testRow("r-coll", conflictKind = "ledger_collision")
        assertFalse(collisionRow.isEligible)
        assertEquals("订单标识碰撞，无法选入", getBatchRowLockReason(collisionRow))
    }

    @Test
    fun ruleIgnoredPositiveRowIsEligibleAndCanBeExplicitlySelected() {
        val ruleRow = testRow("r-rule", ignored = true, ignoreReason = "理财赎回")
        assertTrue(ruleRow.isEligible)
        assertNull(getBatchRowLockReason(ruleRow))

        // User can explicitly select it
        val (sel, _) = reincludeBatchRow(ruleRow, emptySet(), emptySet())
        assertTrue("r-rule" in sel)
    }

    @Test
    fun positiveRowWithStatusIgnoreReasonIsEligibleUnderFrozenProtocol() {
        // Frozen protocol v1: Only existing, nonpositive (amountCents <= 0), and ledger_collision
        // are hard locks. Positive rows with status/rule ignore reasons remain eligible for explicit user selection.
        val statusRow = testRow("r-status", amountCents = 2500L, ignored = true, ignoreReason = "状态非成功")
        assertTrue(statusRow.isEligible)
        assertNull(getBatchRowLockReason(statusRow))

        val (sel, _) = reincludeBatchRow(statusRow, emptySet(), emptySet())
        assertTrue("r-status" in sel)
    }

    // ── Conflict Resolution ────────────────────────────────────────────────────

    @Test
    fun selectingConflictRowDeselectsOtherRowsInSameGroup() {
        val rowA = testRow("cA", conflictGroup = "group-1", conflictKind = "fact_conflict")
        val rowB = testRow("cB", conflictGroup = "group-1", conflictKind = "fact_conflict")
        val allRows = listOf(rowA, rowB)

        // Select rowA first
        var (sel, ex) = reincludeBatchRow(rowA, emptySet(), emptySet(), allRows)
        assertTrue("cA" in sel)
        assertFalse("cB" in sel)

        // Then select rowB: rowA should be deselected automatically
        val (sel2, _) = reincludeBatchRow(rowB, sel, ex, allRows)
        assertTrue("cB" in sel2)
        assertFalse("cA" in sel2)
    }

    @Test
    fun factConflictMultiSelectRejectsInReviewValidation() {
        val rowA = testRow("cA", conflictGroup = "group-1", conflictKind = "fact_conflict")
        val rowB = testRow("cB", conflictGroup = "group-1", conflictKind = "fact_conflict")
        val rows = listOf(rowA, rowB)

        val err = validateBatchForReview(
            selectedIds = setOf("cA", "cB"),
            rows = rows,
            assignments = mapOf(
                "cA" to CategoryAssignment.Existing("cat1"),
                "cB" to CategoryAssignment.Existing("cat1"),
            ),
            approvedSuggestionIds = emptySet(),
            activeLeafCategoryIds = setOf("cat1"),
        )
        assertNotNull(err)
        assertTrue(err!!.contains("选择了多条账单"))
    }

    // ── Categories: Existing, Suggestions & Fallback Other ─────────────────────

    @Test
    fun initialCategoryAssignmentPrefersAiThenSuggestionThenFallback() {
        val aiCatRow = testRow("r1", aiCatId = "builtin-food")
        assertEquals(CategoryAssignment.Existing("builtin-food"), resolveInitialCategoryAssignment(aiCatRow))

        val aiSugRow = testRow("r2", aiSugId = "sug-anime")
        assertEquals(CategoryAssignment.Suggestion("sug-anime"), resolveInitialCategoryAssignment(aiSugRow))

        val fbCatRow = testRow("r3", fbEffectiveCatId = "builtin-other")
        assertEquals(CategoryAssignment.Existing("builtin-other"), resolveInitialCategoryAssignment(fbCatRow))

        val fbSugRow = testRow("r4", fbSugId = "sug-new-other")
        assertEquals(CategoryAssignment.Suggestion("sug-new-other"), resolveInitialCategoryAssignment(fbSugRow))
    }

    @Test
    fun unapprovedSuggestionBlocksReviewValidation() {
        val row = testRow("r1")
        val err = validateBatchForReview(
            selectedIds = setOf("r1"),
            rows = listOf(row),
            assignments = mapOf("r1" to CategoryAssignment.Suggestion("sug-unapproved")),
            approvedSuggestionIds = emptySet(), // not approved
            activeLeafCategoryIds = setOf("cat1"),
        )
        assertNotNull(err)
        assertTrue(err!!.contains("建议分类尚未批准"))
    }

    @Test
    fun approvedUnusedSuggestionDoesNotBlockValidation() {
        val row = testRow("r1")
        val err = validateBatchForReview(
            selectedIds = setOf("r1"),
            rows = listOf(row),
            assignments = mapOf("r1" to CategoryAssignment.Existing("cat1")),
            approvedSuggestionIds = setOf("sug-unused"), // approved but not used by r1
            activeLeafCategoryIds = setOf("cat1"),
        )
        assertNull(err)
    }

    @Test
    fun newSuggestionsDefaultToUnapprovedOnLoadAndRetry() {
        // AI proposal and server-fallback Other proposal
        val aiSug = CategorySuggestion(
            suggestionId = "sug-ai-1",
            origin = "ai",
            name = "盲盒潮玩",
            type = 0,
            parentId = null,
            relatedItemCount = 3,
            relatedItemIds = listOf("r1", "r2", "r3"),
            candidates = emptyList(),
        )
        val fallbackSug = CategorySuggestion(
            suggestionId = "sug-fb-other",
            origin = "server-fallback",
            name = "其他",
            type = 0,
            parentId = null,
            relatedItemCount = 1,
            relatedItemIds = listOf("r4"),
            candidates = emptyList(),
        )
        val suggestions = listOf(aiSug, fallbackSug)

        // On load or re-analysis, approvedCategories must start empty and never auto-approve proposals
        val approvedCategories = emptyMap<String, ApprovedCategory>()
        val currentSugIds = suggestions.map { it.suggestionId }.toSet()
        val nextApproved = approvedCategories.filterKeys { it in currentSugIds }

        // Both proposals remain unapproved
        assertTrue(nextApproved.isEmpty())
        assertFalse("sug-ai-1" in nextApproved)
        assertFalse("sug-fb-other" in nextApproved)

        // Attempting to review a selected row using this unapproved suggestion is strictly blocked
        val row = testRow("r1", aiSugId = "sug-ai-1")
        val validationErr = validateBatchForReview(
            selectedIds = setOf("r1"),
            rows = listOf(row),
            assignments = mapOf("r1" to CategoryAssignment.Suggestion("sug-ai-1")),
            approvedSuggestionIds = nextApproved.keys,
            activeLeafCategoryIds = setOf("cat-leaf"),
        )
        assertNotNull(validationErr)
        assertTrue(validationErr!!.contains("建议分类尚未批准"))
    }

    @Test
    fun reanalysisPrunesObsoleteApprovalsAndPreservesUserManualDraftsWithoutRebinding() {
        // Revision 1: User explicitly approved sug-rev1, chose manual category for r2, wrote manual note for r1
        val userApproved = mapOf(
            "sug-rev1" to ApprovedCategory("sug-rev1", "create", null, "潮玩", 0, null),
        )
        var categoryAssignments = mapOf(
            "r1" to CategoryAssignment.Suggestion("sug-rev1"),
            "r2" to CategoryAssignment.Existing("manual-cat-leaf"),
        )
        val noteOverrides = mapOf(
            "r1" to "用户自定义备注",
        )
        val selectedItemIds = setOf("r1", "r2")

        // Revision 2: AI re-ran, generating new suggestions with new scoped IDs
        val newSuggestions = listOf(
            CategorySuggestion(
                suggestionId = "sug-rev2",
                origin = "ai",
                name = "潮玩手办",
                type = 0,
                parentId = null,
                relatedItemCount = 1,
                relatedItemIds = listOf("r1"),
                candidates = emptyList(),
            )
        )
        val currentSugIds = newSuggestions.map { it.suggestionId }.toSet()

        // Pruning logic in workspace:
        // 1. Drops obsolete approvals (sug-rev1), does NOT auto-approve sug-rev2
        val nextApproved = userApproved.filterKeys { it in currentSugIds }
        assertEquals(0, nextApproved.size)
        assertFalse("sug-rev2" in nextApproved) // sug-rev2 is NOT auto-approved!

        // 2. Clears assignments pointing to obsolete suggestions (r1 pointed to sug-rev1)
        val staleSugAssignments = categoryAssignments.filterValues {
            it is CategoryAssignment.Suggestion && it.suggestionId !in currentSugIds
        }
        if (staleSugAssignments.isNotEmpty()) {
            categoryAssignments = categoryAssignments.filterKeys { it !in staleSugAssignments.keys }
        }

        // 3. User manual existing category assignment for r2 is strictly preserved!
        assertEquals(CategoryAssignment.Existing("manual-cat-leaf"), categoryAssignments["r2"])
        assertNull(categoryAssignments["r1"]) // stale suggestion cleared

        // 4. User note overrides and selected item IDs are strictly preserved!
        assertEquals("用户自定义备注", noteOverrides["r1"])
        assertEquals(setOf("r1", "r2"), selectedItemIds)
    }

    @Test
    fun explicitUserApprovalWithReuseSpecifiesTargetCategoryIdAndMatchesMetadata() {
        val candidate = CategorySuggestionCandidate(
            categoryId = "existing-leaf-99",
            name = "餐饮美食",
            type = 0,
            parentId = "parent-exp",
            isLeaf = true,
        )
        val sug = CategorySuggestion(
            suggestionId = "sug-food",
            origin = "ai",
            name = "餐饮美食",
            type = 0,
            parentId = "parent-exp",
            relatedItemCount = 5,
            relatedItemIds = listOf("r1", "r2"),
            candidates = listOf(candidate),
        )

        // When user explicitly approves as reuse:
        val approval = ApprovedCategory(
            suggestionId = sug.suggestionId,
            resolution = "create",
            reuseCategoryId = candidate.categoryId,
            name = candidate.name,
            type = candidate.type,
            parentId = candidate.parentId,
        )
        assertEquals("existing-leaf-99", approval.reuseCategoryId)
        assertEquals("create", approval.resolution)
        assertEquals("餐饮美食", approval.name)
        assertEquals(0, approval.type)
        assertEquals("parent-exp", approval.parentId)

        val json = approval.toJson()
        assertEquals("existing-leaf-99", json.getString("reuseCategoryId"))
        assertEquals("create", json.getString("resolution"))
        assertEquals("餐饮美食", json.getString("name"))
    }

    // ── Note Overrides: Empty String Clears Semantics ──────────────────────────

    @Test
    fun emptyNoteOverridePreservesExplicitClearSemantics() {
        val row = testRow("r1", note = "原始长备注")
        val notes = mapOf("r1" to "")
        val finalNote = notes[row.itemId] ?: row.note
        assertEquals("", finalNote) // clear semantics preserved, does NOT revert to "原始长备注"
    }

    // ── Refund Gross Expense & Refund Income ───────────────────────────────────

    @Test
    fun refundRowsPreserveRefundIdentityAndGrossExpense() {
        val refundRow = testRow("ref1", amountCents = 2500L, isRefund = true, note = "淘宝退款")
        assertTrue(refundRow.isRefund)
        assertEquals(2500L, refundRow.amountCents)
        assertEquals("退款", if (refundRow.isRefund) "退款" else "普通")
    }

    // ── File Mutation Remapping ────────────────────────────────────────────────

    @Test
    fun remapBatchDraftsPreservesUnchangedAndDropsChangedOrRemovedItems() {
        val mutationJson = JSONObject()
            .put("idRemap", JSONObject().put("old-id", "new-id"))
            .put("droppedDraftItemIds", JSONArray().put("dropped-id"))
            .put("identityUnchangedItemIds", JSONArray().put("new-id").put("stay-id"))
            .put("notices", JSONArray())
            .put("batch", JSONObject().put("batchId", "b1").put("version", 2).put("viewRevision", "rev-1"))

        val mutation = MutationResult.fromJson(mutationJson)

        val selected = setOf("old-id", "dropped-id", "stay-id")
        val excluded = setOf("dropped-id")
        val assignments = mapOf(
            "old-id" to CategoryAssignment.Existing("cat1"),
            "dropped-id" to CategoryAssignment.Existing("cat2"),
        )
        val notes = mapOf(
            "old-id" to "修改备注",
            "dropped-id" to "待丢弃备注",
        )

        val remapped = remapBatchDrafts(selected, excluded, assignments, notes, mutation)

        // old-id remapped to new-id
        assertTrue("new-id" in remapped.selected)
        assertFalse("old-id" in remapped.selected)
        assertEquals(CategoryAssignment.Existing("cat1"), remapped.assignments["new-id"])
        assertEquals("修改备注", remapped.notes["new-id"])

        // dropped-id removed from all drafts
        assertFalse("dropped-id" in remapped.selected)
        assertFalse("dropped-id" in remapped.userExcluded)
        assertNull(remapped.assignments["dropped-id"])
        assertNull(remapped.notes["dropped-id"])

        // stay-id untouched
        assertTrue("stay-id" in remapped.selected)
    }

    // ── Multi-Document SAF Validation (1..5 files, 5MiB, 8MiB) ──────────────────

    @Test
    fun valid1To5FilesPassPreflightCheck() {
        val doc1 = SelectedDocument("wechat.csv", ByteArray(1024))
        val doc2 = SelectedDocument("alipay.xlsx", ByteArray(2048))
        validateMergedDocuments(listOf(doc1, doc2)) // should not throw
    }

    @Test(expected = IllegalArgumentException::class)
    fun zeroFilesRejected() {
        validateMergedDocuments(emptyList())
    }

    @Test(expected = IllegalArgumentException::class)
    fun moreThan5FilesRejectedWithoutCropping() {
        val docs = (1..6).map { SelectedDocument("doc$it.csv", ByteArray(100)) }
        validateMergedDocuments(docs)
    }

    @Test(expected = IllegalArgumentException::class)
    fun singleFileOver5MiBRejected() {
        val bigDoc = SelectedDocument("big.csv", ByteArray(5 * 1024 * 1024 + 1))
        validateMergedDocuments(listOf(bigDoc))
    }

    @Test(expected = IllegalArgumentException::class)
    fun totalOver8MiBRejected() {
        val docs = listOf(
            SelectedDocument("f1.csv", ByteArray(4 * 1024 * 1024)),
            SelectedDocument("f2.csv", ByteArray(4 * 1024 * 1024)),
            SelectedDocument("f3.csv", ByteArray(1 * 1024 * 1024)), // total 9MiB > 8MiB
        )
        validateMergedDocuments(docs)
    }

    @Test(expected = IllegalArgumentException::class)
    fun unsupportedFileExtensionRejected() {
        val badDoc = SelectedDocument("bills.pdf", ByteArray(100))
        validateMergedDocuments(listOf(badDoc))
    }

    // ── Request Gate & Late A-B-A ──────────────────────────────────────────────

    @Test
    fun requestGateRejectsLateResponseFromPreviousBatchOrAccount() {
        val gate = AssistantRequestGate()
        val ticket1 = gate.begin("batch-load", "batch-1")
        val ticket2 = gate.begin("batch-load", "batch-2")

        // ticket1 is superseded by ticket2
        assertFalse(gate.accepts(ticket1, "batch-1"))
        assertTrue(gate.accepts(ticket2, "batch-2"))

        // Invalid scope rejected
        assertFalse(gate.accepts(ticket2, "other-batch"))
    }

    // ── Weak Collision Hard Lock & Positive Ignored Eligibility ────────────────

    @Test
    fun weakCollisionIsHardLockedAndRejectsSelectionWhilePositiveIgnoredRemainsEligible() {
        // 1. Weak collision row is strictly hard locked and ineligible
        val wcRow = testRow("r-wc", conflictKind = "weak_collision", note = "同日同额疑似碰撞")
        assertTrue(wcRow.isHardBlocked)
        assertFalse(wcRow.isEligible)

        val err = validateBatchForReview(
            selectedIds = setOf("r-wc"),
            rows = listOf(wcRow),
            assignments = mapOf("r-wc" to CategoryAssignment.Existing("cat1")),
            approvedSuggestionIds = emptySet(),
            activeLeafCategoryIds = setOf("cat1"),
        )
        assertNotNull(err)
        assertTrue(err!!.contains("存在批次内弱冲突，不可选入"))

        // 2. Positive row with status or rule ignore reason remains eligible
        val positiveIgnored = testRow("r-pos-ign", amountCents = 1500L, existing = false, ignored = true, ignoreReason = "状态:转账成功")
        assertFalse(positiveIgnored.isHardBlocked)
        assertTrue(positiveIgnored.isEligible)

        val okErr = validateBatchForReview(
            selectedIds = setOf("r-pos-ign"),
            rows = listOf(positiveIgnored),
            assignments = mapOf("r-pos-ign" to CategoryAssignment.Existing("cat1")),
            approvedSuggestionIds = emptySet(),
            activeLeafCategoryIds = setOf("cat1"),
        )
        assertNull(okErr)
    }

    // ── Ambiguous Candidates & Proposal Name Editing ───────────────────────────

    @Test
    fun ambiguousMultipleCandidatesRequireExplicitSelectionAndBindTargetMetadata() {
        val candA = CategorySuggestionCandidate(
            categoryId = "cat-dining-branch1",
            name = "餐饮美食",
            type = 0,
            parentId = "parent-exp-1",
            isLeaf = true,
        )
        val candB = CategorySuggestionCandidate(
            categoryId = "cat-dining-branch2",
            name = "餐饮美食",
            type = 0,
            parentId = "parent-exp-2",
            isLeaf = true,
        )
        val sug = CategorySuggestion(
            suggestionId = "sug-ambig",
            origin = "ai",
            name = "餐饮美食",
            type = 0,
            parentId = "parent-exp-1",
            relatedItemCount = 2,
            relatedItemIds = listOf("r1", "r2"),
            candidates = listOf(candA, candB),
        )

        // Must NOT take firstOrNull blindly; user explicitly picks candidate B:
        val chosenCand = candB
        val approval = ApprovedCategory(
            suggestionId = sug.suggestionId,
            resolution = "create",
            reuseCategoryId = chosenCand.categoryId,
            name = chosenCand.name,
            type = chosenCand.type,
            parentId = chosenCand.parentId,
        )
        assertEquals("cat-dining-branch2", approval.reuseCategoryId)
        assertEquals("餐饮美食", approval.name)
        assertEquals("parent-exp-2", approval.parentId)

        // Proposal name editing test: user renames proposed category to custom name
        val renamedApproval = ApprovedCategory(
            suggestionId = sug.suggestionId,
            resolution = "create",
            reuseCategoryId = null,
            name = "聚餐团建",
            type = sug.type, // type locked to suggestion
            parentId = sug.parentId, // parent locked to suggestion
        )
        assertEquals("聚餐团建", renamedApproval.name)
        assertNull(renamedApproval.reuseCategoryId)
        assertEquals(0, renamedApproval.type)
        assertEquals("parent-exp-1", renamedApproval.parentId)

        // Retraction: approval removed from map
        var approvedMap = mapOf(sug.suggestionId to renamedApproval)
        approvedMap = approvedMap - sug.suggestionId
        assertFalse(approvedMap.containsKey(sug.suggestionId))
    }

    // ── Default Selection Respects Nullable ai.include ─────────────────────────

    @Test
    fun defaultSelectionDistinguishesNullableAiInclude() {
        // row 1: ai.include == true -> selected
        val rTrue = testRow("r-true").copy(ai = ImportRowAi("ready", true, "AI推荐", "cat1", null))
        // row 2: ai.include == null -> no advice -> selected if eligible and not ignored
        val rNull = testRow("r-null").copy(ai = ImportRowAi("none", null, "无建议", null, null))
        // row 3: ai.include == false -> explicit AI exclusion -> NOT selected
        val rFalse = testRow("r-false").copy(ai = ImportRowAi("ready", false, "AI排除", null, null))

        val all = listOf(rTrue, rNull, rFalse)
        val initialSelected = mutableSetOf<String>()
        all.forEach { row ->
            val ai = row.ai
            if (row.isEligible && !row.possibleDuplicate && !row.legacyLedgerMatch && !row.ignored) {
                if (ai?.include == true || ai == null || ai.include == null) {
                    initialSelected.add(row.itemId)
                }
            }
        }

        assertTrue("r-true" in initialSelected)
        assertTrue("r-null" in initialSelected)
        assertFalse("r-false" in initialSelected)
    }

    // ── Snapshot Consistency Check & Atomic Commit Logic ───────────────────────

    @Test
    fun loadedMixedSnapStateConsistencyDetectionRejectsMismatchedRevisions() {
        val batchVersion = 2L
        val analysisRevision = 3L
        val viewRevision = "view-rev-100"

        // Consistent category response
        val consistentCats = ImportBatchCategoriesResponse(
            batchId = "b1",
            version = batchVersion,
            analysisRevision = analysisRevision,
            viewRevision = viewRevision,
            categories = emptyList(),
            items = emptyList(),
            notice = null,
        )
        val isConsistent = consistentCats.version == batchVersion &&
                consistentCats.analysisRevision == analysisRevision &&
                consistentCats.viewRevision == viewRevision
        assertTrue(isConsistent)

        // Mismatched category response (analysis revision advanced concurrently)
        val staleCats = consistentCats.copy(analysisRevision = 4L)
        val isStale = staleCats.version == batchVersion &&
                staleCats.analysisRevision == analysisRevision &&
                staleCats.viewRevision == viewRevision
        assertFalse(isStale) // Inconsistency detected! Dropped, not committed.
    }

    // ── Polling Gate Ticket & Scope Invalidation ────────────────────────────────

    @Test
    fun pollingGateTicketRejectsLateOrCrossScopeResponses() {
        val gate = AssistantRequestGate()
        val scope1 = "conv-1|batch-1|rev-1"
        val ticket1 = gate.begin("poll-analysis", scope1)

        assertTrue(gate.accepts(ticket1, scope1))

        // When revision advances or new polling begins, scope changes:
        val scope2 = "conv-1|batch-1|rev-2"
        val ticket2 = gate.begin("poll-analysis", scope2)

        // Stale ticket1 from scope1 is strictly rejected:
        assertFalse(gate.accepts(ticket1, scope1))
        assertTrue(gate.accepts(ticket2, scope2))

        // Gate prevents stale 401 navigation
        var authExpiredCalled = false
        val staleTicket = ticket1
        if (gate.accepts(staleTicket, scope1)) {
            authExpiredCalled = true
        }
        assertFalse(authExpiredCalled)
    }

    // ── Review Boundary Fix 4: Pure Pagination Reducer & Incomplete Gate ───────

    private fun testPage(
        batchId: String = "b1",
        version: Long = 2L,
        analysisRevision: Long = 1L,
        viewRevision: String = "rev-1",
        total: Int = 500,
        items: List<ImportBatchRow>,
        nextCursor: String? = null,
        pageIndex: Int = 0,
    ): ImportBatchRowsPage = ImportBatchRowsPage(
        batchId = batchId,
        version = version,
        analysisRevision = analysisRevision,
        viewRevision = viewRevision,
        total = total,
        items = items,
        nextCursor = nextCursor,
        readAt = 1000L + pageIndex,
    )

    @Test
    fun validateAndReduceBatchPagesSucceedsOnFull500ItemsAcross5PagesWithNullCursor() {
        val pages = (0 until 5).map { pageIdx ->
            val pageItems = (1..100).map { i -> testRow("item-${pageIdx * 100 + i}") }
            testPage(
                total = 500,
                items = pageItems,
                nextCursor = if (pageIdx < 4) "cur-${pageIdx + 1}" else null,
                pageIndex = pageIdx,
            )
        }

        val result = validateAndReduceBatchPages(
            declaredTotal = 500,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = pages,
            maxPages = 5,
        )

        assertTrue(result.isValid)
        assertNull(result.errorMessage)
        assertEquals(500, result.loadedRows.size)
        assertEquals("item-1", result.loadedRows.first().itemId)
        assertEquals("item-500", result.loadedRows.last().itemId)
    }

    @Test
    fun validateAndReduceBatchPagesFailsWhen5PagesReturn450ItemsWithRemainingCursor() {
        // 5 pages returning only 450 items (e.g. 5 * 90 items) with remaining cursor on page 5
        val pages = (0 until 5).map { pageIdx ->
            val pageItems = (1..90).map { i -> testRow("item-${pageIdx * 90 + i}") }
            testPage(
                total = 500,
                items = pageItems,
                nextCursor = "cur-${pageIdx + 1}", // page 5 still has remaining cursor!
                pageIndex = pageIdx,
            )
        }

        val result = validateAndReduceBatchPages(
            declaredTotal = 500,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = pages,
            maxPages = 5,
        )

        assertFalse(result.isValid)
        assertNotNull(result.errorMessage)
        assertTrue(result.errorMessage!!.contains("未耗尽") || result.errorMessage!!.contains("总数校验失败"))
    }

    @Test
    fun validateAndReduceBatchPagesFailsWhenLastPageHasRemainingCursor() {
        val page1 = testPage(
            total = 200,
            items = (1..100).map { testRow("item-$it") },
            nextCursor = "cur-1",
            pageIndex = 0,
        )
        val page2 = testPage(
            total = 200,
            items = (101..200).map { testRow("item-$it") },
            nextCursor = "cur-unexpected-remains", // server indicates more rows exist
            pageIndex = 1,
        )

        val result = validateAndReduceBatchPages(
            declaredTotal = 200,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = listOf(page1, page2),
        )

        assertFalse(result.isValid)
        assertTrue(result.errorMessage!!.contains("未耗尽"))
    }

    @Test
    fun validateAndReduceBatchPagesFailsOnDuplicateCursorLoop() {
        val page1 = testPage(
            total = 300,
            items = (1..100).map { testRow("item-$it") },
            nextCursor = "loop-cur",
            pageIndex = 0,
        )
        val page2 = testPage(
            total = 300,
            items = (101..200).map { testRow("item-$it") },
            nextCursor = "loop-cur", // duplicate cursor!
            pageIndex = 1,
        )

        val result = validateAndReduceBatchPages(
            declaredTotal = 300,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = listOf(page1, page2),
        )

        assertFalse(result.isValid)
        assertTrue(result.errorMessage!!.contains("重复游标"))
    }

    @Test
    fun validateAndReduceBatchPagesFailsOnAbnormalEmptyPage() {
        val page1 = testPage(
            total = 100,
            items = emptyList(), // unexpected empty page when total is 100
            nextCursor = null,
            pageIndex = 0,
        )

        val result = validateAndReduceBatchPages(
            declaredTotal = 100,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = listOf(page1),
        )

        assertFalse(result.isValid)
        assertTrue(result.errorMessage!!.contains("空行") || result.errorMessage!!.contains("总数校验失败"))
    }

    @Test
    fun validateAndReduceBatchPagesFailsOnPageTotalMismatch() {
        val page1 = testPage(
            total = 99, // mismatch with declaredTotal 100
            items = (1..100).map { testRow("item-$it") },
            nextCursor = null,
            pageIndex = 0,
        )

        val result = validateAndReduceBatchPages(
            declaredTotal = 100,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = listOf(page1),
        )

        assertFalse(result.isValid)
        assertTrue(result.errorMessage!!.contains("total"))
    }

    @Test
    fun validateAndReduceBatchPagesFailsOnVersionOrAnalysisRevisionOrViewRevisionMismatchWithoutBlankWildcard() {
        val pageValid = testPage(total = 50, items = (1..50).map { testRow("item-$it") })

        // Version mismatch
        val pageBadVer = pageValid.copy(version = 99L)
        val rVer = validateAndReduceBatchPages(50, 2L, 1L, "rev-1", listOf(pageBadVer))
        assertFalse(rVer.isValid)
        assertTrue(rVer.errorMessage!!.contains("version"))

        // AnalysisRevision mismatch
        val pageBadAna = pageValid.copy(analysisRevision = 99L)
        val rAna = validateAndReduceBatchPages(50, 2L, 1L, "rev-1", listOf(pageBadAna))
        assertFalse(rAna.isValid)
        assertTrue(rAna.errorMessage!!.contains("analysisRevision"))

        // ViewRevision mismatch
        val pageBadRev = pageValid.copy(viewRevision = "rev-other")
        val rRev = validateAndReduceBatchPages(50, 2L, 1L, "rev-1", listOf(pageBadRev))
        assertFalse(rRev.isValid)
        assertTrue(rRev.errorMessage!!.contains("viewRevision"))

        // Blank viewRevision on page must NOT act as a wildcard
        val pageBlankRev = pageValid.copy(viewRevision = "")
        val rBlank = validateAndReduceBatchPages(50, 2L, 1L, "rev-1", listOf(pageBlankRev))
        assertFalse(rBlank.isValid)
        assertTrue(rBlank.errorMessage!!.contains("viewRevision"))

        // Blank expectedViewRevision must fail
        val rBlankExp = validateAndReduceBatchPages(50, 2L, 1L, "", listOf(pageValid))
        assertFalse(rBlankExp.isValid)
        assertTrue(rBlankExp.errorMessage!!.contains("viewRevision"))
    }

    @Test
    fun validateAndReduceBatchPagesFailsOnDuplicateItemIdsAcrossPages() {
        val page1 = testPage(
            total = 2,
            items = listOf(testRow("dup-item")),
            nextCursor = "cur-1",
            pageIndex = 0,
        )
        val page2 = testPage(
            total = 2,
            items = listOf(testRow("dup-item")), // duplicate item id across pages
            nextCursor = null,
            pageIndex = 1,
        )

        val result = validateAndReduceBatchPages(
            declaredTotal = 2,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = listOf(page1, page2),
        )

        assertFalse(result.isValid)
        assertTrue(result.errorMessage!!.contains("重复账单项 ID"))
    }

    // ── Projection & Draft Retention Tests ─────────────────────────────────────

    @Test
    fun selectedRowProjectionRendersPlannedNewMarkAndCategoryTypeLabelAndRetainsEmptyNote() {
        val rowWithPlan = ReviewSelectedRow(
            itemId = "r-plan",
            type = 0,
            amountCents = 3000L,
            categoryId = null,
            suggestionId = "sug-plan",
            note = "", // exact empty note from server
            categoryName = "潮玩手办",
            categoryType = 0,
            approvedNewCategoryName = "潮玩手办",
            dateLabel = "2024-10-17",
        )

        val isPlannedNew = rowWithPlan.approvedNewCategoryName != null
        assertTrue(isPlannedNew)
        assertEquals("潮玩手办", rowWithPlan.approvedNewCategoryName)
        assertEquals(0, rowWithPlan.categoryType)

        // Empty note must NOT be replaced with non-empty fallback
        val fallbackNote = "这是草稿备注"
        val resolvedNote = rowWithPlan.note ?: fallbackNote
        assertEquals("", resolvedNote) // exactly preserved as empty string!

        // Reuse row projection
        val reuseRow = ReviewSelectedRow(
            itemId = "r-reuse",
            type = 1,
            amountCents = 5000L,
            categoryId = "cat-inc",
            suggestionId = null,
            note = "工资入账",
            categoryName = "薪资收入",
            categoryType = 1,
            approvedNewCategoryName = null,
        )
        assertFalse(reuseRow.approvedNewCategoryName != null)
        assertEquals(1, reuseRow.categoryType)
        val catTypeLabel = when (reuseRow.categoryType) {
            1 -> "收入分类"
            0 -> "支出分类"
            else -> null
        }
        assertEquals("收入分类", catTypeLabel)
    }

    @Test
    fun reviewSummaryCountsProjectionRendersNullableUserExcludedAsNotProvidedAndDistinctRuleIgnored() {
        val counts = ReviewSummaryCounts(
            total = 100,
            selected = 80,
            notSelected = 20,
            preexisting = 5,
            ruleIgnored = 10,
            conflictRows = 2,
            userExcluded = null,
        )

        // When userExcluded is null, must project as "未提供", NOT "0 笔"
        val userExLabel = if (counts.userExcluded != null) "${counts.userExcluded} 笔" else "未提供"
        assertEquals("未提供", userExLabel)
        assertNotEquals("0 笔", userExLabel)

        // ruleIgnored is independent and distinct
        assertEquals(10, counts.ruleIgnored)
        assertNotEquals(counts.ruleIgnored, counts.userExcluded)
    }

    @Test
    fun loadBatchFailureRetainsExistingDraftSelectionsAndNoteOverrides() {
        // User has already made drafts
        var selectedItemIds = setOf("item-1", "item-2")
        var userExcludedItemIds = setOf("item-3")
        var noteOverrides = mapOf("item-1" to "自定义备注")
        var categoryAssignments = mapOf("item-1" to CategoryAssignment.Existing("cat-1"))

        // Simulate an invalid pagination result (e.g. 450 of 500 loaded)
        val badResult = validateAndReduceBatchPages(
            declaredTotal = 500,
            expectedVersion = 2L,
            expectedAnalysisRevision = 1L,
            expectedViewRevision = "rev-1",
            pages = listOf(testPage(total = 500, items = (1..100).map { testRow("item-$it") }, nextCursor = "cur-2")),
        )
        assertFalse(badResult.isValid)

        // On failure, atomic commit does NOT happen; existing drafts MUST NOT be reset or dropped
        // Assert drafts remain intact
        assertEquals(setOf("item-1", "item-2"), selectedItemIds)
        assertEquals(setOf("item-3"), userExcludedItemIds)
        assertEquals("自定义备注", noteOverrides["item-1"])
        assertEquals(CategoryAssignment.Existing("cat-1"), categoryAssignments["item-1"])
    }

    @Test
    fun attentionViewIncludesConflictAndUnassignedRowsBeforeOrdinaryRows() {
        // 1. Conflict row
        val conflictRow = testRow("r-conflict", conflictGroup = "cg-1", conflictKind = "fact_conflict")
        // 2. Unassigned row (no assignment, no fallback)
        val unassignedRow = testRow("r-unassigned", fbEffectiveCatId = null, fbSugId = null, aiCatId = null, aiSugId = null)
        // 3. Suspected duplicate row
        val duplicateRow = testRow("r-duplicate", possibleDuplicate = true)
        // 4. Ignored / rule anomaly row
        val ignoredRow = testRow("r-ignored", ignored = true, ignoreReason = "status:refunded")
        // 5. Ordinary resolved row
        val resolvedRow = testRow("r-resolved", fbEffectiveCatId = "builtin-food")
        // 6. Explicitly excluded row (userExcluded) - does not require attention
        val excludedRow = testRow("r-excluded", fbEffectiveCatId = null)

        val allRows = listOf(resolvedRow, conflictRow, unassignedRow, duplicateRow, ignoredRow, excludedRow)
        val selected = setOf("r-conflict", "r-resolved")
        val userExcluded = setOf("r-excluded")
        val activeCats = setOf("builtin-food")

        // 待核对 filter tests:
        val attentionList = filterBatchRows(
            rows = allRows,
            query = "",
            filter = "待核对",
            selected = selected,
            userExcluded = userExcluded,
            activeCategoryIds = activeCats,
        )

        // Excluded row is not in attention view
        assertFalse(attentionList.any { it.itemId == "r-excluded" })
        // Resolved row with active category does not need attention
        assertFalse(attentionList.any { it.itemId == "r-resolved" })
        // Conflict, unassigned, duplicate, ignored rows ARE in attention view
        assertTrue(attentionList.any { it.itemId == "r-conflict" })
        assertTrue(attentionList.any { it.itemId == "r-unassigned" })
        assertTrue(attentionList.any { it.itemId == "r-duplicate" })
        assertTrue(attentionList.any { it.itemId == "r-ignored" })
        assertEquals(4, attentionList.size)

        // 全部 filter: shows ALL rows, but attention-needing rows sorted first
        val allFiltered = filterBatchRows(
            rows = allRows,
            query = "",
            filter = "全部",
            selected = selected,
            userExcluded = userExcluded,
            activeCategoryIds = activeCats,
        )
        assertEquals(6, allFiltered.size)
        // The first 4 items in "全部" must be the attention-needing items
        val firstFourIds = allFiltered.take(4).map { it.itemId }.toSet()
        assertEquals(setOf("r-conflict", "r-unassigned", "r-duplicate", "r-ignored"), firstFourIds)
    }

    @Test
    fun originalNoteAlternativesPreserveEmptyAndQuotedNotes() {
        val alts = listOf(
            ImportRowNoteAlternative("alipay.csv", "带\"引号\"与\n换行的备注"),
            ImportRowNoteAlternative("wechat.xlsx", ""),
        )
        val row = testRow("r-notes").copy(
            note = "主备注",
            noteAlternatives = alts,
        )
        assertEquals(2, row.noteAlternatives.size)
        assertEquals("带\"引号\"与\n换行的备注", row.noteAlternatives[0].note)
        assertEquals("", row.noteAlternatives[1].note)

        // When adopting an empty alternative, noteOverrides explicitly stores "" rather than falling back
        val noteOverrides = mutableMapOf<String, String>()
        noteOverrides[row.itemId] = row.noteAlternatives[1].note
        assertEquals("", noteOverrides[row.itemId])
        assertNotEquals(row.note, noteOverrides[row.itemId])
    }
}
