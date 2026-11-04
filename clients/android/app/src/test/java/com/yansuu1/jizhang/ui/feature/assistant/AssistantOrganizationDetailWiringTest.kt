package com.yansuu1.jizhang.ui.feature.assistant

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Source-wiring guards only; physical touch routing still requires device acceptance. */
class AssistantOrganizationDetailWiringTest {
    private fun source(relative: String): String {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .first { File(it, "app/src/main/java").isDirectory || File(it, "clients/android/app/src/main/java").isDirectory }
        val android = if (File(root, "app/src/main/java").isDirectory) root else File(root, "clients/android")
        return File(android, "app/src/main/java/com/yansuu1/jizhang/ui/$relative").readText()
    }

    @Test
    fun categoryAndTagCardsUseTransactionIdentityNotActionIdentity() {
        val workspace = source("feature/assistant/AssistantOrganizationWorkspace.kt")
        val reviews = workspace.substringAfter("val categoryActions = currentCard.categoryActions")
            .substringBefore("if (currentCard.selectableActions.isEmpty())")
        assertTrue(Regex("onOpenDetail = if \\(!busy\\) action.transactionId").findAll(reviews).count() == 2)
        assertFalse(reviews.contains("detailTransactionId = action.actionId"))
        val card = workspace.substringAfter("private fun OrganizationActionCard(")
            .substringBefore("private fun NoteSuggestionCard(")
        assertTrue(card.contains("onClick = onOpenDetail"))
        assertTrue(card.contains("onCheckedChange = onCheckedChange"))
        assertTrue(card.contains("点击卡片查看原账单详情"))
    }

    @Test
    fun detailsReuseExistingReadOnlyDialogWithoutClearingReview() {
        val workspace = source("feature/assistant/AssistantOrganizationWorkspace.kt")
        val dialog = workspace.substringAfter("detailTransactionId?.let { transactionId ->")
            .substringBefore("if (showStartPicker)")
        assertTrue(dialog.contains("TransactionDetailScreen("))
        assertTrue(dialog.contains("transactionId = transactionId"))
        assertTrue(dialog.contains("readOnly = true"))
        assertTrue(dialog.contains("onBack = { detailTransactionId = null }"))
        assertFalse(dialog.contains("selected ="))
        assertFalse(dialog.contains("card ="))
        assertFalse(dialog.contains("startAnalysis"))
        assertTrue(workspace.contains("detailTransactionId = note.transactionId"))
    }

    @Test
    fun originalDetailKeepsActionsButReadOnlyHidesAllMutations() {
        val detail = source("TransactionDetailScreen.kt")
        assertTrue(detail.contains("readOnly: Boolean = false"))
        assertTrue(detail.contains("readOnly = readOnly"))
        val controls = detail.substringAfter("if (!readOnly) {")
            .substringBefore("if (!readOnly && deleteError")
        assertTrue(controls.contains("onClick = onEdit"))
        assertTrue(controls.contains("onClick = onRefund"))
        assertTrue(controls.contains("onClick = { confirmDelete = true }"))
        assertTrue(detail.contains("if (!readOnly && confirmDelete)"))
        assertTrue(Regex("AssistantOrganizationWorkspace\\(\\s+api = api,").containsMatchIn(source("AssistantTab.kt")))
    }
}
