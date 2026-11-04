package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.repo.FinancialGoalView
import com.yansuu1.jizhang.repo.FinancialOperationResult
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ManualGoalOperationReplayTest {

    private val scope = FinancialScope("https://example.test", "alice")

    private val dummyView = FinancialGoalView(
        contractVersion = 1,
        calculatedAt = 1000L,
        source = "manual-confirmed",
        revision = 1L,
        state = "ready",
        reserveOpening = null,
        investmentOpening = null,
        asOf = 1000L,
        reserveProgress = null,
        investmentProgress = null,
        window = null,
        entry = null,
    )

    private fun dummyViewJson(revision: Long = 1L): JSONObject = JSONObject().apply {
        put("contractVersion", 1)
        put("calculatedAt", 1000L)
        put("source", "manual-confirmed")
        put("revision", revision)
        put("state", "ready")
        put("progress", JSONObject().apply {
            put("asOf", 1000L)
        })
    }

    private class FakeStore : ManualGoalPendingOperationStore {
        val rows = linkedMapOf<String, PendingFinancialOperation>()
        val events = mutableListOf<String>()
        var throwOnRecord: Boolean = false

        override suspend fun record(scope: FinancialScope, operation: PendingFinancialOperation) {
            if (throwOnRecord) throw IllegalStateException("Store disk write failed")
            events.add("record:${operation.operationId}")
            rows[operation.operationId] = operation
        }

        override suspend fun remove(scope: FinancialScope, operationId: String) {
            events.add("remove:$operationId")
            rows.remove(operationId)
        }

        override fun list(scope: FinancialScope): List<PendingFinancialOperation> = rows.values.toList()
    }

    private class FakeGateway(private val defaultView: FinancialGoalView) : ManualGoalMutationGateway {
        val sent = mutableListOf<PendingFinancialOperation>()
        val events = mutableListOf<String>()
        var lookup: ((String) -> FinancialOperationResult)? = null
        var send: ((PendingFinancialOperation) -> FinancialGoalView)? = null
        var contractSupported: Boolean = true

        override suspend fun sendExact(operation: PendingFinancialOperation): FinancialGoalView {
            events.add("send:${operation.operationId}")
            sent.add(operation)
            return send?.invoke(operation) ?: defaultView
        }

        override suspend fun lookup(operationId: String): FinancialOperationResult =
            lookup?.invoke(operationId) ?: throw ApiException(404, "NOT_FOUND", "not found")

        override suspend fun checkContract(scope: FinancialScope): Boolean = contractSupported
    }

    @Test
    fun isSupportedManualGoalPathValidatesExpectedEndpoints() {
        assertTrue(isSupportedManualGoalPath("PUT", "/api/v1/financial-goals/opening"))
        assertTrue(isSupportedManualGoalPath("POST", "/api/v1/financial-goals/entries"))
        assertTrue(isSupportedManualGoalPath("PATCH", "/api/v1/financial-goals/entries/e1"))
        assertTrue(isSupportedManualGoalPath("DELETE", "/api/v1/financial-goals/entries/e1"))

        assertFalse(isSupportedManualGoalPath("GET", "/api/v1/financial-goals/opening"))
        assertFalse(isSupportedManualGoalPath("POST", "/api/v1/financial-goals/opening"))
        assertFalse(isSupportedManualGoalPath("PUT", "/api/v1/financial-goals/entries"))
        assertFalse(isSupportedManualGoalPath("PATCH", "/api/v1/financial-goals/entries/"))
        assertFalse(isSupportedManualGoalPath("POST", "/api/v1/salaries"))
        assertFalse(isSupportedManualGoalPath("DELETE", "/api/v1/other"))
    }

    @Test
    fun buildManualGoalOperationEncodesPayloadAndValidatesInput() {
        val body = JSONObject().apply {
            put("goal", "reserve")
            put("amountCents", 50000L)
            put("note", "特别备注：\"含引号\"与\n换行符")
        }
        val op = buildManualGoalOperation("POST", "/api/v1/financial-goals/entries", body, "op-goal-1", 5L)
        assertEquals("op-goal-1", op.operationId)
        assertEquals("POST", op.method)
        assertEquals("/api/v1/financial-goals/entries", op.path)
        assertEquals(5L, op.expectedRevision)

        val parsedPayload = JSONObject(op.payloadJson)
        assertEquals("op-goal-1", parsedPayload.getString("operationId"))
        assertEquals(5L, parsedPayload.getLong("expectedRevision"))
        assertEquals("特别备注：\"含引号\"与\n换行符", parsedPayload.getString("note"))

        assertThrows(IllegalArgumentException::class.java) {
            buildManualGoalOperation("GET", "/api/v1/financial-goals/entries", body, "op-1", 1L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            buildManualGoalOperation("POST", "/api/v1/financial-goals/entries", body, "", 1L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            buildManualGoalOperation("POST", "/api/v1/financial-goals/entries", body, "op-1", -1L)
        }
    }

    @Test
    fun fourOperationsParameterizationCoversCoreReplayInvariants() = runBlocking {
        data class OpFixture(val method: String, val path: String, val body: JSONObject)
        val fixtures = listOf(
            OpFixture("PUT", "/api/v1/financial-goals/opening", JSONObject().put("openingCents", 10000L).put("openingAt", 1000L)),
            OpFixture("POST", "/api/v1/financial-goals/entries", JSONObject().put("amountCents", 2000L).put("date", 1000L).put("note", "存入")),
            OpFixture("PATCH", "/api/v1/financial-goals/entries/entry-1", JSONObject().put("amountCents", 3000L).put("note", "更正")),
            OpFixture("DELETE", "/api/v1/financial-goals/entries/entry-1", JSONObject()),
        )

        for ((index, fix) in fixtures.withIndex()) {
            val opId = "test-op-$index"
            val operation = buildManualGoalOperation(fix.method, fix.path, fix.body, opId, 1L)

            // 1. 先持久化再发送 (Persist before send) & 成功清 pending
            val storeSuccess = FakeStore()
            val gatewaySuccess = FakeGateway(dummyView)
            val coordSuccess = ManualGoalReplayCoordinator(gatewaySuccess, storeSuccess) { scope }
            val outcomeSuccess = coordSuccess.submit(operation)
            assertTrue("提交应返回成功", outcomeSuccess is ManualGoalMutationOutcome.Success)
            assertEquals("应先持久化后发送", listOf("record:$opId", "remove:$opId"), storeSuccess.events)
            assertEquals(listOf("send:$opId"), gatewaySuccess.events)
            assertTrue("成功后 pending 应被移除", storeSuccess.rows.isEmpty())

            // 2. 存储失败零发送 (Store failure produces zero sends)
            val storeFail = FakeStore()
            storeFail.throwOnRecord = true
            val gatewayFail = FakeGateway(dummyView)
            val coordFail = ManualGoalReplayCoordinator(gatewayFail, storeFail) { scope }
            val outcomeFail = coordFail.submit(operation)
            assertTrue("存储失败应返回确定性失败", outcomeFail is ManualGoalMutationOutcome.DefinitiveFailure)
            assertEquals("存储失败不得发起网络发送", 0, gatewayFail.sent.size)

            // 3. 响应丢失保留 pending (Lost response retains pending row in store)
            val storeLost = FakeStore()
            val gatewayLost = FakeGateway(dummyView)
            gatewayLost.send = { throw IOException("Connection lost during send") }
            val coordLost = ManualGoalReplayCoordinator(gatewayLost, storeLost) { scope }
            val outcomeLost = coordLost.submit(operation)
            assertTrue("响应丢失应返回未知状态", outcomeLost is ManualGoalMutationOutcome.Unknown)
            assertEquals(1, storeLost.rows.size)
            assertEquals(opId, storeLost.rows[opId]?.operationId)

            // 4. 查到结果零重发 (Zero resends when lookup finds committed result)
            val storeLookupFound = FakeStore()
            storeLookupFound.rows[opId] = operation
            val gatewayLookupFound = FakeGateway(dummyView)
            gatewayLookupFound.lookup = {
                FinancialOperationResult(
                    operationId = opId,
                    method = fix.method,
                    resource = fix.path,
                    statusCode = 200,
                    response = dummyViewJson(2L),
                    committedAt = 1000L,
                )
            }
            val coordLookupFound = ManualGoalReplayCoordinator(gatewayLookupFound, storeLookupFound) { scope }
            val reportFound = coordLookupFound.recover()
            assertEquals("查到已入账结果时零发送", 0, gatewayLookupFound.sent.size)
            assertEquals(1, reportFound.recovered.size)
            assertEquals(2L, reportFound.recovered.first().revision)
            assertTrue("查到结果后 pending 记录已清除", storeLookupFound.rows.isEmpty())

            // 5. 确认支持合同的同作用域 404 才同键原载荷重发 (Replay on 404 only when contract is confirmed)
            val store404Replay = FakeStore()
            store404Replay.rows[opId] = operation
            val gateway404Replay = FakeGateway(dummyView)
            gateway404Replay.contractSupported = true
            gateway404Replay.lookup = { throw ApiException(404, "NOT_FOUND", "Operation not found") }
            val coord404Replay = ManualGoalReplayCoordinator(gateway404Replay, store404Replay) { scope }
            val report404 = coord404Replay.recover()
            assertEquals(1, gateway404Replay.sent.size)
            assertEquals(opId, gateway404Replay.sent.first().operationId)
            assertEquals(1, report404.recovered.size)
            assertTrue(store404Replay.rows.isEmpty())

            // 5b. 若合同未确认（能力不明/低版本服务端），404 不能当可重发，必须保留在 unresolved
            val store404Unsupported = FakeStore()
            store404Unsupported.rows[opId] = operation
            val gateway404Unsupported = FakeGateway(dummyView)
            gateway404Unsupported.contractSupported = false
            gateway404Unsupported.lookup = { throw ApiException(404, "NOT_FOUND", "Operation not found") }
            val coord404Unsupported = ManualGoalReplayCoordinator(gateway404Unsupported, store404Unsupported) { scope }
            val report404Unsupported = coord404Unsupported.recover()
            assertEquals("合同未确认时 404 不得自动重发", 0, gateway404Unsupported.sent.size)
            assertEquals(1, report404Unsupported.unresolved.size)
            assertEquals(opId, report404Unsupported.unresolved.first().operationId)

            // 6. 确定 400/409 结束失败记录 (Definitive rejection removes pending and reports failure)
            val store409 = FakeStore()
            store409.rows[opId] = operation
            val gateway409 = FakeGateway(dummyView)
            gateway409.lookup = { throw ApiException(409, "FINANCIAL_REVISION_CONFLICT", "版本冲突") }
            val coord409 = ManualGoalReplayCoordinator(gateway409, store409) { scope }
            val report409 = coord409.recover()
            assertEquals(0, gateway409.sent.size)
            assertEquals(1, report409.failures.size)
            assertTrue("409 确定性失败应清除本地 pending", store409.rows.isEmpty())

            // 7. 查询断网仍保留未知 (Network error during lookup preserves pending row)
            val storeNetErr = FakeStore()
            storeNetErr.rows[opId] = operation
            val gatewayNetErr = FakeGateway(dummyView)
            gatewayNetErr.lookup = { throw IOException("Lookup connection failure") }
            val coordNetErr = ManualGoalReplayCoordinator(gatewayNetErr, storeNetErr) { scope }
            val reportNetErr = coordNetErr.recover()
            assertEquals(0, gatewayNetErr.sent.size)
            assertEquals(1, reportNetErr.unresolved.size)
            assertEquals(opId, reportNetErr.unresolved.first().operationId)
            assertTrue("断网仍保留未知", storeNetErr.rows.containsKey(opId))
        }
    }

    @Test
    fun lostResponseRecoversExactQuotedNoteAfterRestart() = runBlocking {
        val testNotes = listOf(
            "Special \"quoted\" note with \n newline, \t tab and 'single quotes'",
            "",
            "普通备注：应急备用金存入",
        )

        for ((index, note) in testNotes.withIndex()) {
            val store = FakeStore()
            val gateway = FakeGateway(dummyView)
            val opId = "quoted-op-$index"

            val body = JSONObject().apply {
                put("goal", "reserve")
                put("kind", "deposit")
                put("amountCents", 50000L)
                put("date", 1000L)
                put("note", note)
            }
            val originalOp = buildManualGoalOperation("POST", "/api/v1/financial-goals/entries", body, opId, 3L)

            // 第一次提交：网络超时导致响应丢失
            gateway.send = { throw IOException("Response lost after server commit") }
            val coordinator1 = ManualGoalReplayCoordinator(gateway, store) { scope }
            val outcome1 = coordinator1.submit(originalOp)
            assertTrue(outcome1 is ManualGoalMutationOutcome.Unknown)
            assertTrue("pending 应保存在 store 中", store.rows.containsKey(opId))

            // 模拟应用重启：实例化全新 coordinator2 从持久化 store 恢复
            val gatewayAfterRestart = FakeGateway(dummyView)
            gatewayAfterRestart.contractSupported = true
            // 服务端实际已提交该操作
            gatewayAfterRestart.lookup = {
                FinancialOperationResult(
                    operationId = opId,
                    method = "POST",
                    resource = "/api/v1/financial-goals/entries",
                    statusCode = 201,
                    response = dummyViewJson(4L),
                    committedAt = 1000L,
                )
            }
            val coordinator2 = ManualGoalReplayCoordinator(gatewayAfterRestart, store) { scope }

            // 验证从 store 读取的原 operation 中 note、operationId、expectedRevision 保持一致
            val pendingFromStore = store.rows[opId]
            assertNotNull(pendingFromStore)
            val parsedFromStore = JSONObject(pendingFromStore!!.payloadJson)
            assertEquals("恢复后 JSON.note 必须与首次提交值严格相等", note, parsedFromStore.getString("note"))
            assertEquals("operationId 保持未变", opId, parsedFromStore.getString("operationId"))
            assertEquals("expectedRevision 保持未变", 3L, parsedFromStore.getLong("expectedRevision"))

            // 执行 recover()
            val report = coordinator2.recover()
            assertEquals("查到结果零重发", 0, gatewayAfterRestart.sent.size)
            assertEquals(1, report.recovered.size)
            assertEquals(4L, report.recovered.first().revision)
            assertTrue("恢复成功后 store pending 已清理", store.rows.isEmpty())
        }
    }

    @Test
    fun legacyOrCorruptedPendingOperationsNeverAutoReplay() = runBlocking {
        val corruptedFixtures = listOf(
            // JSON 语法损坏
            PendingFinancialOperation("op-corrupt", "POST", "/api/v1/financial-goals/entries", "{bad-json}"),
            // 缺少 expectedRevision 且无法从 payload 推断
            PendingFinancialOperation("op-no-rev", "POST", "/api/v1/financial-goals/entries", "{\"operationId\":\"op-no-rev\"}"),
            // operationId 冲突
            PendingFinancialOperation("op-conflict", "POST", "/api/v1/financial-goals/entries", "{\"operationId\":\"other-id\",\"expectedRevision\":1}"),
            // 不受支持的路径
            PendingFinancialOperation("op-bad-path", "POST", "/api/v1/salaries", "{\"operationId\":\"op-bad-path\",\"expectedRevision\":1}"),
        )

        for (bad in corruptedFixtures) {
            val store = FakeStore()
            store.rows[bad.operationId] = bad
            val gateway = FakeGateway(dummyView)
            val coordinator = ManualGoalReplayCoordinator(gateway, store) { scope }

            // 直接 retry 拒绝
            val retryOutcome = coordinator.retry(bad)
            assertTrue("损坏或冲突操作 retry 应返回 Unknown", retryOutcome is ManualGoalMutationOutcome.Unknown)
            assertEquals(0, gateway.sent.size)

            // recover 拒绝自动重发并放入 unresolved
            val report = coordinator.recover()
            assertEquals(0, gateway.sent.size)
            if (isSupportedManualGoalPath(bad.method, bad.path)) {
                assertTrue("目标域损坏操作必须留在 unresolved 供人工核对", report.unresolved.any { it.operationId == bad.operationId })
            } else {
                // Recovery intentionally scans only financial-goals records; unrelated legacy salary rows remain untouched.
                assertTrue("其他资源不应混入目标恢复扫描", report.unresolved.none { it.operationId == bad.operationId })
                assertTrue("其他资源待核对记录不得被自动删除", store.rows.containsKey(bad.operationId))
            }
            assertEquals(0, report.recovered.size)
        }
    }
}
