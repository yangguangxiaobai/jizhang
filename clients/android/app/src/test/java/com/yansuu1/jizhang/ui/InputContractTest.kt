package com.yansuu1.jizhang.ui

import org.junit.Assert.*
import org.junit.Test

class InputContractTest {
    @Test fun csvSelectionValidatesFilenameAndSizeInsteadOfProviderMimeType() {
        validateCsvDocument(SelectedDocument("export.CSV", "id,amount\n".toByteArray()))
        val invalid = listOf(
            SelectedDocument("export.csv.exe", byteArrayOf(1)),
            SelectedDocument("export.csv", ByteArray(0)),
            SelectedDocument("export.csv", ByteArray(MAX_CSV_DOCUMENT_BYTES + 1)),
        )
        for (document in invalid) {
            try { validateCsvDocument(document); fail("Accepted invalid CSV document: ${document.name}") }
            catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun existingAmountsRemainEditableWithCommaDecimalLocale() {
        val previous = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            assertEquals("12.34", formatYuan(1234L))
            assertEquals(1234L, parseYuanToCents(formatYuan(1234L)))
        } finally { java.util.Locale.setDefault(previous) }
    }
    @Test fun invalidDatesNeverSilentlyBecomeToday() {
        for (input in listOf("2026-02-30", "nonsense", "2026-10-09 trailing")) {
            try { parseDateInput(input); fail("Accepted invalid date: $input") }
            catch (_: IllegalArgumentException) { }
        }
        assertEquals("2026-10-09", dateInput(parseDateInput("2026-10-09")))
    }
    @Test fun amountsPreserveCentBoundaryAndRejectUnsafeIntegers() {
        assertEquals(1999L, parseYuanToCents("19.99"))
        assertNull(parseYuanToCents("999999999999999999999999"))
        assertEquals(0L, parseYuanToCents("0"))
    }
}
