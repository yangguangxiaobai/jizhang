package com.yansuu1.jizhang.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Structural wiring guards for Four-Purpose Financial Plan.
 * Confirms non-destructive entry points, fullscreen Dialog overlay, back handling,
 * and bottom bar hiding per contract.md and parent specifications.
 */
class FinancialPlanWiringTest {

    private fun source(relative: String): String {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .first { File(it, "app/src/main/java").isDirectory || File(it, "clients/android/app/src/main/java").isDirectory }
        val android = if (File(root, "app/src/main/java").isDirectory) root else File(root, "clients/android")
        return File(android, "app/src/main/java/com/yansuu1/jizhang/ui/$relative").readText()
    }

    @Test
    fun budgetTabExposesHarmlessDefaultCallbackAndAlwaysVisibleEntryCard() {
        val src = source("BudgetTab.kt")
        assertTrue(src.contains("onOpenFinancialPlan: () -> Unit = {}"))
        assertTrue(src.contains("四账户理财计划"))
        assertTrue(src.contains("25/15/50/10 资产用途规划与5个月必要开支应急储备测算"))
        assertTrue(src.contains("OutlinedButton(onClick = onOpenFinancialPlan)"))
    }

    @Test
    fun mainShellWiresFullscreenDialogOverlayWithoutDisposingBudgetTab() {
        val src = source("MainShell.kt")
        assertTrue(src.contains("var showingFinancialHost by remember { mutableStateOf(false) }"))
        // The plan host is now a primary tab, so it must not be in hideBottomBar.
        // The two salary overlays (plan-host and income-editor handoff) still hide it.
        assertTrue(src.contains("val hideBottomBar = creatingSalary || showingSalaryFromEditor || showingPending"))
        assertTrue(src.contains("val destination: Tab = if (showingFinancialHost) Tab.Plan else tab"))
        assertTrue(src.contains("initialFinancialHostTab = FinancialHostTab."))
        assertTrue(src.contains("showingFinancialHost = true"))
        assertTrue(src.contains("editorReturnToDetailId = id.takeIf { viewingTx == it }"))
        assertTrue(src.contains("viewingTx = returnToDetailId"))
        assertTrue(src.contains("showingSalaryFromEditor -> showingSalaryFromEditor = false"))
        assertTrue(src.contains("backEnabled = !showingSalaryFromEditor"))

        // Verifies FinancialHostScreen routing that unifies execution, budget, and scenario
        assertTrue(src.contains("FinancialHostScreen("))
        assertTrue(src.contains("onBack = { showingFinancialHost = false }"))
    }

    @Test
    fun financialPlanScreenIntegratesOwnerAndSafeLifecycle() {
        val src = source("FinancialPlanScreen.kt")
        assertTrue(src.contains("FinancialPlanRepository(api)"))
        assertTrue(src.contains("FinancialPlanWorkOwner()"))
        assertTrue(src.contains("FinancialPlanDraft"))
        assertTrue(src.contains("executePreview()"))
        assertTrue(src.contains("executeSave("))
        assertTrue(src.contains("retainedSaveRequest"))
        assertTrue(src.contains("conflictOccurred"))
        assertTrue(src.contains("inputFieldsEnabled"))
        assertTrue(src.contains("四账户理财计划"))
        assertTrue(src.contains("var isBusy by remember { mutableStateOf(false) }"))
        assertTrue(src.contains("currentCoroutineContext().ensureActive()"))
        assertTrue(src.contains("api.hasSession()"))
    }

    @Test
    fun analysisReserveRemainsBoundToItsSavedOrPreviewSnapshot() {
        val src = source("FinancialPlanScreen.kt")
        assertTrue(src.contains("val displayedInputs = if (isViewingPreview) previewedInputs else savedPlan?.inputs"))
        assertTrue(src.contains("requireNotNull(displayedInputs).reserveBalanceCents"))
        assertTrue(!src.contains("draft.validate().getOrNull()?.reserveBalanceCents"))
    }
}
