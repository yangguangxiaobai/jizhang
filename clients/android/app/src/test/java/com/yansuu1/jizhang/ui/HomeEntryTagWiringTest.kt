package com.yansuu1.jizhang.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Source wiring only; does not replace device navigation/selection acceptance. */
class HomeEntryTagWiringTest {
    private fun source(name: String): String {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .first { File(it, "app/src/main/java").isDirectory || File(it, "clients/android/app/src/main/java").isDirectory }
        val android = if (File(root, "app/src/main/java").isDirectory) root else File(root, "clients/android")
        return File(android, "app/src/main/java/com/yansuu1/jizhang/ui/$name.kt").readText()
    }
    @Test fun homeNoLongerHasDuplicateRecordActionButGlobalAndLedgerAddRemain() {
        val home = source("DashboardTab")
        assertFalse(home.contains("onNewTransaction"))
        assertFalse(home.contains("text = \"记一笔\""))
        val shell = source("MainShell")
        assertTrue(shell.contains("openRecord(tab)"))
        assertTrue(shell.contains("onNew = { openRecord(Tab.Transactions) }"))
    }
    @Test fun statisticsEntryIsOutsideMainLoadingAndFailureBranchAndReusesPage() {
        val home = source("DashboardTab")
        assertTrue(home.contains("onClick = onOpenStats"))
        assertTrue(home.indexOf("onClick = onOpenStats") < home.indexOf("if (mainLoading && !mainHasLoaded)"))
        val shell = source("MainShell")
        assertTrue(shell.contains("onOpenStats = { showingStats = true }"))
        assertTrue(shell.contains("showingStats -> StatsTab("))
        assertTrue(shell.contains("onBack = { showingStats = false }"))
    }
    @Test fun editorOffersCatalogueAlongsideManualInputAndUsesExistingTagToggle() {
        val editor = source("TransactionEditSheet")
        assertTrue(editor.contains("TransactionEditorHelper.tagNames(meta.tags())"))
        assertTrue(editor.contains("选择已有标签（可多选）"))
        assertTrue(editor.contains("value = tagsText"))
        assertTrue(editor.contains("tagsText = TransactionEditorHelper.toggleTag(tagsText, name)"))
        val load = editor.substringAfter("LaunchedEffect(meta, showTagPicker, tagsLoadKey)").substringBefore("BackHandler(enabled = backEnabled)")
        assertTrue(load.contains("catch (e: CancellationException)"))
        assertTrue(load.contains("catch (e: AuthExpiredException)"))
        assertFalse(load.contains("applyDraft("))
        assertFalse(load.contains("tagsText ="))
        assertTrue(editor.contains("Text(\"重试标签\")"))
    }
}
