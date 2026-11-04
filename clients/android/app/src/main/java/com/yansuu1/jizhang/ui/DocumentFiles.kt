package com.yansuu1.jizhang.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal data class SelectedDocument(val name: String, val bytes: ByteArray)

internal const val MAX_CSV_DOCUMENT_BYTES = 10 * 1024 * 1024
internal const val MERGED_MAX_FILES = 5
internal const val MERGED_MAX_FILE_BYTES = 5 * 1024 * 1024
internal const val MERGED_MAX_TOTAL_BYTES = 8 * 1024 * 1024

/** Validate documents for merged import batch (1..5 files, <=5MiB each, <=8MiB total, CSV or XLSX). */
internal fun validateMergedDocuments(documents: List<SelectedDocument>) {
    require(documents.isNotEmpty()) { "请至少选择一个账单文件" }
    require(documents.size <= MERGED_MAX_FILES) { "最多只能选择 $MERGED_MAX_FILES 个账单文件，当前选择了 ${documents.size} 个" }
    var totalBytes = 0L
    documents.forEach { doc ->
        val isCsvOrXlsx = doc.name.endsWith(".csv", ignoreCase = true) || doc.name.endsWith(".xlsx", ignoreCase = true)
        require(isCsvOrXlsx) { "文件「${doc.name}」格式不支持，仅支持 CSV 或 XLSX 格式" }
        require(doc.bytes.isNotEmpty()) { "文件「${doc.name}」不能为空" }
        require(doc.bytes.size <= MERGED_MAX_FILE_BYTES) { "文件「${doc.name}」超过 5MiB 限制" }
        totalBytes += doc.bytes.size
    }
    require(totalBytes <= MERGED_MAX_TOTAL_BYTES) { "所选文件总大小超过 8MiB 限制（当前 ${totalBytes / 1024 / 1024}MB）" }
}

/** SAF document IDs are not file names; keep the provider's actual extension. */
internal suspend fun readMultipleDocuments(
    context: Context,
    uris: List<Uri>,
    maxFiles: Int = MERGED_MAX_FILES,
    maxFileBytes: Int = MERGED_MAX_FILE_BYTES,
    maxTotalBytes: Int = MERGED_MAX_TOTAL_BYTES,
): List<SelectedDocument> = withContext(Dispatchers.IO) {
    require(uris.isNotEmpty()) { "未选择任何文件" }
    require(uris.size <= maxFiles) { "最多只能选择 $maxFiles 个账单文件，当前选择了 ${uris.size} 个" }

    var totalAccumulated = 0L
    val results = mutableListOf<SelectedDocument>()

    for (uri in uris) {
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "attachment"

        val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= maxFileBytes) { "文件「$name」超过 5MiB 限制" }
                require(totalAccumulated + output.size() + count <= maxTotalBytes) { "所有文件总大小不能超过 8MiB" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        } ?: throw IllegalArgumentException("无法读取所选文件：$name")

        totalAccumulated += bytes.size
        results.add(SelectedDocument(name, bytes))
    }

    validateMergedDocuments(results)
    results
}

/** Providers disagree on CSV MIME types; validate the selected document itself. */
internal fun validateCsvDocument(document: SelectedDocument) {
    require(document.name.endsWith(".csv", ignoreCase = true)) { "请选择 .csv 文件" }
    require(document.bytes.isNotEmpty()) { "CSV 文件不能为空" }
    require(document.bytes.size <= MAX_CSV_DOCUMENT_BYTES) { "CSV 文件不能超过 10MB" }
}

/** SAF document IDs are not file names; keep the provider's actual extension. */
internal suspend fun readDocument(context: Context, uri: Uri, maxBytes: Int = 5 * 1024 * 1024): SelectedDocument = withContext(Dispatchers.IO) {
    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: "attachment"
    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            require(output.size() + count <= maxBytes) { "文件不能超过 ${maxBytes / (1024 * 1024)}MB" }
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    } ?: throw IllegalArgumentException("无法读取所选文件")
    SelectedDocument(name, bytes)
}
