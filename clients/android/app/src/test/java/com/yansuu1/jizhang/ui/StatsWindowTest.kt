package com.yansuu1.jizhang.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StatsWindowTest {
    @Test fun rollingWindowKeepsBothServerInstantsAndZoneInCaption() {
        val from = java.time.OffsetDateTime.parse("2026-09-29T12:00:00+08:00").toInstant().toEpochMilli()
        val to = java.time.OffsetDateTime.parse("2026-10-29T12:00:00+08:00").toInstant().toEpochMilli()
        val window = decodeStatsWindow(JSONObject().put("kind", "last30").put("from", from).put("to", to)
            .put("timeZone", "Asia/Shanghai").put("label", "近30天").put("calculatedAt", to))
        assertEquals(from, window.from)
        assertEquals(to, window.to)
        assertEquals(30L * 86400000L, window.to - window.from)
        assertTrue(statsWindowCaption(window).contains("2026-10-29 12:00"))
        assertFalse(statsWindowCaption(window).contains("2026-11-01"))
    }

    @Test fun malformedWindowsAndRefundsFailRatherThanGuessing() {
        val valid = JSONObject("""{"kind":"month","from":1000,"to":2000,"timeZone":"Asia/Shanghai","label":"测试月","calculatedAt":3000}""")
        for (field in listOf("kind", "from", "to", "timeZone", "label", "calculatedAt")) {
            val missing = JSONObject(valid.toString()).apply { remove(field) }
            assertThrows(IllegalArgumentException::class.java) { decodeStatsWindow(missing) }
        }
        for (invalid in listOf(1.5, "1000", 9007199254740992L, JSONObject.NULL)) {
            assertThrows(IllegalArgumentException::class.java) { decodeStatsWindow(JSONObject(valid.toString()).put("from", invalid)) }
            assertThrows(IllegalArgumentException::class.java) { optionalRefundIncomeCents(JSONObject().put("refundIncomeCents", invalid)) }
        }
        assertNull(optionalRefundIncomeCents(JSONObject()))
        assertEquals(3000L, optionalRefundIncomeCents(JSONObject().put("refundIncomeCents", 3000)))
    }

    @Test fun crossYearTrendCaptionUsesServerMonthsNotDeviceClock() {
        val points = listOf("2026-12", "2027-01").map { JSONObject().put("month", it) }
        assertEquals("2026-12 至 2027-01 · 共 2 个月（服务端月序列）", monthlyTrendCaption(points))
        assertNull(parseStatsMonth("2026-13"))
        assertNull(parseStatsMonth("2026-1"))
    }

    @Test fun scopeChangeRejectsBothOldSuccessAndOldFailure() {
        for (failed in listOf(false, true)) {
            var scopeReads = 0
            val original = java.io.IOException("old user failure")
            val caught = assertThrows(IllegalStateException::class.java) {
                kotlinx.coroutines.runBlocking {
                    scopedStatsRead(
                        resolveScope = {
                            FinancialScope("https://ledger.example", if (++scopeReads == 1) "A" else "B")
                        },
                        read = {
                            if (failed) throw original
                            Unit
                        },
                    )
                }
            }
            assertTrue(caught.message.orEmpty().contains("认证作用域已变化"))
            assertEquals(2, scopeReads)
        }
    }

    @Test fun previousAttemptCannotPublishSuccessErrorOrFinallyAfterRefreshOrDisposal() {
        val owner = StatsReadOwner()
        val first = owner.start()
        val refreshed = owner.start()
        assertFalse(owner.owns(first))
        assertTrue(owner.owns(refreshed))
        owner.dispose()
        assertFalse(owner.owns(refreshed))
    }
}
