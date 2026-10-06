package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.StatsRepository
import java.util.Calendar
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 统计 tab (A6). Mirrors web `StatsView.vue`: window picker (本月/近30天/近3个月)
 * + months selector feed three server-computed series — no client aggregation.
 */
@Composable
fun StatsTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { StatsRepository(api) }
    var windowKind by remember { mutableStateOf("thisMonth") }
    var months by remember { mutableStateOf(6) }
    var shareItems by remember { mutableStateOf(listOf<JSONObject>()) }
    var shareTotal by remember { mutableStateOf(0L) }
    var trendPoints by remember { mutableStateOf(listOf<JSONObject>()) }
    var poolPoints by remember { mutableStateOf(listOf<JSONObject>()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        loading = true
        error = null
        try {
            val (from, to) = statsWindow(windowKind)
            val share = repo.categoryShare(from, to)
            val trend = repo.monthlyTrend(months)
            val pool = repo.poolTrend()
            val si = mutableListOf<JSONObject>()
            val sarr = share.optJSONArray("items")
            for (i in 0 until (sarr?.length() ?: 0)) si.add(sarr!!.optJSONObject(i))
            shareItems = si
            shareTotal = share.optLong("totalCents", si.sumOf { it.optLong("amountCents") })
            val tp = mutableListOf<JSONObject>()
            val tarr = trend.optJSONArray("items")
            for (i in 0 until (tarr?.length() ?: 0)) tp.add(tarr!!.optJSONObject(i))
            trendPoints = tp
            val pp = mutableListOf<JSONObject>()
            val parr = pool.optJSONArray("points")
            for (i in 0 until (parr?.length() ?: 0)) pp.add(parr!!.optJSONObject(i))
            poolPoints = pp
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(windowKind, months) {
        reload()
    }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text("统计", style = MaterialTheme.typography.titleLarge)
        Row {
            for ((k, label) in listOf("thisMonth" to "本月", "last30" to "近 30 天", "last3Months" to "近 3 个月")) {
                OutlinedButton(onClick = { windowKind = k }) {
                    Text(if (windowKind == k) "● $label" else label)
                }
            }
        }
        Row {
            for (m in listOf(3, 6, 12)) {
                OutlinedButton(onClick = { months = m }) {
                    Text(if (months == m) "● $m 个月" else "$m 个月")
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { scope.launch { reload() } }) { Text("重试") }
        } else {
            DonutChart(slices = shareItems, totalCents = shareTotal)
            MonthlyBars(points = trendPoints)
            PoolSparkline(points = poolPoints)
        }
    }
}

/** Web `windowFor` parity: [from, to) in local time. */
private fun statsWindow(kind: String): Pair<Long, Long> {
    val now = Calendar.getInstance()
    val endMonth = Calendar.getInstance()
    endMonth.set(Calendar.DAY_OF_MONTH, 1)
    endMonth.set(Calendar.HOUR_OF_DAY, 0)
    endMonth.set(Calendar.MINUTE, 0)
    endMonth.set(Calendar.SECOND, 0)
    endMonth.set(Calendar.MILLISECOND, 0)
    endMonth.add(Calendar.MONTH, 1)
    val to = endMonth.timeInMillis
    return when (kind) {
        "last30" -> now.timeInMillis - 30L * 86_400_000L to to
        "last3Months" -> {
            val from = Calendar.getInstance()
            from.set(Calendar.DAY_OF_MONTH, 1)
            from.set(Calendar.HOUR_OF_DAY, 0)
            from.set(Calendar.MINUTE, 0)
            from.set(Calendar.SECOND, 0)
            from.set(Calendar.MILLISECOND, 0)
            from.add(Calendar.MONTH, -2)
            from.timeInMillis to to
        }
        else -> {
            val from = Calendar.getInstance()
            from.set(Calendar.DAY_OF_MONTH, 1)
            from.set(Calendar.HOUR_OF_DAY, 0)
            from.set(Calendar.MINUTE, 0)
            from.set(Calendar.SECOND, 0)
            from.set(Calendar.MILLISECOND, 0)
            from.timeInMillis to to
        }
    }
}
