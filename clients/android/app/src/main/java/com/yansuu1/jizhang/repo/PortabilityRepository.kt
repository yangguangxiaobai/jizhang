package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Portability (A8). Mirrors `api.portability`:
 * - exports are cookie-authed downloads (N7), not JSON.
 * - app-CSV import posts raw `text/csv` (all-or-nothing, unknown names loud-fail).
 * - platform import posts JSON `{fileBase64, source, dryRun, fileName, selectedIds,
 *   categoryOverrides}`; GBK/xlsx bytes go up verbatim, server decodes.
 * - backups list/create; restore is CLI-only (no endpoint, by design).
 */
class PortabilityRepository(private val api: ApiClient) {
    fun exportUrl(what: String): String = "/api/v1/export/$what.csv"

    suspend fun downloadExport(what: String): ByteArray =
        withContext(Dispatchers.IO) { api.download(exportUrl(what)) }

    suspend fun importTransactionsCsv(csvText: String): JSONObject =
        withContext(Dispatchers.IO) {
            api.postText("/api/v1/import/transactions", "text/csv", csvText)
        }

    suspend fun importTransfersCsv(csvText: String): JSONObject =
        withContext(Dispatchers.IO) {
            api.postText("/api/v1/import/transfers", "text/csv", csvText)
        }

    suspend fun importPlatformBills(
        bytes: ByteArray,
        source: String = "auto",
        dryRun: Boolean = true,
        fileName: String? = null,
        selectedIds: List<String>? = null,
        categoryOverrides: Map<String, String> = emptyMap(),
    ): JSONObject = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("fileBase64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
            .put("source", source)
            .put("dryRun", dryRun)
        if (fileName != null) body.put("fileName", fileName)
        if (selectedIds == null) body.put("selectedIds", JSONObject.NULL)
        else body.put("selectedIds", org.json.JSONArray(selectedIds))
        body.put("categoryOverrides", JSONObject(categoryOverrides as Map<String, String>))
        api.post("/api/v1/import/platform-bills", body)
    }

    suspend fun listBackups(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/backups") }

    suspend fun createBackup(): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/backups") }
}
