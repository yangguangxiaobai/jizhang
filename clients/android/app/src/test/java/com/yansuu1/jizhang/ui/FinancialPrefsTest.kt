package com.yansuu1.jizhang.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FinancialPrefsTest {

    @Test
    fun homeBudgetMode_wireMapping() {
        assertEquals(HomeBudgetMode.CATEGORY, HomeBudgetMode.fromWire("category"))
        assertEquals(HomeBudgetMode.PURPOSE, HomeBudgetMode.fromWire("purpose"))
        assertEquals(HomeBudgetMode.CATEGORY, HomeBudgetMode.fromWire(null))
        assertEquals(HomeBudgetMode.CATEGORY, HomeBudgetMode.fromWire("unknown_wire"))
        assertEquals(HomeBudgetMode.PURPOSE, HomeBudgetMode.fromWire("PURPOSE"))
    }

    @Test
    fun prefKeyForUser_scopingIsolationAndCaseSensitivity() {
        val key1 = FinancialPrefs.prefKeyForUser("http://server1.local:8080/api", "UserA")
        val key2 = FinancialPrefs.prefKeyForUser("http://server1.local:8080/api", "UserB")
        val key3 = FinancialPrefs.prefKeyForUser("http://server2.local:8080/api", "UserA")
        // Server URL host is normalized (case insensitive), path normalized without trailing slash
        val key1NormalizedHost = FinancialPrefs.prefKeyForUser("HTTP://SERVER1.LOCAL:8080/api/", "UserA")
        // Username is case sensitive
        val keyCaseUser = FinancialPrefs.prefKeyForUser("http://server1.local:8080/api", "usera")

        assertNotEquals(key1, key2)
        assertNotEquals(key1, key3)
        assertEquals(key1, key1NormalizedHost)
        assertNotEquals("用户名必须区分大小写", key1, keyCaseUser)
        assert(key1.startsWith("home_budget_mode_"))
    }

    @Test
    fun operationReplayStore_scopePrefixNoCollision() {
        // 防止 a vs a_b 前缀碰撞泄漏
        val prefixA = OperationReplayStore.prefixFor("http://srv.com", "a")
        val prefixAB = OperationReplayStore.prefixFor("http://srv.com", "a_b")
        val prefixB = OperationReplayStore.prefixFor("http://srv.com", "b")

        assertNotEquals(prefixA, prefixAB)
        assertNotEquals(prefixA, prefixB)
        assertFalse(prefixAB.startsWith(prefixA))
        assertFalse(prefixA.startsWith(prefixAB))
    }

    @Test
    fun pendingFinancialOperation_serializationRoundtrip() {
        val op = PendingFinancialOperation(
            operationId = "op-12345",
            method = "PUT",
            path = "/api/v1/financial-planning/config",
            payloadJson = "{\"enabled\":true}",
            expectedRevision = 4L,
            createdAt = 1700000000000L,
        )
        val jsonStr = op.toJson()
        val decoded = PendingFinancialOperation.fromJson(jsonStr)

        assertNotNull(decoded)
        assertEquals(op.operationId, decoded.operationId)
        assertEquals(op.method, decoded.method)
        assertEquals(op.path, decoded.path)
        assertEquals(op.payloadJson, decoded.payloadJson)
        assertEquals(op.expectedRevision, decoded.expectedRevision)
        assertEquals(op.createdAt, decoded.createdAt)
    }

    @Test
    fun pendingFinancialOperation_strictValidationRejectsCorrupt() {
        try {
            PendingFinancialOperation.fromJson("not-json")
            fail("应拒绝非法非 JSON 字符串")
        } catch (e: IllegalStateException) {
            assertFalse("异常信息不应暴露敏感 json 内容", e.message?.contains("not-json") ?: false)
        }

        try {
            PendingFinancialOperation.fromJson("{}")
            fail("应拒绝缺少必要字段的 JSON")
        } catch (_: IllegalArgumentException) {}
    }
}
