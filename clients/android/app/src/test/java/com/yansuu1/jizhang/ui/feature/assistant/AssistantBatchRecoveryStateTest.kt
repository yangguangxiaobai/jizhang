package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.ui.FinancialScope
import com.yansuu1.jizhang.ui.SelectedDocument
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

class AssistantBatchRecoveryStateTest {

    private fun sha256Hex(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }

    private fun mockBatchFile(index: Int, name: String, bytes: ByteArray) = ImportBatchFile(
        fileIndex = index,
        fileName = name,
        source = "wechat",
        sizeBytes = bytes.size.toLong(),
        sha256 = sha256Hex(bytes),
        parseStatus = "ok",
        rawRowCount = 10,
        collectedRowCount = 10,
        error = null,
    )

    @Test
    fun hashMatchingUsesEveryOriginalExactlyOnce() {
        val b1 = "bill 1 content".toByteArray()
        val b2 = "bill 2 content".toByteArray()
        val b3 = "bill 3 content".toByteArray()

        val doc1 = SelectedDocument("d1.xlsx", b1)
        val doc2 = SelectedDocument("d2.csv", b2)
        val doc3 = SelectedDocument("d3.xlsx", b3)

        val serverFiles = listOf(
            mockBatchFile(0, "s1.xlsx", b1),
            mockBatchFile(1, "s2.csv", b2),
            mockBatchFile(2, "s3.xlsx", b3),
        )

        // 1. Exact match with rearranged candidate order -> sorted to server fileIndex order
        val shuffledDocs = listOf(doc3, doc1, doc2)
        val matched = matchBatchOriginals(serverFiles, shuffledDocs)
        assertNotNull(matched)
        assertEquals(3, matched!!.size)
        assertEquals("d1.xlsx", matched[0].name)
        assertEquals("d2.csv", matched[1].name)
        assertEquals("d3.xlsx", matched[2].name)

        // 2. Same count but different hash -> returns null
        val bDifferent = "different content".toByteArray()
        val wrongDocs = listOf(doc1, doc2, SelectedDocument("fake.xlsx", bDifferent))
        assertNull("同数量但哈希不匹配必须返回 null", matchBatchOriginals(serverFiles, wrongDocs))

        // 3. Missing file (count mismatch) -> returns null
        assertNull("数量不足必须返回 null", matchBatchOriginals(serverFiles, listOf(doc1, doc2)))

        // 4. Duplicate hashes: server has 2 files with identical content
        val serverFilesWithDups = listOf(
            mockBatchFile(0, "first.xlsx", b1),
            mockBatchFile(1, "second.xlsx", b1),
        )
        // If candidate only has 1 instance of doc1, cannot reuse it twice
        assertNull("同一份原件不能被重复占用", matchBatchOriginals(serverFilesWithDups, listOf(doc1, doc2)))

        // If candidate has two documents with same hash, each consumed once
        val doc1Copy = SelectedDocument("d1_copy.xlsx", b1)
        val matchedDups = matchBatchOriginals(serverFilesWithDups, listOf(doc1, doc1Copy))
        assertNotNull(matchedDups)
        assertEquals(2, matchedDups!!.size)
    }

    private class FakeStore : AssistantBatchRecoveryStore {
        val storage = mutableMapOf<String, BatchMutationMetadata>()

        override suspend fun record(scope: FinancialScope, metadata: BatchMutationMetadata) {
            storage[metadata.clientRequestId] = metadata
        }

        override fun list(scope: FinancialScope, conversationId: String, batchId: String): List<BatchMutationMetadata> =
            storage.values.filter { it.conversationId == conversationId && it.batchId == batchId }

        override suspend fun remove(scope: FinancialScope, metadata: BatchMutationMetadata) {
            storage.remove(metadata.clientRequestId)
        }
    }

    @Test
    fun lostMutationResponseKeepsKeyAndCandidateFiles() {
        val b1 = "test original bytes 1".toByteArray()
        val b2 = "test original bytes 2".toByteArray()
        val doc1 = SelectedDocument("orig1.xlsx", b1)
        val doc2 = SelectedDocument("orig2.csv", b2)

        val metadata = BatchMutationMetadata(
            conversationId = "conv-101",
            batchId = "batch-202",
            kind = BatchMutationKind.ANALYSE,
            clientRequestId = "req-fixed-uuid",
            expectedVersion = 1L,
            analysisRevision = 0L,
            targetFileIndex = null,
            files = listOf(
                BatchFileFingerprint(0, "orig1.xlsx", sha256Hex(b1)),
                BatchFileFingerprint(1, "orig2.csv", sha256Hex(b2)),
            ),
        )

        val state = AssistantBatchRecoveryState(
            metadata = metadata,
            state = BatchMutationState.UNKNOWN,
            candidateFiles = listOf(doc1, doc2),
            message = "网络超时，操作结果未知",
        )

        // 状态判定
        assertTrue(state.hasUnresolvedMutation)
        assertEquals("req-fixed-uuid", state.metadata?.clientRequestId)
        assertEquals(2, state.candidateFiles.size)

        // 序列化与反序列化
        val json = metadata.toJson()
        val parsed = BatchMutationMetadata.fromJson(json)
        assertEquals(metadata.clientRequestId, parsed.clientRequestId)
        assertEquals(metadata.expectedVersion, parsed.expectedVersion)
        assertEquals(metadata.files.size, parsed.files.size)
        assertEquals(metadata.files[0].sha256, parsed.files[0].sha256)
    }
}
