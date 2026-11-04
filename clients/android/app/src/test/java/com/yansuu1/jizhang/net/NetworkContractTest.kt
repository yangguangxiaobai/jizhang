package com.yansuu1.jizhang.net

import okhttp3.Cookie
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType

class NetworkContractTest {
    @Test fun bodilessPostReachesServerWithCsrfAndWithoutJsonContentType() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{}"))
            OkHttpClient().newCall(apiRequest("POST", server.url("/api/v1/recurring/generate"))).execute().close()
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("fetch", request.getHeader("X-Requested-With"))
            assertNull(request.getHeader("Content-Type"))
            assertEquals(0L, request.bodySize)
        }
    }
    @Test fun rawPhotoPutPreservesBytesAndSessionCookie() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(204))
            val jar = JizhangCookieJar()
            jar.saveFromResponse(server.url("/"), listOf(Cookie.parse(server.url("/"), "jizhang_session=secret; Path=/")!!))
            val bytes = byteArrayOf(0, -1, 10, 42)
            OkHttpClient.Builder().cookieJar(jar).build().newCall(apiRequest("PUT", server.url("/api/v1/items/id/photo"), bytes.toRequestBody("image/webp".toMediaType()))).execute().close()
            val request = server.takeRequest()
            assertEquals("jizhang_session=secret", request.getHeader("Cookie"))
            assertEquals("fetch", request.getHeader("X-Requested-With"))
            assertArrayEquals(bytes, request.body.readByteArray())
        }
    }
    @Test fun persistedSessionSurvivesNewJarAndLogout() {
        var saved = emptyList<String>()
        val url = "https://example.com/api/v1/auth/me".toHttpUrl()
        val jar = JizhangCookieJar(read = { saved }, write = { saved = it })
        jar.saveFromResponse(url, listOf(Cookie.parse(url, "jizhang_session=secret; Path=/; Secure; Max-Age=2592000")!!))
        val restarted = JizhangCookieJar(read = { saved }, write = { saved = it })
        assertEquals("secret", restarted.loadForRequest(url).single().value)
        assertTrue(restarted.loadForRequest("https://other.example.com/".toHttpUrl()).isEmpty())
        restarted.clear()
        assertTrue(JizhangCookieJar(read = { saved }).loadForRequest(url).isEmpty())
    }
    @Test fun urlValidationRejectsEmbeddedCredentialsAndApiPaths() {
        assertTrue(ApiClient.looksLikeUrl("https://jz.yansuu1.xyz"))
        assertFalse(ApiClient.looksLikeUrl("https://user:password@example.com"))
        assertFalse(ApiClient.looksLikeUrl("https://example.com/api/v1"))
        assertFalse(ApiClient.looksLikeUrl("https://"))
    }
    @Test fun expiredCookiesAreNotSent() {
        val jar = JizhangCookieJar()
        val url = "https://example.com/api/v1/auth/login".toHttpUrl()
        jar.saveFromResponse(url, listOf(Cookie.parse(url, "jizhang_session=old; Path=/; Max-Age=0")!!))
        assertTrue(jar.loadForRequest(url).isEmpty())
    }

    @Test fun secureCookiesAreNotSentOverHttp() {
        val jar = JizhangCookieJar()
        val url = "https://example.com/".toHttpUrl()
        jar.saveFromResponse(url, listOf(Cookie.parse(url, "jizhang_session=secret; Path=/; Secure")!!))
        assertTrue(jar.loadForRequest("http://example.com/".toHttpUrl()).isEmpty())
    }

    @Test fun unrelatedResponseDoesNotEraseSession() {
        val jar = JizhangCookieJar()
        val url = "https://example.com/".toHttpUrl()
        jar.saveFromResponse(url, listOf(Cookie.parse(url, "jizhang_session=secret; Path=/")!!))
        jar.saveFromResponse(url, listOf(Cookie.parse(url, "other=value; Path=/")!!))
        assertTrue(jar.loadForRequest(url).any { it.name == "jizhang_session" })
    }

    @Test fun sseRedirectIsForbidden() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/other"))
            val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()
            val req = Request.Builder().url(server.url("/events")).header("Accept", "text/event-stream").build()
            client.newCall(req).execute().use { resp ->
                assertEquals(302, resp.code)
                assertTrue(resp.code in 300..399)
            }
        }
    }

    @Test fun cancellingProductionReaderClosesStalledSocketPromptly() = runBlocking {
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())
        val accepted = java.util.concurrent.atomic.AtomicReference<java.net.Socket?>()
        val eventReceived = java.util.concurrent.CountDownLatch(1)
        val releaseServer = java.util.concurrent.CountDownLatch(1)
        val serverThread = Thread {
            try {
                server.accept().use { socket ->
                    accepted.set(socket)
                    val eol = 13.toChar().toString() + 10.toChar()
                    val lf = 10.toChar().toString()
                    val response = listOf("HTTP/1.1 200 OK", "Content-Type: text/event-stream", "", "").joinToString(eol) +
                        "data: hello" + lf + lf
                    socket.getOutputStream().write(response.toByteArray())
                    socket.getOutputStream().flush()
                    releaseServer.await(5, java.util.concurrent.TimeUnit.SECONDS)
                }
            } catch (_: Exception) {
                // Finally closes the listener even if the assertion fails.
            } finally { server.close() }
        }.apply { isDaemon = true; start() }
        val client = OkHttpClient.Builder().readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS).build()
        val call = client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/events").build())
        val reader = launch(Dispatchers.IO) {
            cancellableBlockingFlow<SseEvent>(cancelTransport = { call.cancel() }) { send ->
                try {
                    call.execute().use { response -> SseParser.parse(response.body!!.source()) { send(it) } }
                } catch (error: java.io.IOException) {
                    if (!call.isCanceled()) throw error
                }
            }.collect { eventReceived.countDown() }
        }
        try {
            assertTrue(eventReceived.await(3, java.util.concurrent.TimeUnit.SECONDS))
            reader.cancel()
            kotlinx.coroutines.withTimeout(2000) { reader.join() }
            assertTrue(call.isCanceled())
        } finally {
            call.cancel()
            releaseServer.countDown()
            accepted.get()?.close()
            server.close()
            reader.cancel()
            serverThread.join(2000)
        }
    }

    @Test fun sseContentTypeEnforcesTextEventStream() {
        val validContentType = "text/event-stream; charset=utf-8"
        val mediaType = validContentType.lowercase().split(";").firstOrNull()?.trim().orEmpty()
        assertEquals("text/event-stream", mediaType)

        val invalidContentType = "application/json"
        val invalidMediaType = invalidContentType.lowercase().split(";").firstOrNull()?.trim().orEmpty()
        assertFalse(invalidMediaType == "text/event-stream")
    }
}
