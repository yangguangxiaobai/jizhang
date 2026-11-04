package com.yansuu1.jizhang.ui.feature.assistant

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.repo.Clarification
import com.yansuu1.jizhang.repo.ClarificationOption
import com.yansuu1.jizhang.repo.GenerationError
import com.yansuu1.jizhang.ui.LocalMotionTokens
import com.yansuu1.jizhang.ui.theme.LocalWebTokens

/** Titanium Blue standard accent token (#2F6F8F) per Ardot design. */
val TitaniumBlue = Color(0xFF2F6F8F)

/**
 * Top status badge reflecting Ardot AI14–AI18 state labels.
 */
@Composable
fun StreamStatusBadge(
    state: StreamVisualState,
    delivery: String = "stream",
    modifier: Modifier = Modifier,
) {
    val t = LocalWebTokens.current
    val (text, dotColor, borderColor, bgColor) = when (state) {
        StreamVisualState.CONNECTING -> Quad(
            "● 连接中…",
            TitaniumBlue,
            TitaniumBlue.copy(alpha = 0.5f),
            TitaniumBlue.copy(alpha = 0.08f),
        )
        StreamVisualState.RECEIVING -> Quad(
            "● 实时流式响应",
            TitaniumBlue,
            TitaniumBlue.copy(alpha = 0.7f),
            TitaniumBlue.copy(alpha = 0.1f),
        )
        StreamVisualState.AWAITING_CHOICE -> Quad(
            "● 待确认分类追问",
            TitaniumBlue,
            TitaniumBlue.copy(alpha = 0.6f),
            TitaniumBlue.copy(alpha = 0.08f),
        )
        StreamVisualState.PENDING_FINANCIAL_CONFIRM -> Quad(
            "● 待核对记账草案",
            t.warning,
            t.warning.copy(alpha = 0.7f),
            t.warning.copy(alpha = 0.1f),
        )
        StreamVisualState.ANSWERED -> Quad(
            "● 回答已结束",
            TitaniumBlue,
            TitaniumBlue.copy(alpha = 0.5f),
            TitaniumBlue.copy(alpha = 0.08f),
        )
        StreamVisualState.FAILED -> Quad(
            "● 生成失败",
            t.danger,
            t.danger.copy(alpha = 0.6f),
            t.danger.copy(alpha = 0.08f),
        )
        StreamVisualState.CANCELLED -> Quad(
            "● 已停止生成",
            t.muted,
            t.border,
            t.surfaceSoft,
        )
        StreamVisualState.RECONCILE -> Quad(
            "● 连接中断 / 核对中",
            t.warning,
            t.warning.copy(alpha = 0.6f),
            t.warning.copy(alpha = 0.08f),
        )
    }

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(bgColor)
            .border(BorderStroke(0.5.dp, borderColor), RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            color = dotColor,
        )
        if (delivery == "buffered") {
            Spacer(Modifier.width(2.dp))
            Surface(
                shape = RoundedCornerShape(4.dp),
                color = t.surfaceSoft,
                border = BorderStroke(0.5.dp, t.border),
            ) {
                Text(
                    text = "完整回复模式",
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = t.muted,
                )
            }
        }
    }
}

private data class Quad<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

/**
 * Ardot AI14: Streaming growing bubble with dynamic indicator and Stop button.
 */
@Composable
fun StreamingGrowingBubble(
    text: String,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = LocalWebTokens.current
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = t.surface, contentColor = t.fg),
        border = BorderStroke(1.dp, TitaniumBlue.copy(alpha = 0.35f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Status capsule
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(TitaniumBlue.copy(alpha = 0.08f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "● 流式生成中 · 结构化草案",
                    style = MaterialTheme.typography.labelSmall,
                    color = TitaniumBlue,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            // Real-time dynamic progress bar
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth().height(3.dp),
                color = TitaniumBlue,
                trackColor = TitaniumBlue.copy(alpha = 0.15f),
            )

            // Streaming text
            Text(
                text = text.ifBlank { "正在生成回答…" },
                style = MaterialTheme.typography.bodyMedium,
                lineHeight = 22.sp,
                color = if (text.isBlank()) t.muted else t.fg,
            )

            // Objective notice
            Text(
                text = "流式生成过程中不向账本写入任何记录，生成完毕后需手动核对",
                style = MaterialTheme.typography.labelSmall,
                color = t.muted,
                lineHeight = 16.sp,
            )

            // Stop generation button (>= 48dp)
            OutlinedButton(
                onClick = onStop,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = t.danger,
                ),
                border = BorderStroke(1.dp, t.danger.copy(alpha = 0.4f)),
            ) {
                Text(
                    text = "停止生成 (保留已输出片段)",
                    fontWeight = FontWeight.Medium,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

/**
 * Ardot AI15: Single-select clarification choice card.
 * Options are >= 48dp in height, server-owned IDs, mutually exclusive,
 * duplicate-locked upon click, disabled when stale.
 */
@Composable
fun ClarificationCard(
    clarification: Clarification,
    isLive: Boolean,
    selectedOptionId: String?,
    onSelectOption: (ClarificationOption) -> Unit,
    modifier: Modifier = Modifier,
    allowRetrySelected: Boolean = false,
) {
    val t = LocalWebTokens.current
    val motion = LocalMotionTokens.current

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = t.surface, contentColor = t.fg),
        border = BorderStroke(1.dp, TitaniumBlue.copy(alpha = 0.35f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Card header badge
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(TitaniumBlue.copy(alpha = 0.08f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "● 待确认分类 · 请选择",
                    style = MaterialTheme.typography.labelSmall,
                    color = TitaniumBlue,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            // Question text
            Text(
                text = clarification.question,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = t.fg,
            )

            if (isLive && selectedOptionId != null && allowRetrySelected) {
                val selected = clarification.options.firstOrNull { it.id == selectedOptionId }
                if (selected != null) {
                    OutlinedButton(
                        onClick = { onSelectOption(selected) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text("核对此次选择（不重复创建请求）") }
                }
            }
            // Options list (2..6 items, each >= 48dp)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                clarification.options.forEach { option ->
                    val isSelected = selectedOptionId == option.id
                    val isEnabled = isLive && (selectedOptionId == null)

                    val interactionSource = remember { MutableInteractionSource() }
                    val pressed by interactionSource.collectIsPressedAsState()
                    val scale by animateFloatAsState(
                        targetValue = if (isEnabled && pressed && !motion.reduced) 0.98f else 1f,
                        animationSpec = tween(
                            durationMillis = motion.pressMillis,
                            easing = FastOutSlowInEasing,
                        ),
                        label = "option-press-${option.id}",
                    )

                    OutlinedButton(
                        onClick = {
                            if (isEnabled) onSelectOption(option)
                        },
                        enabled = isEnabled || isSelected,
                        interactionSource = interactionSource,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .graphicsLayer {
                                scaleX = scale
                                scaleY = scale
                            },
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (isSelected) TitaniumBlue.copy(alpha = 0.12f) else t.surface,
                            contentColor = if (isSelected) TitaniumBlue else t.fg,
                            disabledContainerColor = if (isSelected) TitaniumBlue.copy(alpha = 0.12f) else t.surfaceSoft.copy(alpha = 0.5f),
                            disabledContentColor = if (isSelected) TitaniumBlue else t.muted,
                        ),
                        border = BorderStroke(
                            1.dp,
                            if (isSelected) TitaniumBlue else t.border.copy(alpha = 0.8f),
                        ),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                text = option.label,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                            )
                            if (isSelected) {
                                Text(
                                    text = "✓ 已选择",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TitaniumBlue,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }
            }

            // Objective notice: option click is not ledger confirm
            Text(
                text = "点击选项仅作为对话补充输入，不会直接记入账本",
                style = MaterialTheme.typography.labelSmall,
                color = t.muted,
                lineHeight = 16.sp,
            )
        }
    }
}

/**
 * Ardot AI17: Answer finished independent visual signal box.
 * Physically distinct container explicitly clarifying no ledger booking occurred.
 */
@Composable
fun AnsweredSignalBox(
    modifier: Modifier = Modifier,
) {
    val t = LocalWebTokens.current
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = t.surfaceSoft.copy(alpha = 0.7f),
            contentColor = t.fg,
        ),
        border = BorderStroke(1.dp, t.border.copy(alpha = 0.6f)),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = "✓ 回答已结束 · 本轮未执行记账",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = TitaniumBlue,
                )
            }
            Text(
                text = "会话已回归待命就绪状态。本轮仅提供信息解答，未向账本写入任何记录。",
                style = MaterialTheme.typography.labelSmall,
                color = t.muted,
                lineHeight = 16.sp,
            )
        }
    }
}

/**
 * Ardot AI18: Reconcile / connection interrupted recovery card.
 * Clearly separates state reconciliation from model regeneration.
 */
@Composable
fun ReconcileAlertCard(
    partialSnippet: String,
    onReconnect: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = LocalWebTokens.current

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = t.surface, contentColor = t.fg),
        border = BorderStroke(1.dp, t.warning.copy(alpha = 0.4f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Badge
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(t.warning.copy(alpha = 0.1f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "● 连接中断 · 正在核对",
                    style = MaterialTheme.typography.labelSmall,
                    color = t.warning,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            // Received snippet display box
            if (partialSnippet.isNotBlank()) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = t.surfaceSoft,
                    border = BorderStroke(0.5.dp, t.border),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = "已收到片段（流式已暂停）：",
                            style = MaterialTheme.typography.labelSmall,
                            color = t.muted,
                        )
                        Text(
                            text = partialSnippet,
                            style = MaterialTheme.typography.bodySmall,
                            color = t.fg,
                        )
                    }
                }
            }

            // Core warning bar
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = t.warning.copy(alpha = 0.08f),
                border = BorderStroke(1.dp, t.warning.copy(alpha = 0.25f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "连接中断，正在核对服务端状态；已收到片段不是最终结果",
                    modifier = Modifier.padding(10.dp),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    color = t.warning,
                )
            }

            // Recovery mechanism explanation
            Text(
                text = "系统将尝试恢复同 generation 会话状态，不会重复调用模型。只有服务端明确返回终态失败后，方可显式重新生成",
                style = MaterialTheme.typography.labelSmall,
                color = t.muted,
                lineHeight = 16.sp,
            )

            // Action buttons (both >= 48dp)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onReconnect,
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = TitaniumBlue,
                        contentColor = Color.White,
                    ),
                ) {
                    Text("重新连接并核对状态", fontWeight = FontWeight.SemiBold)
                }
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .weight(0.7f)
                        .heightIn(min = 48.dp),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, t.border),
                ) {
                    Text("返回对话")
                }
            }
        }
    }
}

/**
 * Ardot AI14/AI16 failure display card.
 * Clearly surfaces error code/message and received provisional snippet so output does not vanish.
 */
@Composable
fun GenerationFailureCard(
    error: GenerationError?,
    partialSnippet: String,
    onRefresh: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = LocalWebTokens.current

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = t.surface, contentColor = t.fg),
        border = BorderStroke(1.dp, t.danger.copy(alpha = 0.4f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Header badge
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(t.danger.copy(alpha = 0.08f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "● 生成失败",
                    style = MaterialTheme.typography.labelSmall,
                    color = t.danger,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            // Error message
            val errMsg = error?.message?.ifBlank { "服务端生成失败" } ?: "服务端生成失败，未完成输出"
            Text(
                text = errMsg,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = t.danger,
            )

            // Provisional snippet if any was received before failure
            if (partialSnippet.isNotBlank()) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = t.surfaceSoft,
                    border = BorderStroke(0.5.dp, t.border),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = "失败前已输出片段：",
                            style = MaterialTheme.typography.labelSmall,
                            color = t.muted,
                        )
                        Text(
                            text = partialSnippet,
                            style = MaterialTheme.typography.bodySmall,
                            color = t.fg,
                        )
                    }
                }
            }

            // Integrity notice
            Text(
                text = "本轮生成未完成，未向账本写入任何记录。您可以刷新核对对话，或重新发起提问。",
                style = MaterialTheme.typography.labelSmall,
                color = t.muted,
                lineHeight = 16.sp,
            )

            // Actions (>= 48dp)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onRefresh,
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = TitaniumBlue,
                        contentColor = Color.White,
                    ),
                ) {
                    Text("刷新核对", fontWeight = FontWeight.SemiBold)
                }
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .weight(0.7f)
                        .heightIn(min = 48.dp),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, t.border),
                ) {
                    Text("关闭提示")
                }
            }
        }
    }
}

/**
 * Ardot cancelled display card when user clicks Stop button.
 * Preserves received partial output and explicitly affirms ledger safety.
 */
@Composable
fun GenerationCancelledCard(
    partialSnippet: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = LocalWebTokens.current

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = t.surface, contentColor = t.fg),
        border = BorderStroke(1.dp, t.border.copy(alpha = 0.6f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Header badge
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(t.surfaceSoft)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "● 已停止生成",
                    style = MaterialTheme.typography.labelSmall,
                    color = t.muted,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            // Output snippet
            if (partialSnippet.isNotBlank()) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = t.surfaceSoft,
                    border = BorderStroke(0.5.dp, t.border),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = "已保留停止前输出片段：",
                            style = MaterialTheme.typography.labelSmall,
                            color = t.muted,
                        )
                        Text(
                            text = partialSnippet,
                            style = MaterialTheme.typography.bodySmall,
                            color = t.fg,
                        )
                    }
                }
            }

            // Integrity notice
            Text(
                text = "已按要求停止流式生成。上述片段仅供参考，未向账本写入任何记录。",
                style = MaterialTheme.typography.labelSmall,
                color = t.muted,
                lineHeight = 16.sp,
            )

            OutlinedButton(
                onClick = onDismiss,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, t.border),
            ) {
                Text("返回对话")
            }
        }
    }
}

/**
 * Explicit footer card for pending financial confirm state.
 * Clarifies that draft proposals must be manually confirmed before ledger booking.
 */
@Composable
fun PendingFinancialBanner(
    modifier: Modifier = Modifier,
) {
    val t = LocalWebTokens.current

    Surface(
        shape = RoundedCornerShape(10.dp),
        color = t.warning.copy(alpha = 0.08f),
        border = BorderStroke(1.dp, t.warning.copy(alpha = 0.3f)),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = "● 待核对记账草案 · 需手动确认",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = t.warning,
                )
            }
            Text(
                text = "AI 已生成记账操作建议。请在下方卡片中仔细核对金额、分类及明细，手动点击确认后方可写入账本。系统绝不会自动入账。",
                style = MaterialTheme.typography.bodySmall,
                color = t.fg,
                lineHeight = 18.sp,
            )
        }
    }
}
