package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.repo.FinancialOperationResult
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SalaryOperationReplayTest {

    private val scope = FinancialScope("https://example.test", "alice")

    @Test
    fun buildIncludesOperationIdInActualJson() {
        val request = SalaryCreateRequest.build(mapOf("amountCents" to 1000000L), "salary-op-01")
        assertEquals("salary-op-01", JSONObject(request.payloadJson).getString("operationId"))

        val conflictRequest = SalaryCreateRequest.build(mapOf("amountCents" to 1000000L, "operationId" to "stale-key"), "salary-op-02")
        assertEquals("salary-op-02", JSONObject(conflictRequest.payloadJson).getString("operationId"))
    }

    @Test
    fun isSafelyKeyedSalaryOperationOnlyAcceptsMatchingPostSalariesJson() {
        assertTrue(isSafelyKeyedSalaryOperation(PendingFinancialOperation("op-1", "POST", "/api/v1/salaries", "{\"operationId\":\"op-1\"}")))
        assertFalse(isSafelyKeyedSalaryOperation(PendingFinancialOperation("op-1", "POST", "/api/v1/salaries", "{\"operationId\":\"op-2\"}")))
        assertFalse(isSafelyKeyedSalaryOperation(PendingFinancialOperation("op-1", "POST", "/api/v1/salaries", "{\"amountCents\":1000}")))
        assertFalse(isSafelyKeyedSalaryOperation(PendingFinancialOperation("op-1", "PUT", "/api/v1/salaries", "{\"operationId\":\"op-1\"}")))
        assertFalse(isSafelyKeyedSalaryOperation(PendingFinancialOperation("op-1", "POST", "/api/v1/salaries/1", "{\"operationId\":\"op-1\"}")))
        assertFalse(isSafelyKeyedSalaryOperation(PendingFinancialOperation("op-1", "POST", "/api/v1/salaries", "not-json")))
        assertFalse(isSafelyKeyedSalaryOperation(PendingFinancialOperation("op-1", "POST", "/api/v1/salaries", "{\"operationId\":\"\"}")))
    }

    @Test
    fun legacyUnkeyedPendingNeverAutoPosts() = runBlocking {
        val legacyFixtures = listOf(
            PendingFinancialOperation("op-no-key", "POST", "/api/v1/salaries", "{\"amountCents\":1000000}"),
            PendingFinancialOperation("op-mismatch", "POST", "/api/v1/salaries", "{\"amountCents\":1000000,\"operationId\":\"op-other\"}"),
            PendingFinancialOperation("op-corrupt", "POST", "/api/v1/salaries", "{corrupted-json}"),
        )

        for (legacy in legacyFixtures) {
            val store = FakeStore()
            val gateway = FakeGateway()
            store.rows[legacy.operationId] = legacy
            val coordinator = SalaryReplayCoordinator(gateway, store) { scope }

            // 1. Direct retry must not send anything and must keep pending in store
            val retryOutcome = coordinator.retry(legacy)
            assertTrue(retryOutcome is SalaryMutationOutcome.Unknown)
            assertEquals("Direct retry must not send any HTTP request", 0, gateway.sent.size)
            assertTrue("Direct retry must not delete pending row", store.rows.containsKey(legacy.operationId))

            // 2. Recover after restart must not send anything, must keep pending in store,
            // and must report it in both legacyUnkeyed and unresolved
            val report = coordinator.recover()
            assertEquals("Recover must not send any HTTP request", 0, gateway.sent.size)
            assertTrue("Recover must not delete pending row", store.rows.containsKey(legacy.operationId))
            assertTrue(report.legacyUnkeyed.any { it.operationId == legacy.operationId })
            assertTrue(report.unresolved.any { it.operationId == legacy.operationId })
            assertEquals(0, report.recovered.size)
        }
    }

    @Test
    fun salaryCreateFailsClosedWhenIdempotencyIsUnsupportedOrUnknown() {
        assertNull(salaryCreateCapabilityError(true))
        assertNotNull(salaryCreateCapabilityError(false))
        assertNotNull(salaryCreateCapabilityError(null))
    }

    private class FakeStore : SalaryPendingOperationStore {
        val rows = linkedMapOf<String, PendingFinancialOperation>()
        val events = mutableListOf<String>()

        override suspend fun record(scope: FinancialScope, operation: PendingFinancialOperation) {
            events.add("record:${operation.operationId}")
            rows[operation.operationId] = operation
        }

        override suspend fun remove(scope: FinancialScope, operationId: String) {
            events.add("remove:$operationId")
            rows.remove(operationId)
        }

        override fun list(scope: FinancialScope): List<PendingFinancialOperation> = rows.values.toList()
    }

    private class FakeGateway : SalaryMutationGateway {
        val sent = mutableListOf<PendingFinancialOperation>()
        var lookup: ((String) -> FinancialOperationResult)? = null
        var send: ((PendingFinancialOperation) -> JSONObject)? = null

        override suspend fun sendExact(operation: PendingFinancialOperation): JSONObject {
            sent.add(operation)
            return send?.invoke(operation) ?: JSONObject().put("id", "salary-1")
        }

        override suspend fun lookup(operationId: String): FinancialOperationResult =
            lookup?.invoke(operationId) ?: throw ApiException(404, "NOT_FOUND", "not found")
    }

    @Test
    fun createPersistsExactRequestBeforeSendAndUnknownRetryReusesTheSameKey() = runBlocking {
        val store = FakeStore()
        val gateway = FakeGateway()
        gateway.send = { throw IOException("timeout") }
        val coordinator = SalaryReplayCoordinator(gateway, store) { scope }
        val request = SalaryCreateRequest.build(mapOf("amountCents" to 10000L, "date" to 1L), "op-fixed")

        val first = coordinator.create(request)
        assertTrue(first is SalaryMutationOutcome.Unknown)
        assertEquals(1, store.rows.size)
        assertEquals("record:op-fixed", store.events.first())
        assertEquals("op-fixed", gateway.sent.single().operationId)

        // The next attempt after an unknown result must replay the same stored
        // operation/payload, not mint a new operationId.
        gateway.send = { JSONObject().put("id", "salary-1") }
        val retried = coordinator.retry(store.rows.values.single())
        assertTrue(retried is SalaryMutationOutcome.Success)
        assertEquals(2, gateway.sent.size)
        assertEquals(gateway.sent[0].operationId, gateway.sent[1].operationId)
        assertEquals(gateway.sent[0].payloadJson, gateway.sent[1].payloadJson)
        assertTrue(store.rows.isEmpty())
    }

    @Test
    fun definitiveFourHundredClearsPendingAndNeverRetriesAutomatically() = runBlocking {
        val store = FakeStore()
        val gateway = FakeGateway()
        gateway.send = { throw ApiException(400, "FINANCIAL_INVALID", "bad request") }
        val coordinator = SalaryReplayCoordinator(gateway, store) { scope }

        val outcome = coordinator.create(SalaryCreateRequest.build(mapOf("amountCents" to 1L), "op-bad"))
        assertTrue(outcome is SalaryMutationOutcome.DefinitiveFailure)
        assertTrue(store.rows.isEmpty())
        assertEquals(1, gateway.sent.size)
    }

    @Test
    fun recoverUsesGetOperationFirstAndDoesNotSendAgainWhenCommitted() = runBlocking {
        val store = FakeStore()
        val operation = PendingFinancialOperation("op-found", "POST", "/api/v1/salaries", "{\"amountCents\":1,\"operationId\":\"op-found\"}")
        store.rows[operation.operationId] = operation
        val gateway = FakeGateway()
        gateway.lookup = {
            FinancialOperationResult(
                operationId = it,
                method = "POST",
                resource = "/api/v1/salaries",
                statusCode = 201,
                response = JSONObject().put("id", "salary-found"),
                committedAt = 100L,
            )
        }
        val coordinator = SalaryReplayCoordinator(gateway, store) { scope }

        val report = coordinator.recover()
        assertEquals(1, report.recovered.size)
        assertEquals("salary-found", report.recovered.single().getString("id"))
        assertTrue(gateway.sent.isEmpty())
        assertTrue(store.rows.isEmpty())
    }

    @Test
    fun recoverReplaysExactRequestOnlyAfterAuthenticatedFourZeroFour() = runBlocking {
        val store = FakeStore()
        val operation = PendingFinancialOperation("op-replay", "POST", "/api/v1/salaries", "{\"amountCents\":2,\"operationId\":\"op-replay\"}")
        store.rows[operation.operationId] = operation
        val gateway = FakeGateway()
        gateway.lookup = { throw ApiException(404, "NOT_FOUND", "unknown") }
        gateway.send = { JSONObject().put("id", "salary-replayed") }
        val coordinator = SalaryReplayCoordinator(gateway, store) { scope }

        val report = coordinator.recover()
        assertEquals(1, report.recovered.size)
        assertEquals("salary-replayed", report.recovered.single().getString("id"))
        assertEquals(operation.operationId, gateway.sent.single().operationId)
        assertEquals(operation.payloadJson, gateway.sent.single().payloadJson)
        assertTrue(store.rows.isEmpty())
    }

    @Test
    fun unknownRecoveryKeepsThePendingRow() = runBlocking {
        val store = FakeStore()
        val operation = PendingFinancialOperation("op-unknown", "POST", "/api/v1/salaries", "{\"operationId\":\"op-unknown\"}")
        store.rows[operation.operationId] = operation
        val gateway = FakeGateway()
        gateway.lookup = { throw IllegalStateException("offline") }
        val coordinator = SalaryReplayCoordinator(gateway, store) { scope }

        val report = coordinator.recover()
        assertEquals(0, report.recovered.size)
        assertEquals(1, report.unresolved.size)
        assertEquals(operation.operationId, report.unresolved.single().operationId)
        assertTrue(store.rows.containsKey(operation.operationId))
        assertTrue(gateway.sent.isEmpty())
    }

    @Test
    fun unresolvedScopeBlocksTheWriteBeforeAnyPersistenceOrNetwork() = runBlocking {
        val store = FakeStore()
        val gateway = FakeGateway()
        val coordinator = SalaryReplayCoordinator(gateway, store) {
            throw IllegalStateException("auth/me 缺少 username")
        }

        val outcome = coordinator.create(SalaryCreateRequest.build(mapOf("amountCents" to 1L), "op-no-user"))
        assertTrue(outcome is SalaryMutationOutcome.DefinitiveFailure)
        assertTrue(store.rows.isEmpty())
        assertTrue(gateway.sent.isEmpty())
    }
}
