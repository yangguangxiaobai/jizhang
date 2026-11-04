package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.ui.feature.assistant.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun buildImportBatchCreateBody(
    clientRequestId: String,
    files: org.json.JSONArray,
    analyse: Boolean,
): JSONObject = JSONObject()
    .put("clientRequestId", clientRequestId)
    .put("analyse", analyse)
    .put("files", files)

internal fun parseOwnedImportBatch(
    response: JSONObject,
    expectedConversationId: String,
    expectedBatchId: String? = null,
): ImportBatch {
    val batch = ImportBatch.fromJson(response)
    require(batch.conversationId == expectedConversationId) {
        "Import batch response conversationId does not match request owner"
    }
    if (expectedBatchId != null) {
        require(batch.batchId == expectedBatchId) { "Import batch response batchId does not match request" }
    }
    val root = response.optJSONObject("batch") ?: response
    val knownBatchStates = setOf("prepared", "reviewed", "confirmed", "cancelled", "expired", "failed", "draft", "analysing", "ready", "confirming")
    val rawBatchStatus = root.optCleanString("status")
    val batchStatus = rawBatchStatus?.takeIf { it in knownBatchStates } ?: "unknown"
    val rawAnalysisState = root.optJSONObject("analysis")?.optCleanString("state")
    val analysisState = rawAnalysisState ?: "unknown"
    return batch.copy(status = batchStatus, analysis = batch.analysis.copy(state = analysisState))
}

internal fun parseConfirmedImportBatchResult(
    response: JSONObject,
    expectedConversationId: String,
    expectedBatchId: String,
): ImportBatchResult {
    val batch = parseOwnedImportBatch(response, expectedConversationId, expectedBatchId)
    require(batch.status == "confirmed") { "Import batch response is not a confirmed result" }
    val batchObject = response.optJSONObject("batch") ?: response
    val resultObject = response.optJSONObject("result") ?: batchObject.optJSONObject("result")
        ?: throw IllegalArgumentException("Confirmed import response requires result")
    val requiredFields = listOf(
        "inserted", "selected", "excluded", "preexisting", "expenseCents", "incomeCents",
        "accountsCreated", "categoriesCreated", "categoriesReused", "categoriesSkippedUnused",
    )
    require(requiredFields.all { resultObject.has(it) && !resultObject.isNull(it) }) {
        "Confirmed import response is missing authoritative result fields"
    }
    return ImportBatchResult.fromJson(resultObject)
        ?: throw IllegalArgumentException("Confirmed import response requires result")
}

/**
 * AI assistant + provider config (A9). Mirrors `api.assistant/ai`:
 * - conversations list/create/messages(send with optional attachment bytes)/archive.
 * - actions confirm (fileBase64/selectedIds/categoryOverrides) / cancel.
 * - provider config get/save/test.
 * Attachment bytes stay in the view's memory only (Web parity).
 */
class AssistantRepository(private val api: ApiClient) {
    suspend fun conversations(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/assistant/conversations") }

    suspend fun createConversation(): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/assistant/conversations", JSONObject())
        }

    suspend fun messages(conversationId: String): JSONObject =
        withContext(Dispatchers.IO) {
            api.get("/api/v1/assistant/conversations/$conversationId/messages")
        }

    // ── AI Generation streaming protocol v1 (protocol-v1.md) ───────────────

    /** Create a new generation turn (version 1) or replay identical clientRequestId. */
    suspend fun createGeneration(
        conversationId: String,
        clientRequestId: String,
        input: GenerationInput,
    ): GenerationCreateResult = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("version", 1)
            .put("clientRequestId", clientRequestId)
            .put("input", input.toJson())
        val resp = api.post("/api/v1/assistant/conversations/$conversationId/generations", body)
        GenerationCreateResult.fromJson(resp)
    }

    /** Fetch most recent generation (0 or 1 items). */
    suspend fun getLatestGeneration(conversationId: String): GenerationSnapshot? =
        withContext(Dispatchers.IO) {
            val resp = api.get("/api/v1/assistant/conversations/$conversationId/generations", mapOf("limit" to "1"))
            val items = resp.optJSONArray("items")
            if (items != null && items.length() > 0) {
                items.optJSONObject(0)?.let { GenerationSnapshot.fromJson(it) }
            } else {
                null
            }
        }

    /** Fetch specific generation snapshot. */
    suspend fun getGeneration(conversationId: String, generationId: String): GenerationSnapshot =
        withContext(Dispatchers.IO) {
            val resp = api.get("/api/v1/assistant/conversations/$conversationId/generations/$generationId")
            val genObj = resp.optJSONObject("generation") ?: resp
            GenerationSnapshot.fromJson(genObj)
        }

    /** Explicitly cancel an active generation on the server. */
    suspend fun cancelGeneration(conversationId: String, generationId: String): GenerationSnapshot =
        withContext(Dispatchers.IO) {
            val resp = api.post("/api/v1/assistant/conversations/$conversationId/generations/$generationId/cancel")
            val genObj = resp.optJSONObject("generation") ?: resp
            GenerationSnapshot.fromJson(genObj)
        }

    /** Stream generation events via SSE, starting from [afterSeq]. */
    fun streamGenerationEvents(
        conversationId: String,
        generationId: String,
        afterSeq: Long = 0L,
    ): Flow<AssistantGenerationEvent> {
        val query = if (afterSeq > 0L) mapOf("afterSeq" to afterSeq.toString()) else emptyMap()
        return api.streamSse(
            "/api/v1/assistant/conversations/$conversationId/generations/$generationId/events",
            query,
        ).mapNotNull { sse ->
            if (sse.data.isBlank()) return@mapNotNull null
            val json = JSONObject(sse.data)
            AssistantGenerationEvent.fromJson(json)
        }
    }

    suspend fun sendMessage(
        conversationId: String,
        text: String,
        clientRequestId: String,
        attachment: Triple<String, String, ByteArray>? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("text", text)
            .put("clientRequestId", clientRequestId)
        if (attachment != null) {
            val (fileName, source, bytes) = attachment
            body.put(
                "attachment",
                JSONObject()
                    .put("fileName", fileName)
                    .put("source", source)
                    .put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)),
            )
        }
        api.post("/api/v1/assistant/conversations/$conversationId/messages", body)
    }

    suspend fun confirmAction(
        actionId: String,
        fileBytes: ByteArray? = null,
        selectedIds: List<String>? = null,
        categoryOverrides: Map<String, String>? = null,
        noteOverrides: Map<String, String>? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val body = JSONObject()
        if (fileBytes != null) {
            body.put(
                "fileBase64",
                android.util.Base64.encodeToString(fileBytes, android.util.Base64.NO_WRAP),
            )
        }
        if (selectedIds != null) body.put("selectedIds", org.json.JSONArray(selectedIds))
        if (categoryOverrides != null) body.put("categoryOverrides", JSONObject(categoryOverrides as Map<String, String>))
        if (noteOverrides != null) body.put("noteOverrides", JSONObject(noteOverrides))
        api.post("/api/v1/assistant/actions/$actionId/confirm", body)
    }

    suspend fun analyseAction(actionId: String, bytes: ByteArray): JSONObject = withContext(Dispatchers.IO) {
        api.post("/api/v1/assistant/actions/$actionId/analyse", JSONObject().put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)))
    }

    suspend fun duplicateCandidates(conversationId: String, actionId: String, rowId: String, cursor: String?): JSONObject = withContext(Dispatchers.IO) {
        fun encode(value: String) = java.net.URLEncoder.encode(value, "UTF-8")
        api.get("/api/v1/assistant/conversations/${encode(conversationId)}/actions/${encode(actionId)}/rows/${encode(rowId)}/duplicates?limit=20" + (cursor?.let { "&cursor=${encode(it)}" } ?: ""))
    }

    suspend fun cancelAction(actionId: String): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/assistant/actions/$actionId/cancel", JSONObject())
        }

    suspend fun archiveConversation(conversationId: String) =
        withContext(Dispatchers.IO) {
            api.delete("/api/v1/assistant/conversations/$conversationId")
        }

    suspend fun providerConfig(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/ai/config") }

    suspend fun saveProviderConfig(input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.put("/api/v1/ai/config", JSONObject(input))
        }

    suspend fun testProvider(): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/ai/test") }

    /** Explicit discovery only; destination and secret are owned by saved server config. */
    suspend fun providerModels(): List<String> = withContext(Dispatchers.IO) {
        ProviderModels.decode(api.post("/api/v1/ai/models", timeoutMs = 70_000L))
    }

    // ── Merged Import Batches (protocol-v1.md) ──────────────────────────────

    private fun urlEncode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")

    suspend fun createImportBatch(
        conversationId: String,
        clientRequestId: String,
        files: List<Pair<String, ByteArray>>,
        analyse: Boolean = false,
    ): ImportBatch = withContext(Dispatchers.IO) {
        val filesArray = org.json.JSONArray()
        files.forEach { (fileName, bytes) ->
            filesArray.put(
                JSONObject()
                    .put("fileName", fileName)
                    .put("source", "auto")
                    .put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)),
            )
        }
        val body = buildImportBatchCreateBody(clientRequestId, filesArray, analyse)
        val resp = api.post("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches", body)
        parseOwnedImportBatch(resp, expectedConversationId = conversationId)
    }

    suspend fun getImportBatch(conversationId: String, batchId: String): ImportBatch = withContext(Dispatchers.IO) {
        val resp = api.get("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}")
        val batch = parseOwnedImportBatch(resp, expectedConversationId = conversationId, expectedBatchId = batchId)
        if (batch.status == "confirmed") {
            batch.copy(result = parseConfirmedImportBatchResult(resp, conversationId, batchId))
        } else {
            batch
        }
    }

    suspend fun getBatchRows(
        conversationId: String,
        batchId: String,
        limit: Int = 100,
        cursor: String? = null,
        filter: String? = null,
        includeVersion: Long? = null,
    ): ImportBatchRowsPage = withContext(Dispatchers.IO) {
        val params = mutableMapOf("limit" to limit.toString())
        if (!cursor.isNullOrBlank()) params["cursor"] = cursor
        if (!filter.isNullOrBlank()) params["filter"] = filter
        if (includeVersion != null) params["includeVersion"] = includeVersion.toString()
        val queryStr = params.map { "${urlEncode(it.key)}=${urlEncode(it.value)}" }.joinToString("&")
        val resp = api.get("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/rows?$queryStr")
        ImportBatchRowsPage.fromJson(resp).also { page ->
            require(page.batchId == batchId) { "Import batch rows response batchId does not match request" }
        }
    }

    suspend fun getBatchCategories(
        conversationId: String,
        batchId: String,
        includeVersion: Long? = null,
    ): ImportBatchCategoriesResponse = withContext(Dispatchers.IO) {
        val query = if (includeVersion != null) "?includeVersion=$includeVersion" else ""
        val resp = api.get("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/categories$query")
        ImportBatchCategoriesResponse.fromJson(resp).also { response ->
            require(response.batchId == batchId) { "Import batch categories response batchId does not match request" }
        }
    }

    suspend fun analyseImportBatch(
        conversationId: String,
        batchId: String,
        clientRequestId: String,
        files: List<Pair<Int, ByteArray>>,
    ): ImportBatch = withContext(Dispatchers.IO) {
        val filesArray = org.json.JSONArray()
        files.forEach { (fileIndex, bytes) ->
            filesArray.put(
                JSONObject()
                    .put("fileIndex", fileIndex)
                    .put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)),
            )
        }
        val body = JSONObject()
            .put("clientRequestId", clientRequestId)
            .put("files", filesArray)
        val resp = api.post("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/analyse", body)
        parseOwnedImportBatch(resp, expectedConversationId = conversationId, expectedBatchId = batchId)
    }

    suspend fun reviewImportBatch(
        conversationId: String,
        batchId: String,
        version: Long,
        analysisRevision: Long,
        viewRevision: String,
        selectedItemIds: List<String>,
        categoryAssignments: Map<String, CategoryAssignment>,
        noteOverrides: Map<String, String>,
        approvedCategories: List<ApprovedCategory>,
        conflictDecisions: List<ConflictDecision>,
    ): ReviewResponse = withContext(Dispatchers.IO) {
        val assignmentsObj = JSONObject()
        categoryAssignments.forEach { (k, v) -> assignmentsObj.put(k, v.toJson()) }

        val notesObj = JSONObject()
        noteOverrides.forEach { (k, v) -> notesObj.put(k, v) }

        val approvedArr = org.json.JSONArray()
        approvedCategories.forEach { approvedArr.put(it.toJson()) }

        val conflictArr = org.json.JSONArray()
        conflictDecisions.forEach { conflictArr.put(it.toJson()) }

        val body = JSONObject()
            .put("version", version)
            .put("analysisRevision", analysisRevision)
            .put("viewRevision", viewRevision)
            .put("selectedItemIds", org.json.JSONArray(selectedItemIds))
            .put("categoryAssignments", assignmentsObj)
            .put("noteOverrides", notesObj)
            .put("approvedCategories", approvedArr)
            .put("conflictDecisions", conflictArr)

        val resp = api.post("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/review", body)
        ReviewResponse.fromJson(resp).also { review ->
            require(review.version == version && review.analysisRevision == analysisRevision && review.viewRevision == viewRevision) {
                "Import review response does not match the requested snapshot"
            }
        }
    }

    suspend fun confirmImportBatch(
        conversationId: String,
        batchId: String,
        reviewToken: String,
        expectedVersion: Long,
        files: List<Pair<Int, ByteArray>>,
    ): ImportBatchResult = withContext(Dispatchers.IO) {
        val filesArr = org.json.JSONArray()
        files.forEach { (idx, bytes) ->
            filesArr.put(
                JSONObject()
                    .put("fileIndex", idx)
                    .put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)),
            )
        }
        val body = JSONObject()
            .put("reviewToken", reviewToken)
            .put("expectedVersion", expectedVersion)
            .put("files", filesArr)

        val resp = api.post("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/confirm", body)
        parseConfirmedImportBatchResult(resp, expectedConversationId = conversationId, expectedBatchId = batchId)
    }

    suspend fun cancelImportBatch(
        conversationId: String,
        batchId: String,
        expectedVersion: Long,
        clientRequestId: String,
    ): ImportBatch = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("expectedVersion", expectedVersion)
            .put("clientRequestId", clientRequestId)
        val resp = api.post("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/cancel", body)
        parseOwnedImportBatch(resp, expectedConversationId = conversationId, expectedBatchId = batchId)
    }

    suspend fun removeBatchFile(
        conversationId: String,
        batchId: String,
        targetFileIndex: Int,
        expectedVersion: Long,
        clientRequestId: String,
        remainingFiles: List<Pair<String, ByteArray>>,
    ): MutationResult = withContext(Dispatchers.IO) {
        val filesArr = org.json.JSONArray()
        remainingFiles.forEach { (name, bytes) ->
            filesArr.put(
                JSONObject()
                    .put("fileName", name)
                    .put("source", "auto")
                    .put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)),
            )
        }
        val body = JSONObject()
            .put("expectedVersion", expectedVersion)
            .put("clientRequestId", clientRequestId)
            .put("targetFileIndex", targetFileIndex)
            .put("files", filesArr)
        val resp = api.post("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/files/$targetFileIndex/remove", body)
        MutationResult.fromJson(resp).also { result ->
            require(result.batch.conversationId == conversationId && result.batch.batchId == batchId) {
                "File removal response does not match the requested batch owner"
            }
        }
    }

    suspend fun replaceBatchFile(
        conversationId: String,
        batchId: String,
        targetFileIndex: Int,
        expectedVersion: Long,
        clientRequestId: String,
        allFiles: List<Pair<String, ByteArray>>,
    ): MutationResult = withContext(Dispatchers.IO) {
        val filesArr = org.json.JSONArray()
        allFiles.forEach { (name, bytes) ->
            filesArr.put(
                JSONObject()
                    .put("fileName", name)
                    .put("source", "auto")
                    .put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)),
            )
        }
        val body = JSONObject()
            .put("expectedVersion", expectedVersion)
            .put("clientRequestId", clientRequestId)
            .put("files", filesArr)
        val resp = api.post("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/files/$targetFileIndex/replace", body)
        MutationResult.fromJson(resp).also { result ->
            require(result.batch.conversationId == conversationId && result.batch.batchId == batchId) {
                "File replacement response does not match the requested batch owner"
            }
        }
    }

    suspend fun batchRowDuplicateCandidates(
        conversationId: String,
        batchId: String,
        itemId: String,
        cursor: String? = null,
    ): BatchRowDuplicatePage = withContext(Dispatchers.IO) {
        val query = if (cursor != null) "&cursor=${urlEncode(cursor)}" else ""
        val resp = api.get("/api/v1/assistant/conversations/${urlEncode(conversationId)}/import-batches/${urlEncode(batchId)}/rows/${urlEncode(itemId)}/duplicates?limit=20$query")
        BatchRowDuplicatePage.fromJson(resp).also { page ->
            require(page.sourceItemId == itemId) { "Duplicate comparison response does not match the requested source row" }
        }
    }
}
