package com.yansuu1.jizhang.repo

import com.yansuu1.jizhang.net.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Item photo upload over raw PUT (A10). The generic ApiClient covers POST/PUT-JSON
 * and POST-bytes; item photos need PUT-bytes, so this small helper owns the one
 * HttpURLConnection with the session cookie + CSRF header (N2/N3 parity).
 */
class ItemPhotoUploader(private val api: ApiClient) {
    suspend fun upload(
        baseUrl: String,
        sessionCookieHeader: String,
        itemId: String,
        contentType: String,
        bytes: ByteArray,
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = java.net.URL("$baseUrl/api/v1/items/$itemId/photo")
            val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "PUT"
                setRequestProperty("Content-Type", contentType)
                setRequestProperty("X-Requested-With", "fetch")
                if (sessionCookieHeader.isNotEmpty()) {
                    setRequestProperty("Cookie", sessionCookieHeader)
                }
                doOutput = true
                connectTimeout = 30000
                readTimeout = 60000
            }
            conn.outputStream.use { it.write(bytes) }
            val code = conn.responseCode
            conn.disconnect()
            code in 200..299
        } catch (_: Exception) {
            false
        }
    }

    /** Current session as a Cookie header value for the uploader above. */
    fun sessionHeader(): String = api.currentSessionCookie()
}
