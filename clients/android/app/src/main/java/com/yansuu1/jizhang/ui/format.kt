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
