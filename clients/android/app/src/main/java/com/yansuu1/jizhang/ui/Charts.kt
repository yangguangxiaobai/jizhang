package com.yansuu1.jizhang.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import org.json.JSONObject

/**
 * 原生图表 (A6/A11). Hand-drawn Canvas (Web parity: hand-rolled SVG, no chart dep).
 * Slice/bar/trend colours come from the Web 12-slot category ladder
 * (`LocalWebTokens.cats`), so forest/mono presets + dark theme re-step them
 * exactly like the Web audit requires. All inputs are server figures.
 */

@Composable
fun DonutChart(slices: List<JSONObject>, totalCents: Long) {
    val tokens = LocalWebTokens.current
    // Positive wedges only: the donut cannot draw a negative slice (Web parity).
    val positive = slices.filter { it.optLong("amountCents") > 0 }
    val total = positive.sumOf { it.optLong("amountCents") }.takeIf { it > 0 } ?: 1L
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text("分类占比 · 共 ${formatYuan(totalCents)}", style = MaterialTheme.typography.titleSmall)
        Canvas(
            modifier = Modifier.fillMaxWidth().height(200.dp),
        ) {
            val diameter = size.minDimension * 0.8f
            val topLeft = Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
            var start = -90f
            for ((i, s) in positive.withIndex()) {
                val sweep = (s.optLong("amountCents").toFloat() / total.toFloat()) * 360f
                drawArc(
                    color = tokens.cats[i % tokens.cats.size],
                    startAngle = start,
                    sweepAngle = sweep,
                    useCenter = false,
                    topLeft = topLeft,
                    size = Size(diameter, diameter),
                    style = Stroke(width = diameter * 0.28f),
                )
                start += sweep
            }
        }
        for ((i, s) in positive.withIndex()) {
            val amt = s.optLong("amountCents")
            val pct = if (total == 0L) 0 else Math.round(amt.toFloat() / total.toFloat() * 100)
            Text(
                "● ${s.optString("categoryName")} ${formatYuan(amt)} ${pct}%",
                color = tokens.cats[i % tokens.cats.size],
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
fun MonthlyBars(points: List<JSONObject>) {
    val tokens = LocalWebTokens.current
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text("月度收入与净支出", style = MaterialTheme.typography.titleSmall)
        if (points.isEmpty()) {
            Text("暂无数据", style = MaterialTheme.typography.bodySmall)
            return@Column
        }
        // Income green = --ok, expense red = --danger (Web status hues stay shared
        // across presets, so "warning still means warning under a green accent").
        val incomeColor = tokens.ok
        val expenseColor = tokens.danger
        val maxV = points.maxOf { maxOf(it.optLong("incomeCents"), it.optLong("netExpenseCents")) }
            .coerceAtLeast(1L)
        Canvas(modifier = Modifier.fillMaxWidth().height(180.dp)) {
            val n = points.size
            val groupW = size.width / n
            val barW = groupW * 0.28f
            for ((i, p) in points.withIndex()) {
                val incomeH = (p.optLong("incomeCents").toFloat() / maxV.toFloat()) * size.height * 0.9f
                val expH = (p.optLong("netExpenseCents").toFloat() / maxV.toFloat()) * size.height * 0.9f
                val cx = i * groupW + groupW / 2
                drawRect(
                    color = incomeColor,
                    topLeft = Offset(cx - barW - 2, size.height - incomeH),
                    size = Size(barW, incomeH),
                )
                drawRect(
                    color = expenseColor,
                    topLeft = Offset(cx + 2, size.height - expH),
                    size = Size(barW, expH),
                )
            }
        }
        Text(
            points.joinToString(" · ") { "${it.optString("month")}" },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
fun PoolSparkline(points: List<JSONObject>) {
    val tokens = LocalWebTokens.current
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text("结余池趋势", style = MaterialTheme.typography.titleSmall)
        if (points.size < 2) {
            Text("数据不足，需至少两个周期", style = MaterialTheme.typography.bodySmall)
            return@Column
        }
        val values = points.map { it.optLong("poolCents") }
        var min = minOf(values.minOrNull() ?: 0L, 0L)
        var max = maxOf(values.maxOrNull() ?: 0L, 0L)
        if (min == max) max = min + 1
        Canvas(modifier = Modifier.fillMaxWidth().height(80.dp)) {
            val stepX = size.width / (values.size - 1)
            var prev: Offset? = null
            for ((i, v) in values.withIndex()) {
                val y = size.height - ((v - min).toFloat() / (max - min).toFloat()) * size.height
                val cur = Offset(i * stepX, y)
                if (prev != null) {
                    drawLine(tokens.accent, prev!!, cur, strokeWidth = 4f)
                }
                prev = cur
            }
        }
        Text(
            "最新 ${formatYuan(values.last())}",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/** Legacy palette alias (kept for callers not yet on tokens; same slot order). */
val ChartPalette: List<Color>
    @Composable
    get() = LocalWebTokens.current.cats

/** Layout helper: card padding parity is handled by callers' `JzCard`. */
@Composable
fun ChartSpacer() {
    Spacer(Modifier.height(8.dp))
}
