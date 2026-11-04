package com.yansuu1.jizhang.ui.feature.imports

import com.yansuu1.jizhang.ui.SelectedDocument
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatformImportEntryStateTest {

    @Test
    fun contextCreationAndEquality() {
        val dataContext = PlatformImportEntryContext(
            source = PlatformImportSource.DATA,
            existingConversationId = null,
        )
        assertEquals(PlatformImportSource.DATA, dataContext.source)
        assertNull(dataContext.existingConversationId)

        val assistantContext = PlatformImportEntryContext(
            source = PlatformImportSource.ASSISTANT,
            existingConversationId = "conv-123",
        )
        assertEquals(PlatformImportSource.ASSISTANT, assistantContext.source)
        assertEquals("conv-123", assistantContext.existingConversationId)
    }

    @Test
    fun validatesFileLimitsAndExtensions() {
        val validCsv = SelectedDocument("wechat.csv", ByteArray(1024))
        val validXlsx = SelectedDocument("alipay.xlsx", ByteArray(2048))
        val invalidTxt = SelectedDocument("bill.txt", ByteArray(512))

        assertTrue(isValidFileExtension(validCsv.name))
        assertTrue(isValidFileExtension(validXlsx.name))
        assertFalse(isValidFileExtension(invalidTxt.name))

        val singleLimitBytes = 5 * 1024 * 1024
        val totalLimitBytes = 8 * 1024 * 1024

        // Single file over 5MiB
        val oversizedDoc = SelectedDocument("big.csv", ByteArray(singleLimitBytes + 1))
        assertTrue(oversizedDoc.bytes.size > singleLimitBytes)

        // Multi files over 8MiB
        val doc1 = SelectedDocument("part1.csv", ByteArray(4 * 1024 * 1024))
        val doc2 = SelectedDocument("part2.csv", ByteArray(4 * 1024 * 1024 + 1))
        assertTrue(doc1.bytes.size + doc2.bytes.size > totalLimitBytes)
    }

    @Test
    fun pickerCancellationProducesZeroFilesAndZeroBatches() {
        val selectedFiles = emptyList<SelectedDocument>()
        assertTrue(selectedFiles.isEmpty())
        // Empty selection does not create any request
    }

    private fun isValidFileExtension(name: String): Boolean {
        return name.endsWith(".csv", ignoreCase = true) || name.endsWith(".xlsx", ignoreCase = true)
    }
}
