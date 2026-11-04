package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.JsonNumberReaders
import com.yansuu1.jizhang.net.AuthExpiredException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.text.SimpleDateFormat
import java.time.ZoneId
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

/** The server owns both boundaries; unsupported servers must not use a device estimate. */
enum class StatsWindowKind(val wireValue: String) { MONTH("month"), LAST_30("last30") }

data class StatsWindow(
    val kind: StatsWindowKind,
    val from: Long,
    val to: Long,
    val timeZone: String,
    val label: String,
    val calculatedAt: Long,
)

fun parseStatsMonth(value: String): Pair<Int, Int>? {
    if (!Regex("[0-9]{4}-[0-9]{2}").matches(value)) return null
    val year = value.take(4).toInt()
    val month = value.takeLast(2).toInt()
    return if (year in 1..9999 && month in 1..12) year to month else null
}

fun statsMonthLabel(value: String): String {
    val (year, month) = parseStatsMonth(value) ?: return value
    return "${year}年${month}月"
}

fun decodeStatsWindow(response: JSONObject): StatsWindow {
    val kind = StatsWindowKind.entries.firstOrNull { it.wireValue == response.opt("kind") }
        ?: throw IllegalArgumentException("统计区间 kind 无效")
    val from = statsRequiredLong(response, "from")
    val to = statsRequiredLong(response, "to")
    require(from < to) { "统计区间起点必须早于终点" }
    val timeZone = statsRequiredText(response, "timeZone")
    ZoneId.of(timeZone)
    return StatsWindow(kind, from, to, timeZone, statsRequiredText(response, "label"), statsRequiredLong(response, "calculatedAt"))
}

fun statsWindowCaption(window: StatsWindow): String =
    "${formatStatsInstant(window.from, window.timeZone)} – ${formatStatsInstant(window.to, window.timeZone)}（不含终点）· ${window.timeZone} · 服务端区间"

private fun formatStatsInstant(epochMs: Long, zoneId: String): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT).apply {
        timeZone = TimeZone.getTimeZone(ZoneId.of(zoneId))
    }.format(Date(epochMs))

/** Caption comes from server month labels, not a device-calendar anchor. */
fun monthlyTrendCaption(points: List<JSONObject>): String {
    val months = points.map { statsRequiredText(it, "month").also { month -> require(parseStatsMonth(month) != null) } }
    require(months.isNotEmpty()) { "服务端未返回趋势月份" }
    return "${months.first()} 至 ${months.last()} · 共 ${months.size} 个月（服务端月序列）"
}

fun optionalRefundIncomeCents(container: JSONObject?): Long? {
    if (container == null || !container.has("refundIncomeCents")) return null
    return statsRequiredLong(container, "refundIncomeCents")
}

internal fun statsRequiredText(json: JSONObject, key: String): String =
    (json.opt(key) as? String)?.takeIf { it.isNotBlank() }
        ?: throw IllegalArgumentException("统计响应缺少字符串 $key")

internal fun statsRequiredLong(json: JSONObject, key: String, min: Long = 0): Long {
    val value = JsonNumberReaders.requireExactLong(json.opt(key), key)
    require(value in min..JsonNumberReaders.MAX_SAFE_INTEGER) { "统计字段 $key 超出安全整数范围" }
    return value
}

/** Rejects both success and failure from another authenticated server/user. */
internal suspend fun <T> scopedStatsRead(resolveScope: suspend () -> FinancialScope, read: suspend () -> T): T {
    val before = resolveScope()
    val candidate = try { Result.success(read())
    } catch (error: CancellationException) { throw error
    } catch (error: AuthExpiredException) { throw error
    } catch (error: Exception) { Result.failure(error) }
    currentCoroutineContext().ensureActive()
    val after = resolveScope()
    currentCoroutineContext().ensureActive()
    check(before == after) { "认证作用域已变化，已丢弃原范围的结果，请重新打开页面。" }
    return candidate.getOrThrow()
}

/** Distinguishes scopes before a new effect starts; late success/error/finally never owns a new attempt. */
internal class StatsReadOwner {
    data class Ticket(val generation: Long)
    private var generation = 0L
    private var active: Ticket? = null
    private var disposed = false
    fun start(): Ticket = Ticket(++generation).also { check(!disposed); active = it }
    fun owns(ticket: Ticket): Boolean = !disposed && ticket == active
    fun dispose() { disposed = true; active = null }
}
