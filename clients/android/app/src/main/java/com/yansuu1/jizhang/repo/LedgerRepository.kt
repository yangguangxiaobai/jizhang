package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Shared JSON helpers. All repositories present server figures verbatim —
 * formatting (cents→yuan) lives in `ui/format.kt`; aggregation never happens here.
 */
internal fun JSONObject.optStr(key: String): String = optString(key, "")

internal fun JSONObject.toMap(): Map<String, Any?> {
    val out = mutableMapOf<String, Any?>()
    val keys = keys()
    while (keys.hasNext()) {
        val k = keys.next()
        out[k] = when (val v = opt(k)) {
            is JSONObject -> v.toMap()
            is org.json.JSONArray -> List(v.length()) { i ->
                (v.opt(i) as? JSONObject)?.toMap() ?: v.opt(i)
            }
            else -> v
        }
    }
    return out
}

internal fun queryOf(vararg pairs: Pair<String, Any?>): Map<String, String> =
    pairs.mapNotNull { (k, v) ->
        when (v) {
            null -> null
            "" -> null
            else -> k to v.toString()
        }
    }.toMap()

/** Ledger rows: transactions + transfers + trash (A3). Mirrors `api.transactions/transfers/trash`. */
class LedgerRepository(private val api: ApiClient) {
    // ── transactions ──
    suspend fun listTransactions(query: Map<String, String> = emptyMap()): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/transactions", query) }

    suspend fun getTransaction(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/transactions/$id") }

    suspend fun createTransaction(input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/transactions", JSONObject(input))
        }

    suspend fun updateTransaction(id: String, input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/transactions/$id", JSONObject(input))
        }

    suspend fun removeTransaction(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/transactions/$id") }

    // ── transfers (own table: neither income nor expense — server guarantees) ──
    suspend fun listTransfers(query: Map<String, String> = emptyMap()): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/transfers", query) }

    suspend fun createTransfer(input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.post("/api/v1/transfers", JSONObject(input))
        }

    suspend fun updateTransfer(id: String, input: Map<String, Any?>): JSONObject =
        withContext(Dispatchers.IO) {
            api.patch("/api/v1/transfers/$id", JSONObject(input))
        }

    suspend fun removeTransfer(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/transfers/$id") }

    // ── trash (transactions only) ──
    suspend fun listTrash(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/trash") }

    suspend fun restore(id: String): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/trash/$id/restore") }

    suspend fun purge(id: String) =
        withContext(Dispatchers.IO) { api.delete("/api/v1/trash/$id") }

    suspend fun restoreAll(): JSONObject =
        withContext(Dispatchers.IO) { api.post("/api/v1/trash/restore-all") }

    suspend fun purgeAll(): JSONObject =
        withContext(Dispatchers.IO) { api.delete("/api/v1/trash") }
}

/** Master data: categories / accounts / tags (A7 slice used by A3 editors). */
class MetaRepository(private val api: ApiClient) {
    suspend fun categories(type: Int? = null): JSONObject =
        withContext(Dispatchers.IO) {
            api.get("/api/v1/categories", queryOf("type" to type))
        }

    suspend fun accounts(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/accounts") }

    suspend fun balances(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/accounts/balances") }

    suspend fun tags(): JSONObject =
        withContext(Dispatchers.IO) { api.get("/api/v1/tags") }
}
