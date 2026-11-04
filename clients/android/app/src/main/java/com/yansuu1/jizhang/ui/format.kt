package com.yansuu1.jizhang.ui

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Display-only formatting (A3). Converts + labels; never aggregates.
 * Money stays integer cents until the final `formatYuan`; dates stay epoch ms
 * until the final label. Mirrors web `utils/money.ts` presentation role.
 */
fun formatYuan(cents: Long): String {
    val sign = if (cents < 0) "-" else ""
    val abs = kotlin.math.abs(cents)
    return "$sign${abs / 100}.${(abs % 100).toString().padStart(2, '0')}"
}

fun formatYuan(cents: Int): String = formatYuan(cents.toLong())

fun formatDay(epochMs: Long): String =
    SimpleDateFormat("M月d日", Locale.CHINA).format(Date(epochMs))

fun formatMonth(epochMs: Long): String =
    SimpleDateFormat("yyyy年M月", Locale.CHINA).format(Date(epochMs))

/** "仅显示X月" parity note: balances are all-time, lists are month views. */
fun monthOnlyNote(epochMs: Long): String = "仅显示${formatMonth(epochMs)}"

fun dateInput(epochMs: Long = System.currentTimeMillis()): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date(epochMs))

fun parseDateInput(text: String): Long {
    val format = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).apply { isLenient = false }
    val position = java.text.ParsePosition(0)
    val date = format.parse(text.trim(), position)
    require(date != null && position.index == text.trim().length) { "请填写有效日期（YYYY-MM-DD）" }
    return date.time
}

/**
 * Formats a frozen financial planning window using an explicit IANA time zone.
 * Displays start and exclusive end dates, the time zone identifier, and "（不含终点）".
 * Throws IllegalArgumentException if [timeZone] is invalid or if [start] >= [end].
 */
internal fun formatFrozenFinancialWindow(start: Long, end: Long, timeZone: String): String {
    val zoneId = try {
        java.time.ZoneId.of(timeZone)
    } catch (e: Exception) {
        throw IllegalArgumentException("Invalid time zone: $timeZone", e)
    }
    require(start < end) { "Window start must be before end" }
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
        this.timeZone = java.util.TimeZone.getTimeZone(zoneId)
    }
    val startDate = formatter.format(Date(start))
    val endDate = formatter.format(Date(end))
    return "$startDate — $endDate ($timeZone，不含终点)"
}

