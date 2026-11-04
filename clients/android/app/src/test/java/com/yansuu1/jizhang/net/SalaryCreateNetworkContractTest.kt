package com.yansuu1.jizhang.net

import com.yansuu1.jizhang.ui.SalaryCreateRequest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class SalaryCreateNetworkContractTest {

    @Test
    fun salaryCreateReachesServerWithCsrfAndOperationIdInBody() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"id":"sal-01"}"""))
            val opId = "salary-op-mock-01"
            val req = SalaryCreateRequest.build(
                mapOf(
                    "amountCents" to 1000000L,
                    "date" to 1730000000000L,
                    "accountId" to "acc-test",
                ),
                opId,
            )

            val httpUrl = server.url(SalaryCreateRequest.PATH)
            val requestBody = req.payloadJson.toRequestBody("application/json; charset=utf-8".toMediaType())
            val httpRequest = apiRequest(SalaryCreateRequest.METHOD, httpUrl, requestBody)

            val client = OkHttpClient()
            client.newCall(httpRequest).execute().use { response ->
                assertEquals(201, response.code)
            }

            val recorded = server.takeRequest()
            assertEquals("POST", recorded.method)
            assertEquals("/api/v1/salaries", recorded.path)
            assertEquals("fetch", recorded.getHeader("X-Requested-With"))

            val bodyJson = JSONObject(recorded.body.readUtf8())
            assertEquals(opId, bodyJson.getString("operationId"))
            assertEquals(1000000L, bodyJson.getLong("amountCents"))
            assertEquals("acc-test", bodyJson.getString("accountId"))
        }
    }

    @Test
    fun salaryCreateRetriesSendIdenticalPayloadBytesAndKeys() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"internal"}"""))
            server.enqueue(MockResponse().setResponseCode(201).setBody("""{"id":"sal-01"}"""))

            val opId = "salary-op-retry-test"
            val req = SalaryCreateRequest.build(
                mapOf(
                    "amountCents" to 500000L,
                    "date" to 1730000000000L,
                    "accountId" to "acc-1",
                    "note" to "test salary",
                ),
                opId,
            )

            val client = OkHttpClient()
            val httpUrl = server.url(SalaryCreateRequest.PATH)

            // Attempt 1 (e.g. 500 failure)
            val req1 = apiRequest(
                SalaryCreateRequest.METHOD,
                httpUrl,
                req.payloadJson.toRequestBody("application/json; charset=utf-8".toMediaType()),
            )
            client.newCall(req1).execute().close()

            // Attempt 2 (retry with exact same request)
            val req2 = apiRequest(
                SalaryCreateRequest.METHOD,
                httpUrl,
                req.payloadJson.toRequestBody("application/json; charset=utf-8".toMediaType()),
            )
            client.newCall(req2).execute().close()

            val recorded1 = server.takeRequest()
            val recorded2 = server.takeRequest()

            val body1 = recorded1.body.readUtf8()
            val body2 = recorded2.body.readUtf8()

            assertEquals(body1, body2)
            val json1 = JSONObject(body1)
            val json2 = JSONObject(body2)
            assertEquals(opId, json1.getString("operationId"))
            assertEquals(opId, json2.getString("operationId"))
            assertEquals(500000L, json1.getLong("amountCents"))
            assertEquals(500000L, json2.getLong("amountCents"))
        }
    }
}
