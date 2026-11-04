package com.yansuu1.jizhang.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlin.math.roundToInt
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.sqrt
import org.json.JSONObject

/**
 * Statistics charts render the server response as supplied. Ratios and coordinates
 * are used only for drawing; labels always show the original server amounts.
 */
@Composable
fun DonutChart(
    slices: List<JSONObject>,
    totalCents: Long,
    showChart: Boolean = true,
    onCategoryClick: ((JSONObject) -> Unit)? = null,
) {
    val tokens = LocalWebTokens.current
    val motion = LocalMotionTokens.current
    val visibleSlices = slices.filter { it.optLong("amountCents") > 0L }
    val geometryKey = remember(slices, totalCents) { Any() }
    var revealStarted by remember(geometryKey) { mutableStateOf(false) }
    var selectedCategoryId by remember(geometryKey) { mutableStateOf<String?>(null) }
    val reveal by animateFloatAsState(
        targetValue = if (revealStarted) 1f else 0f,
        animationSpec = tween(durationMillis = motion.slowMillis),
        label = "category-chart-reveal",
    )
    LaunchedEffect(geometryKey) { revealStarted = true }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "点选环形区查看数值；点击下方分类可打开同范围全部支出账单。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            "所选区间总额 ${formatYuan(totalCents)}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        AnimatedVisibility(
            visible = showChart,
            enter = fadeIn(tween(motion.quickMillis)),
            exit = fadeOut(tween(motion.quickMillis)),
        ) {
                if (visibleSlices.isEmpty() || totalCents <= 0L) {
                    ChartEmptyMessage("该区间没有可绘制的分类支出。")
                } else {
                    Canvas(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(188.dp)
                        .pointerInput(geometryKey, totalCents) {
                            detectTapGestures { tap ->
                                val diameter = minOf(size.width.toFloat(), size.height.toFloat()) * 0.82f
                                val centerX = size.width / 2f
                                val centerY = size.height / 2f
                                val dx = tap.x - centerX
                                val dy = tap.y - centerY
                                val radius = sqrt(dx * dx + dy * dy)
                                if (radius < diameter * 0.38f || radius > diameter * 0.62f || totalCents <= 0L) {
                                    return@detectTapGestures
                                }
                                val angle = (atan2(dy.toDouble(), dx.toDouble()) * 180.0 / PI + 450.0) % 360.0
                                var start = 0.0
                                for (slice in visibleSlices) {
                                    val sweep = slice.optLong("amountCents").toDouble() / totalCents.toDouble() * 360.0
                                    if (angle >= start && angle < start + sweep) {
                                        selectedCategoryId = slice.optString("categoryId").ifBlank {
                                            slice.optString("categoryName")
                                        }
                                        return@detectTapGestures
                                    }
                                    start += sweep
                                }
                            }
                        }
                            .semantics {
                                contentDescription = "分类占比环形图。详细金额可切换到明细查看。"
                            },
                    ) {
                        val diameter = size.minDimension * 0.82f
                        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
                        val stroke = Stroke(width = diameter * 0.24f)
                        drawArc(
                            color = tokens.surfaceSoft,
                            startAngle = -90f,
                            sweepAngle = 360f,
                            useCenter = false,
                            topLeft = topLeft,
                            size = Size(diameter, diameter),
                            style = stroke,
                        )

                        var startAngle = -90f
                        var remainingSweep = 360f * reveal
                        for ((index, slice) in visibleSlices.withIndex()) {
                            if (remainingSweep <= 0f) break
                            val fullSweep = (slice.optLong("amountCents").toDouble() / totalCents.toDouble() * 360.0)
                                .toFloat()
                                .coerceAtLeast(0f)
                            val sweep = minOf(fullSweep, remainingSweep)
                            if (sweep > 0f) {
                                drawArc(
                                    color = tokens.cats[index % tokens.cats.size],
                                    startAngle = startAngle,
                                    sweepAngle = sweep,
                                    useCenter = false,
                                    topLeft = topLeft,
                                    size = Size(diameter, diameter),
                                    style = stroke,
                                )
                            }
                            startAngle += fullSweep
                            remainingSweep -= sweep
                        }
                    }
                }
        }

        if (slices.isEmpty() && !showChart) {
            ChartEmptyMessage("所选区间没有分类记录。")
        } else if (slices.isNotEmpty()) {
            val legendItems = if (showChart) visibleSlices else slices
            legendItems.forEachIndexed { index, slice ->
                val amount = slice.optLong("amountCents")
                val percent = if (totalCents > 0L) {
                    "${(amount.toDouble() / totalCents.toDouble() * 100.0).roundToInt()}%"
                } else {
                    null
                }
                Row(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .clickable(enabled = onCategoryClick != null, role = androidx.compose.ui.semantics.Role.Button) { onCategoryClick?.invoke(slice) }
                        .padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(12.dp)
                            .background(tokens.cats[index % tokens.cats.size], CircleShape),
                    )
                    Text(
                        slice.optString("categoryName", "未分类"),
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium,
                        color = tokens.fg,
                    )
                    Text(
                        listOfNotNull(formatYuan(amount), percent).joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Medium,
                        color = tokens.fg,
                    )
                }
            }
        }

        val selectedSlice = visibleSlices.firstOrNull {
            val id = it.optString("categoryId").ifBlank { it.optString("categoryName") }
            id == selectedCategoryId
        }
        if (showChart) selectedSlice?.let { slice ->
            val percent = (slice.optLong("amountCents").toDouble() / totalCents.toDouble() * 100.0).roundToInt()
            Text(
                "${slice.optString("categoryName")} · ${formatYuan(slice.optLong("amountCents"))} · $percent%",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
fun MonthlyBars(points: List<JSONObject>, showChart: Boolean = true) {
    val tokens = LocalWebTokens.current
    val motion = LocalMotionTokens.current
    val geometryKey = remember(points) { Any() }
    var revealStarted by remember(geometryKey) { mutableStateOf(false) }
    var selectedIndex by remember(geometryKey) { mutableIntStateOf(-1) }
    val reveal by animateFloatAsState(
        targetValue = if (revealStarted) 1f else 0f,
        animationSpec = tween(durationMillis = motion.slowMillis),
        label = "monthly-chart-reveal",
    )
    LaunchedEffect(geometryKey) { revealStarted = true }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ChartLegend(tokens.ok, "收入")
            ChartLegend(tokens.danger, "支出")
        }
        Text(
            "点选柱形查看该月数值。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (points.isEmpty()) {
            ChartEmptyMessage("所选月数内没有收支趋势数据。")
            return@Column
        }

        if (points.isNotEmpty()) {
            AnimatedVisibility(
                visible = showChart,
                enter = fadeIn(tween(motion.quickMillis)),
                exit = fadeOut(tween(motion.quickMillis)),
            ) {
                val description = points.joinToString("；") {
                    "${it.optString("month")}，收入 ${formatYuan(it.optLong("incomeCents"))}，支出 ${formatYuan(it.optLong("netExpenseCents"))}"
                }
                Canvas(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(184.dp)
                        .pointerInput(geometryKey) {
                            detectTapGestures { tap ->
                                if (points.isNotEmpty() && size.width > 0) {
                                    selectedIndex = (tap.x / size.width * points.size)
                                        .toInt()
                                        .coerceIn(points.indices)
                                }
                            }
                        }
                        .semantics {
                            contentDescription = "月度收入与支出柱状图。$description"
                        },
                ) {
                    val incomeValues = points.map { it.optLong("incomeCents").toDouble() }
                    val expenseValues = points.map { it.optLong("netExpenseCents").toDouble() }
                    val allValues = incomeValues + expenseValues
                    var minValue = minOf(0.0, allValues.minOrNull() ?: 0.0)
                    var maxValue = maxOf(0.0, allValues.maxOrNull() ?: 0.0)
                    if (minValue == maxValue) {
                        minValue = -1.0
                        maxValue = 1.0
                    }
                    val plotTop = size.height * 0.06f
                    val plotHeight = size.height * 0.88f
                    val baseline = plotTop + ((maxValue / (maxValue - minValue)) * plotHeight).toFloat()
                    drawLine(
                        color = tokens.border,
                        start = Offset(0f, baseline),
                        end = Offset(size.width, baseline),
                        strokeWidth = 1.dp.toPx(),
                    )
                    val groupWidth = size.width / points.size
                    val barWidth = minOf(groupWidth * 0.25f, 16.dp.toPx()).coerceAtLeast(2.dp.toPx())

                    fun yFor(value: Double): Float =
                        plotTop + (((maxValue - value) / (maxValue - minValue)) * plotHeight).toFloat()

                    fun drawBar(value: Double, x: Float, color: Color) {
                        val valueY = yFor(value)
                        val fullHeight = kotlin.math.abs(baseline - valueY)
                        val height = fullHeight * reveal
                        val top = if (value >= 0.0) baseline - height else baseline
                        drawRect(
                            color = color,
                            topLeft = Offset(x, top),
                            size = Size(barWidth, height),
                        )
                    }

                    for (index in points.indices) {
                        val center = index * groupWidth + groupWidth / 2f
                        drawBar(incomeValues[index], center - barWidth - 1.dp.toPx(), tokens.ok)
                        drawBar(expenseValues[index], center + 1.dp.toPx(), tokens.danger)
                    }
                }
            }
            if (showChart && selectedIndex in points.indices) {
                val point = points[selectedIndex]
                Text(
                    "${point.optString("month")} · 收入 ${formatYuan(point.optLong("incomeCents"))} · 支出 ${formatYuan(point.optLong("netExpenseCents"))}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (showChart) Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                listOf(points.first(), points[points.lastIndex / 2], points.last())
                    .distinctBy { it.optString("month") }
                    .forEach { point ->
                        Text(point.optString("month"), style = MaterialTheme.typography.labelSmall)
                    }
            }
            if (showChart && points.all { it.optLong("incomeCents") == 0L && it.optLong("netExpenseCents") == 0L }) {
                ChartEmptyMessage("各月数值均为 0；明细中仍保留服务端返回的月份。")
            }
        }
        if (!showChart && points.isNotEmpty()) {
            points.forEach { point ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(point.optString("month"), style = MaterialTheme.typography.labelLarge)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(
                            "收入 ${formatYuan(point.optLong("incomeCents"))}",
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.ok,
                        )
                        Text(
                            "支出 ${formatYuan(point.optLong("netExpenseCents"))}",
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.danger,
                        )
                    }
                }
                optionalRefundIncomeCents(point)?.let { refund ->
                    Text("其中退款收入 ${formatYuan(refund)}（已计入收入）", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
fun PoolSparkline(points: List<JSONObject>, showChart: Boolean = true) {
    val tokens = LocalWebTokens.current
    val motion = LocalMotionTokens.current
    val geometryKey = remember(points) { Any() }
    var revealStarted by remember(geometryKey) { mutableStateOf(false) }
    var selectedIndex by remember(geometryKey) { mutableIntStateOf(-1) }
    val reveal by animateFloatAsState(
        targetValue = if (revealStarted) 1f else 0f,
        animationSpec = tween(durationMillis = motion.baseMillis),
        label = "pool-trend-reveal",
    )
    LaunchedEffect(geometryKey) { revealStarted = true }
    val values = remember(points) { points.map { it.optLong("poolCents") } }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "周期范围由服务端返回。点选折线查看周期金额；负结转按原值显示。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (points.isEmpty()) {
            ChartEmptyMessage("暂时没有结余池趋势数据。")
            return@Column
        }

        AnimatedVisibility(
            visible = showChart,
            enter = fadeIn(tween(motion.quickMillis)),
            exit = fadeOut(tween(motion.quickMillis)),
        ) {
            if (points.size < 2) {
                ChartEmptyMessage("目前只有一个周期，暂不足以绘制趋势线。")
            } else {
                    val description = points.joinToString("；") {
                        "${formatDay(it.optLong("periodStart"))}，${formatYuan(it.optLong("poolCents"))}"
                    }
                    Canvas(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(112.dp)
                            .pointerInput(geometryKey) {
                                detectTapGestures { tap ->
                                    if (points.isNotEmpty() && size.width > 0) {
                                        selectedIndex = (tap.x / size.width * points.size)
                                            .toInt()
                                            .coerceIn(points.indices)
                                    }
                                }
                            }
                            .semantics {
                                contentDescription = "结余池趋势线。周期与金额：$description"
                            },
                    ) {
                        val numeric = values.map { it.toDouble() }
                        var minValue = minOf(0.0, numeric.minOrNull() ?: 0.0)
                        var maxValue = maxOf(0.0, numeric.maxOrNull() ?: 0.0)
                        if (minValue == maxValue) {
                            minValue -= 1.0
                            maxValue += 1.0
                        }
                        val verticalInset = 8.dp.toPx()
                        val plotHeight = size.height - verticalInset * 2
                        val stepX = size.width / (values.size - 1)
                        fun pointAt(index: Int): Offset {
                            val y = verticalInset + ((maxValue - numeric[index]) / (maxValue - minValue) * plotHeight).toFloat()
                            return Offset(index * stepX, y)
                        }
                        if (minValue < 0.0 && maxValue > 0.0) {
                            val zeroY = verticalInset + (maxValue / (maxValue - minValue) * plotHeight).toFloat()
                            drawLine(
                                color = tokens.border,
                                start = Offset(0f, zeroY),
                                end = Offset(size.width, zeroY),
                                strokeWidth = 1.dp.toPx(),
                            )
                        }
                        val visibleSegmentCount = reveal * (values.size - 1)
                        for (index in 0 until values.lastIndex) {
                            val segmentProgress = (visibleSegmentCount - index).coerceIn(0f, 1f)
                            if (segmentProgress <= 0f) continue
                            val start = pointAt(index)
                            val next = pointAt(index + 1)
                            val end = Offset(
                                x = start.x + (next.x - start.x) * segmentProgress,
                                y = start.y + (next.y - start.y) * segmentProgress,
                            )
                            drawLine(
                                color = if (values[index] < 0L || values[index + 1] < 0L) tokens.danger else tokens.accent,
                                start = start,
                                end = end,
                                strokeWidth = 3.dp.toPx(),
                            )
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(formatDay(points.first().optLong("periodStart")), style = MaterialTheme.typography.labelSmall)
                        Text(formatDay(points.last().optLong("periodStart")), style = MaterialTheme.typography.labelSmall)
                    }
                    if (selectedIndex in points.indices) {
                        val point = points[selectedIndex]
                        val amount = point.optLong("poolCents")
                        Text(
                            "${formatDay(point.optLong("periodStart"))} · ${formatYuan(amount)}${if (amount < 0L) " · 负结转" else ""}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (amount < 0L) tokens.danger else MaterialTheme.colorScheme.primary,
                        )
                    }
            }
        }
        if (showChart) {
            val latest = values.last()
            Text(
                "最新 ${formatYuan(latest)}${if (latest < 0L) " · 负结转" else ""}",
                style = MaterialTheme.typography.bodyMedium,
                color = if (latest < 0L) tokens.danger else MaterialTheme.colorScheme.onSurface,
            )
        } else {
            points.forEach { point ->
                val amount = point.optLong("poolCents")
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(formatDay(point.optLong("periodStart")), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "${formatYuan(amount)}${if (amount < 0L) " · 负结转" else ""}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (amount < 0L) tokens.danger else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}

@Composable
private fun ChartLegend(color: Color, label: String) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).background(color, CircleShape))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun ChartEmptyMessage(message: String) {
    Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Legacy palette alias (kept for callers not yet on tokens; same slot order). */
val ChartPalette: List<Color>
    @Composable
    get() = LocalWebTokens.current.cats

/** Layout helper for chart sections hosted by older screens. */
@Composable
fun ChartSpacer() {
    Spacer(Modifier.height(8.dp))
}
