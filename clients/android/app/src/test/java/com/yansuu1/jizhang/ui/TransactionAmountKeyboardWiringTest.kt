package com.yansuu1.jizhang.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM source-wiring regression guards, not Android IME/gesture instrumentation. */
class TransactionAmountKeyboardWiringTest {
    private val source: String by lazy {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .first { File(it, "app/src/main/java").isDirectory || File(it, "clients/android/app/src/main/java").isDirectory }
        val android = if (File(root, "app/src/main/java").isDirectory) root else File(root, "clients/android")
        File(android, "app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt").readText()
    }

    @Test
    fun amountTapClearsRealTextFocusAndHidesImeWithoutMutatingDraft() {
        val click = source.substringAfter("onAmountClick = {").substringBefore("},")
        assertTrue(click.contains("focusManager.clearFocus(force = true)"))
        assertTrue(click.contains("keyboardController?.hide()"))
        for (field in listOf("amountText", "note", "tagsText", "noteFocused", "tagsFocused")) {
            assertFalse("Amount tap must not overwrite $field", Regex("\\b$field\\s*=").containsMatchIn(click))
        }
        assertFalse(click.contains("submit()"))
    }

    @Test
    fun entireAmountCardRemainsClickableEvenWhenAmountIsEmptyOrLayoutCompact() {
        val display = source.substringAfter("private fun AmountDisplay(").substringBefore("private fun TypeSegment(")
        assertTrue(display.contains("onAmountClick: () -> Unit"))
        assertTrue(display.contains("onClick = onAmountClick"))
        assertFalse(display.contains("onClick = if"))
        assertTrue(display.contains("点击金额，切换数字键盘"))
        assertTrue(display.contains("amountText.isBlank()"))
    }

    @Test
    fun noteAndTagStillOwnActualFocusAndCanHideNumericKeypadAgain() {
        assertTrue(source.contains(".onFocusChanged { noteFocused = it.isFocused }"))
        assertTrue(source.contains(".onFocusChanged { tagsFocused = it.isFocused }"))
        val keypad = source.substringAfter("if (!noteFocused && !tagsFocused) {").substringBefore("// Fixed save action")
        assertTrue(keypad.contains("AmountKeypad("))
        assertTrue(keypad.contains("appendKeypadInput(amountText, key)"))
        assertTrue(source.contains("val focusManager = LocalFocusManager.current"))
        assertTrue(source.contains("val keyboardController = LocalSoftwareKeyboardController.current"))
    }
}
