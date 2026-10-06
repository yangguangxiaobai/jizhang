package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Items + cutout jobs (A10). Mirrors `api.items`:
 * - items CRUD/sell/retire/summary; ledger links never create bills.
 * - photo PUT goes through [ItemPhotoUploader] (PUT-bytes + session cookie);
 *   photo DELETE through ApiClient; photoUrl for display.
 * - cutout jobs: create (webp bytes) → poll → preview/cancel; service optional,
 *   ordinary upload always works.
 */
class ItemRepository(private val api: ApiClient) {
    private val photoUploader = ItemPhotoUploader(api)

    suspend fun list(query: Map<String, String> = emptyMap()): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/items", query) }

    suspend fun summary(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/items/summary") }

    suspend fun get(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/items/$id") }

    suspend fun create(input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/items", JSONObject(input))
        }

    suspend fun update(id: String, changes: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/items/$id", JSONObject(changes))
        }

    suspend fun remove(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/items/$id") }

    suspend fun sell(id: String, input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/items/$id/sell", JSONObject(input))
        }

    suspend fun retire(id: String, closedDate: Long): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/items/$id/retire", JSONObject().put("closedDate", closedDate))
        }

    fun photoUrl(baseUrl: String, id: String): String =
        "$baseUrl/api/v1/items/$id/photo"

    suspend fun uploadPhoto(
        baseUrl: String,
        id: String,
        contentType: String,
        bytes: ByteArray,
    ): Boolean = photoUploader.upload(
        baseUrl = baseUrl,
        sessionCookieHeader = photoUploader.sessionHeader(),
        itemId = id,
        contentType = contentType,
        bytes = bytes,
    )

    suspend fun removePhoto(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/items/$id/photo") }

    // ── cutout jobs ──
    suspend fun createCutoutJob(webpBytes: ByteArray): JSONObject =
        withContext(Dispatchers.IO) {
            api.postBytes("/api/v1/items/cutouts", "image/webp", webpBytes)
        }

    suspend fun getCutoutJob(jobId: String): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/items/cutouts/$jobId") }

    suspend fun cancelCutoutJob(jobId: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/items/cutouts/$jobId") }

    fun cutoutPreviewUrl(baseUrl: String, jobId: String, candidateId: String): String =
        "$baseUrl/api/v1/items/cutouts/$jobId/candidates/$candidateId/preview"

    suspend fun cutoutCandidateBytes(jobId: String, candidateId: String): ByteArray =
        withContext(Dispatchers.IO) {
            api.download("/api/v1/items/cutouts/$jobId/candidates/$candidateId/image")
        }
}
