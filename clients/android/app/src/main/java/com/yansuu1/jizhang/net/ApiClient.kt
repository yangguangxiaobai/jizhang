package com.yansuu1.jizhang.net

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Network layer N1–N7 (parent design.md §2.1). Single choke point for every
 * `/api/v1/...` call: baseURL config, session cookie, CSRF header, error mapping.
 *
 * Rules enforced here (do NOT re-implement per repository):
 * - N1: baseURL is user-configured + remembered (DataStore), never hardcoded.
 * - N2: session cookie `jizhang_session` persisted via CookieJar; cleared on logout.
 * - N3: every mutating request carries `X-Requested-With: fetch` (login included).
 * - N4: bodiless POST sends NO `Content-Type` (Fastify 400s otherwise).
 * - N5: non-2xx becomes [ApiException] carrying the server `{error:{code,message}}`;
 *   HTTP 401 surfaces as [AuthExpiredException] so UI returns to login.
 * - N6: online-first — callers check [requireOnline] before writes; responses are
 *   never cached (`Cache-Control` is server `no-store`; no OkHttp cache installed).
 * - N7: exports/backups download through [download] with the session cookie;
 *   there is NO restore endpoint (CLI only) — show the command, don't invent one.
 */

private val Context.prefs by preferencesDataStore(name = "jizhang")

/** Shared prefs accessor (theme prefs reuse the same file). */
fun appPrefsOf(context: Context) = context.prefs

/** Thrown for any non-2xx API response. Mirrors web `ApiError{status,code,message}`. */
open class ApiException(
    val status: Int,
    val code: String,
    message: String,
) : Exception(message)

/** HTTP 401: session missing/expired — UI must route to login. Mirrors `isUnauthorized`. */
class AuthExpiredException(message: String = "登录已过期，请重新登录。") :
    ApiException(401, "UNAUTHORIZED", message)

/** Thrown when a write is attempted offline. Mirrors web `OfflineError`. */
class OfflineException(message: String = "需要联网才能记账。") : Exception(message)

private val BASE_URL_KEY = stringPreferencesKey("server_base_url")

class JizhangCookieJar : CookieJar {
    private val store: MutableMap<String, MutableList<Cookie>> = mutableMapOf()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        store[url.host] = cookies.toMutableList()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> =
        store[url.host].orEmpty()

    fun clear() = store.clear()
}

class ApiClient(private val context: Context) {
    private val cookieJar = JizhangCookieJar()
    private val http = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .build()

    // ── N1: baseURL ──────────────────────────────────────────────────────────
    suspend fun getBaseUrl(): String? =
        context.prefs.data.map { it[BASE_URL_KEY] }.first()

    suspend fun setBaseUrl(url: String) {
        val normalized = url.trim().trimEnd('/')
        require(normalized.startsWith("http://") || normalized.startsWith("https://")) {
            "服务端地址须以 http(s):// 开头"
        }
        context.prefs.edit { it[BASE_URL_KEY] = normalized }
    }

    private suspend fun requireBaseUrl(): String =
        getBaseUrl() ?: throw IllegalStateException("请先填写服务端地址")

    // ── HTTP verbs ───────────────────────────────────────────────────────────
    suspend fun get(path: String, query: Map<String, String> = emptyMap()): JSONObject =
        call("GET", path, query = query)

    suspend fun post(path: String, body: JSONObject? = null): JSONObject =
        call("POST", path, body = body)

    suspend fun patch(path: String, body: JSONObject): JSONObject =
        call("PATCH", path, body = body)

    suspend fun put(path: String, body: JSONObject): JSONObject =
        call("PUT", path, body = body)

    suspend fun delete(path: String): JSONObject =
        call("DELETE", path)

    /** Raw-bytes POST (platform-bill xlsx/GBK, item photos). Body sent verbatim. */
    suspend fun postBytes(path: String, contentType: String, bytes: ByteArray): JSONObject =
        call("POST", path, rawBody = contentType to bytes)

    /** Raw-text POST (CSV import as `text/csv`). */
    suspend fun postText(path: String, contentType: String, text: String): JSONObject =
        call("POST", path, rawBody = contentType to text.toByteArray(Charsets.UTF_8))

    /** File download with the session cookie (N7). Returns raw bytes; caller saves/shares. */
    suspend fun download(url: String): ByteArray {
        val base = requireBaseUrl()
        val full = if (url.startsWith("/")) base + url else url
        val req = Request.Builder().url(full).get().build()
        return http.newCall(req).execute().use { resp ->
            if (resp.code == 401) throw AuthExpiredException()
            if (!resp.isSuccessful) throw toApiException(resp.code, resp.body?.string().orEmpty())
            resp.body?.bytes() ?: ByteArray(0)
        }
    }

    fun clearSession() = cookieJar.clear()

    /** Session cookies as a `Cookie` header value (for the raw PUT uploader). */
    fun currentSessionCookie(): String =
        kotlinx.coroutines.runBlocking { getBaseUrl() }?.let { base ->
            try {
                val url = base.toHttpUrl()
                cookieJar.loadForRequest(url).joinToString("; ") { "${it.name}=${it.value}" }
            } catch (_: Exception) {
                ""
            }
        }.orEmpty()

    // ── internals ────────────────────────────────────────────────────────────
    private fun call(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
        rawBody: Pair<String, ByteArray>? = null,
    ): JSONObject {
        val base = kotlinx.coroutines.runBlocking { requireBaseUrl() }
        val urlBuilder = (base + path).toHttpUrl().newBuilder()
        for ((k, v) in query) {
            if (v.isEmpty()) continue
            urlBuilder.addQueryParameter(k, v)
        }
        val builder = Request.Builder().url(urlBuilder.build())
        val mutating = method != "GET"
        if (mutating) {
            // N3: CSRF second layer (login included).
            builder.header("X-Requested-With", "fetch")
        }
        when {
            rawBody != null -> {
                val (contentType, bytes) = rawBody
                builder.method(method, bytes.toRequestBody(contentType.toMediaType()))
            }
            body != null -> {
                builder.method(
                    method,
                    body.toString().toRequestBody("application/json".toMediaType()),
                )
            }
            // N4: bodiless mutating request — method with null body sends NO Content-Type.
            mutating -> builder.method(method, null)
            else -> builder.get()
        }
        // NOTE: callers must invoke from Dispatchers.IO; kept synchronous here so the
        // N3/N4 header contract stays in one readable place.
        return http.newCall(builder.build()).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (resp.code == 401) throw AuthExpiredException(readMessage(text))
            if (!resp.isSuccessful) throw toApiException(resp.code, text)
            if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun toApiException(status: Int, text: String): ApiException {
        return try {
            val err = JSONObject(text).optJSONObject("error")
            ApiException(
                status,
                err?.optString("code").orEmpty().ifEmpty { "REQUEST_ERROR" },
                err?.optString("message").orEmpty().ifEmpty { "请求失败（$status）" },
            )
        } catch (_: Exception) {
            ApiException(status, "REQUEST_ERROR", "请求失败（$status）")
        }
    }

    private fun readMessage(text: String): String {
        return try {
            JSONObject(text).optJSONObject("error")?.optString("message")
                .orEmpty().ifEmpty { "登录已过期，请重新登录。" }
        } catch (_: Exception) {
            "登录已过期，请重新登录。"
        }
    }

    companion object {
        /** Validate a candidate baseURL without storing it (login screen test button). */
        fun looksLikeUrl(candidate: String): Boolean {
            val t = candidate.trim()
            return t.startsWith("http://") || t.startsWith("https://")
        }
    }
}
