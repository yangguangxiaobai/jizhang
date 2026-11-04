package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

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
}
