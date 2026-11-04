package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.ui.SelectedDocument
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

private fun computeSha256(bytes: ByteArray): String {
    val md = MessageDigest.getInstance("SHA-256")
    val digest = md.digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
}

enum class BatchMutationKind(val wireValue: String) {
    ANALYSE("analyse"),
    REPLACE("replace"),
    REMOVE("remove");

    companion object {
        fun fromWire(value: String): BatchMutationKind =
            entries.firstOrNull { it.wireValue == value }
                ?: throw IllegalArgumentException("Unknown mutation kind: $value")
    }
}

data class BatchFileFingerprint(
    val fileIndex: Int,
    val fileName: String,
    val sha256: String,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("fileIndex", fileIndex)
        put("fileName", fileName)
        put("sha256", sha256)
    }

    companion object {
        fun fromJson(json: JSONObject): BatchFileFingerprint = BatchFileFingerprint(
            fileIndex = json.getInt("fileIndex"),
            fileName = json.getString("fileName"),
            sha256 = json.getString("sha256"),
        )
    }
}

data class BatchMutationMetadata(
    val conversationId: String,
    val batchId: String,
    val kind: BatchMutationKind,
    val clientRequestId: String,
    val expectedVersion: Long,
    val analysisRevision: Long,
    val targetFileIndex: Int?,
    val files: List<BatchFileFingerprint>,
    val createdAt: Long = System.currentTimeMillis(),
) {
    init {
        require(conversationId.isNotBlank()) { "conversationId 不能为空" }
        require(batchId.isNotBlank()) { "batchId 不能为空" }
        require(clientRequestId.isNotBlank()) { "clientRequestId 不能为空" }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("conversationId", conversationId)
        put("batchId", batchId)
        put("kind", kind.wireValue)
        put("clientRequestId", clientRequestId)
        put("expectedVersion", expectedVersion)
        put("analysisRevision", analysisRevision)
        if (targetFileIndex != null) put("targetFileIndex", targetFileIndex)
        put("files", JSONArray().apply {
            files.forEach { put(it.toJson()) }
        })
        put("createdAt", createdAt)
    }

    companion object {
        fun fromJson(json: JSONObject): BatchMutationMetadata {
            val filesArr = json.optJSONArray("files") ?: JSONArray()
            val files = (0 until filesArr.length()).map {
                BatchFileFingerprint.fromJson(filesArr.getJSONObject(it))
            }
            return BatchMutationMetadata(
                conversationId = json.getString("conversationId"),
                batchId = json.getString("batchId"),
                kind = BatchMutationKind.fromWire(json.getString("kind")),
                clientRequestId = json.getString("clientRequestId"),
                expectedVersion = json.getLong("expectedVersion"),
                analysisRevision = json.getLong("analysisRevision"),
                targetFileIndex = if (json.isNull("targetFileIndex")) null else json.optInt("targetFileIndex"),
                files = files,
                createdAt = json.optLong("createdAt", System.currentTimeMillis()),
            )
        }
    }
}

enum class BatchMutationState {
    IDLE,
    SENDING,
    UNKNOWN,
    CONFIRMED,
    REJECTED,
}

internal data class AssistantBatchRecoveryState(
    val metadata: BatchMutationMetadata? = null,
    val state: BatchMutationState = BatchMutationState.IDLE,
    val candidateFiles: List<SelectedDocument> = emptyList(),
    val message: String? = null,
) {
    val hasUnresolvedMutation: Boolean
        get() = state == BatchMutationState.SENDING || state == BatchMutationState.UNKNOWN
}

/**
 * 按服务端 fileIndex 顺序和 SHA-256 哈希一一精确匹配内存文件。
 * 每份选中的 doc 只能使用一次，严格按服务端 fileIndex 顺序重新排列返回；
 * 缺失、哈希不匹配、损坏或数量不匹配返回 null。
 */
internal fun matchBatchOriginals(
    files: List<ImportBatchFile>,
    docs: List<SelectedDocument>,
): List<SelectedDocument>? {
    if (files.isEmpty()) return if (docs.isEmpty()) emptyList() else null
    if (files.size != docs.size) return null

    // Compute SHA-256 for all available candidate documents
    val availableDocs = docs.map { doc -> doc to computeSha256(doc.bytes) }.toMutableList()

    val sortedBatchFiles = files.sortedBy { it.fileIndex }
    val matched = mutableListOf<SelectedDocument>()

    for (bf in sortedBatchFiles) {
        val targetHash = bf.sha256
        val matchIndex = availableDocs.indexOfFirst { (_, hash) ->
            hash.equals(targetHash, ignoreCase = true)
        }
        if (matchIndex == -1) {
            return null // No document matching this batch file's hash exactly
        }
        val (foundDoc, _) = availableDocs.removeAt(matchIndex)
        matched.add(foundDoc)
    }

    return matched
}
