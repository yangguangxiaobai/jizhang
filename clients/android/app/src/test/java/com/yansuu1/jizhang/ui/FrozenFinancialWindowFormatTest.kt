package com.yansuu1.jizhang.ui

import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class FrozenFinancialWindowFormatTest {

    @Test
    fun frozenShanghaiDatesDoNotFollowDeviceZone() {
        val originalZone = TimeZone.getDefault()
        try {
            // 2026-10-25 00:00:00 Asia/Shanghai -> 1792857600000L
            // 2026-11-25 00:00:00 Asia/Shanghai -> 1795536000000L
            val start = 1792857600000L
            val end = 1795536000000L
            val zoneId = "Asia/Shanghai"

            // Under UTC default device time zone
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
            val formattedUtc = formatFrozenFinancialWindow(start, end, zoneId)
            assertTrue("Must contain 2026-10-25", formattedUtc.contains("2026-10-25"))
            assertTrue("Must contain 2026-11-25", formattedUtc.contains("2026-11-25"))
            assertTrue("Must contain Asia/Shanghai", formattedUtc.contains("Asia/Shanghai"))
            assertTrue("Must contain 不含终点", formattedUtc.contains("不含终点"))

            // Under America/Los_Angeles default device time zone
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
            val formattedLa = formatFrozenFinancialWindow(start, end, zoneId)
            assertTrue("Must contain 2026-10-25 under Los Angeles", formattedLa.contains("2026-10-25"))
            assertTrue("Must contain 2026-11-25 under Los Angeles", formattedLa.contains("2026-11-25"))
            assertTrue("Must contain Asia/Shanghai under Los Angeles", formattedLa.contains("Asia/Shanghai"))
            assertTrue("Must contain 不含终点 under Los Angeles", formattedLa.contains("不含终点"))
        } finally {
            TimeZone.setDefault(originalZone)
        }
    }

    @Test
    fun frozenWindowFormatSupportsCrossYear() {
        val originalZone = TimeZone.getDefault()
        try {
            // 2026-12-25 00:00:00 Asia/Shanghai -> 1798128000000L
            // 2027-01-25 00:00:00 Asia/Shanghai -> 1800806400000L
            val start = 1798128000000L
            val end = 1800806400000L
            val zoneId = "Asia/Shanghai"

            TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
            val formatted = formatFrozenFinancialWindow(start, end, zoneId)
            assertTrue("Must contain 2026-12-25", formatted.contains("2026-12-25"))
            assertTrue("Must contain 2027-01-25", formatted.contains("2027-01-25"))
            assertTrue("Must contain Asia/Shanghai", formatted.contains("Asia/Shanghai"))
            assertTrue("Must contain 不含终点", formatted.contains("不含终点"))
        } finally {
            TimeZone.setDefault(originalZone)
        }
    }

    @Test
    fun invalidTimeZoneThrowsIllegalArgumentException() {
        assertThrows(IllegalArgumentException::class.java) {
            formatFrozenFinancialWindow(1792857600000L, 1795536000000L, "Invalid/TimeZone_DoesNotExist")
        }
    }

    @Test
    fun startNotBeforeEndThrowsIllegalArgumentException() {
        assertThrows(IllegalArgumentException::class.java) {
            formatFrozenFinancialWindow(1795536000000L, 1792857600000L, "Asia/Shanghai")
        }
        assertThrows(IllegalArgumentException::class.java) {
            formatFrozenFinancialWindow(1792857600000L, 1792857600000L, "Asia/Shanghai")
        }
    }
}
