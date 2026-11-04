package com.yansuu1.jizhang.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Fastfood
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocalHospital
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Pets
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.foundation.Canvas
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.ui.theme.LocalWebTokens

/**
 * 语义化图标映射：根据服务端类别 icon 字符串返回对应的精致 Material 图标
 */
fun categoryIconFor(semantic: String?): ImageVector = when (semantic?.lowercase()) {
    "food" -> Icons.Filled.Fastfood
    "transport" -> Icons.Filled.DirectionsCar
    "housing" -> Icons.Filled.Home
    "shopping" -> Icons.Filled.ShoppingBag
    "entertainment" -> Icons.Filled.SportsEsports
    "salary" -> Icons.Filled.Payments
    "medical" -> Icons.Filled.LocalHospital
    "education" -> Icons.Filled.School
    "pet", "pets" -> Icons.Filled.Pets
    "refund" -> Icons.AutoMirrored.Filled.Undo
    "work" -> Icons.Filled.Work
    else -> Icons.Filled.Category
}

/**
 * 设计图专属柔和配色映射：将分类对应到清新柔和的色调
 */
fun categoryThemeColor(semantic: String?, serverColor: Long?): Color {
    return Color(0xFFEAF0F1) // 对齐 Ardot 设计稿：统一浅灰青底色，清爽素雅
}

/**
 * 解析服务端带过来的 ARGB 颜色数值
 */
fun parseCategoryColor(colorLongOrInt: Long?, defaultColor: Color = Color(0xFF2F6F8F)): Color {
    if (colorLongOrInt == null || colorLongOrInt == 0L) return defaultColor
    return Color(colorLongOrInt.toInt())
}

/**
 * 提取分类的单字代表字符（1:1 复刻 Ardot 极简单字瓷片：餐、交、购、房、工等）
 */
fun categoryCharFor(name: String?): String {
    if (name.isNullOrBlank()) return "账"
    val clean = name.trim()
    return when {
        clean.contains("餐") || clean.contains("饭") || clean.contains("吃") -> "餐"
        clean.contains("交") || clean.contains("车") || clean.contains("铁") || clean.contains("打车") -> "交"
        clean.contains("购") || clean.contains("买") || clean.contains("日用") -> "购"
        clean.contains("工") || clean.contains("薪") || clean.contains("收入") -> "工"
        clean.contains("房") || clean.contains("租") || clean.contains("住") -> "房"
        clean.contains("医") || clean.contains("药") -> "医"
        clean.contains("娱") || clean.contains("玩") || clean.contains("游戏") -> "娱"
        clean.contains("退") -> "退"
        clean.contains("转") -> "转"
        clean.length >= 2 -> clean.takeLast(1)
        else -> clean.take(1)
    }
}

/**
 * Ardot 规范分类瓷片（1:1 对齐 Ardot 7:131：浅青底 0xFFEAF0F1 + 11dp 微圆角 + 0xFF4B7682 单字或矢量）
 */
@Composable
fun FinanceCategoryIcon(
    iconName: String? = null,
    categoryName: String? = null,
    backgroundColor: Color = Color(0xFFEAF0F1),
    modifier: Modifier = Modifier,
    size: Dp = 38.dp,
    iconSize: Dp = 19.dp,
    tint: Color = Color(0xFF4B7682),
) {
    Box(
        modifier = modifier
            .size(size)
            .background(backgroundColor, RoundedCornerShape(11.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (!categoryName.isNullOrBlank()) {
            Text(
                text = categoryCharFor(categoryName),
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Bold,
                color = tint,
            )
        } else {
            Icon(
                imageVector = categoryIconFor(iconName),
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(iconSize),
            )
        }
    }
}

/**
 * 标准通用财务卡片 (对齐 Ardot 设计稿：纯白卡片、0xFFE7E4DC 细微边框、18dp 圆角)
 */
@Composable
fun FinanceCard(
    modifier: Modifier = Modifier,
    backgroundColor: Color = LocalWebTokens.current.surface,
    borderColor: Color = LocalWebTokens.current.border.copy(alpha = 0.8f),
    cornerRadius: Dp = 18.dp,
    contentPadding: Dp = 16.dp,
    elevation: Dp = 1.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = if (onClick != null) {
            modifier.clip(RoundedCornerShape(cornerRadius)).clickable(role = Role.Button, onClick = onClick)
        } else {
            modifier
        },
        shape = RoundedCornerShape(cornerRadius),
        colors = CardDefaults.cardColors(containerColor = backgroundColor),
        border = androidx.compose.foundation.BorderStroke(1.dp, borderColor),
        elevation = CardDefaults.cardElevation(defaultElevation = elevation),
    ) {
        Column(
            modifier = Modifier.padding(contentPadding),
            content = content,
        )
    }
}

/**
 * 带有等宽数字样式的财务金额组件，避免数值变化跳动
 */
@Composable
fun FinanceAmountText(
    amountText: String,
    modifier: Modifier = Modifier,
    color: Color = LocalWebTokens.current.fg,
    fontSize: Dp = 28.dp,
    fontWeight: FontWeight = FontWeight.Bold,
) {
    Text(
        text = amountText,
        modifier = modifier,
        color = color,
        fontSize = fontSize.value.sp,
        fontWeight = fontWeight,
        fontFamily = FontFamily.Monospace,
    )
}

/**
 * 区块标题栏：左侧粗体大标题，右侧可选操作文字 (如 "查看全部 ›")
 */
@Composable
fun FinanceSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    actionText: String? = null,
    onActionClick: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = LocalWebTokens.current.fg,
        )
        if (actionText != null && onActionClick != null) {
            Text(
                text = actionText,
                style = MaterialTheme.typography.bodyMedium,
                color = LocalWebTokens.current.accent,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button, onClick = onActionClick)
                    .padding(horizontal = 4.dp, vertical = 2.dp),
            )
        }
    }
}

/**
 * 列表行项目（1:1 对齐 Ardot 7:129：微圆角单字分类瓷片、精致字体阶梯、深色等宽金额）
 */
@Composable
fun FinanceTransactionListItem(
    title: String,
    subtitle: String,
    amountText: String,
    isIncome: Boolean,
    categoryIcon: String? = null,
    categoryColor: Color = Color(0xFFEAF0F1),
    timeText: String? = null,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 7.dp, horizontal = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FinanceCategoryIcon(
            iconName = categoryIcon,
            categoryName = title,
            backgroundColor = categoryColor,
            size = 36.dp,
            iconSize = 18.dp,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = title,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = LocalWebTokens.current.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                fontSize = 10.5.sp,
                color = LocalWebTokens.current.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = "${if (isIncome) "+" else "-"}$amountText",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = if (isIncome) LocalWebTokens.current.ok else LocalWebTokens.current.fg,
            )
            if (!timeText.isNullOrBlank()) {
                Text(
                    text = timeText,
                    fontSize = 10.sp,
                    color = LocalWebTokens.current.muted,
                )
            }
        }
    }
}

/**
 * 现代高质感护眼显隐图标 (Eye Toggle Icon)：
 * 细线条极简轻奢风，告别粗糙呆滞的系统默认 emoji
 */
@Composable
fun FinanceEyeToggleIcon(
    hidden: Boolean,
    modifier: Modifier = Modifier,
    tint: Color = Color.White.copy(alpha = 0.85f),
) {
    Canvas(modifier = modifier.size(20.dp)) {
        val w = size.width
        val h = size.height
        val strokeWidth = 1.6.dp.toPx()

        if (!hidden) {
            // 睁眼：优雅杏仁弧线 + 居中灵动眼眸
            val upperPath = Path().apply {
                moveTo(w * 0.1f, h * 0.5f)
                cubicTo(w * 0.35f, h * 0.18f, w * 0.65f, h * 0.18f, w * 0.9f, h * 0.5f)
            }
            val lowerPath = Path().apply {
                moveTo(w * 0.1f, h * 0.5f)
                cubicTo(w * 0.35f, h * 0.82f, w * 0.65f, h * 0.82f, w * 0.9f, h * 0.5f)
            }
            drawPath(
                path = upperPath,
                color = tint,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
            )
            drawPath(
                path = lowerPath,
                color = tint,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
            )
            // 瞳孔
            drawCircle(
                color = tint,
                radius = w * 0.16f,
                center = center,
            )
        } else {
            // 闭眼/隐藏：下弧线 + 优雅长斜杠划过
            val lowerPath = Path().apply {
                moveTo(w * 0.12f, h * 0.52f)
                cubicTo(w * 0.35f, h * 0.82f, w * 0.65f, h * 0.82f, w * 0.88f, h * 0.52f)
            }
            drawPath(
                path = lowerPath,
                color = tint,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
            )
            // 斜杠
            drawLine(
                color = tint,
                start = androidx.compose.ui.geometry.Offset(w * 0.18f, h * 0.2f),
                end = androidx.compose.ui.geometry.Offset(w * 0.82f, h * 0.8f),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round,
            )
        }
    }
}

/**
 * 现代极简 AI 微光智感图标 (AI Sparkle/Brain Icon)：
 * 由灵动十字星芒与四芒微光组成，充满现代科技与金融智慧美感
 */
@Composable
fun FinanceAiSparkleIcon(
    modifier: Modifier = Modifier,
    primaryColor: Color = Color(0xFF6366F1), // 优雅靛紫
    accentColor: Color = Color(0xFF38BDF8),  // 晨曦亮青
) {
    Canvas(modifier = modifier.size(24.dp)) {
        val w = size.width
        val h = size.height

        // 主星芒 (中心偏左下)
        val cx1 = w * 0.44f
        val cy1 = h * 0.56f
        val r1 = w * 0.38f
        val inner1 = w * 0.10f

        val star1 = Path().apply {
            moveTo(cx1, cy1 - r1)
            cubicTo(cx1, cy1 - inner1, cx1 + inner1, cy1, cx1 + r1, cy1)
            cubicTo(cx1 + inner1, cy1, cx1, cy1 + inner1, cx1, cy1 + r1)
            cubicTo(cx1, cy1 + inner1, cx1 - inner1, cy1, cx1 - r1, cy1)
            cubicTo(cx1 - inner1, cy1, cx1, cy1 - inner1, cx1, cy1 - r1)
            close()
        }
        drawPath(
            path = star1,
            brush = Brush.linearGradient(
                colors = listOf(primaryColor, accentColor),
                start = androidx.compose.ui.geometry.Offset(cx1 - r1, cy1 - r1),
                end = androidx.compose.ui.geometry.Offset(cx1 + r1, cy1 + r1),
            ),
        )

        // 伴随微光星 (右上角)
        val cx2 = w * 0.78f
        val cy2 = h * 0.24f
        val r2 = w * 0.20f
        val inner2 = w * 0.05f

        val star2 = Path().apply {
            moveTo(cx2, cy2 - r2)
            cubicTo(cx2, cy2 - inner2, cx2 + inner2, cy2, cx2 + r2, cy2)
            cubicTo(cx2 + inner2, cy2, cx2, cy2 + inner2, cx2, cy2 + r2)
            cubicTo(cx2, cy2 + inner2, cx2 - inner2, cy2, cx2 - r2, cy2)
            cubicTo(cx2 - inner2, cy2, cx2, cy2 - inner2, cx2, cy2 - r2)
            close()
        }
        drawPath(
            path = star2,
            brush = Brush.linearGradient(
                colors = listOf(accentColor, primaryColor),
                start = androidx.compose.ui.geometry.Offset(cx2 - r2, cy2 - r2),
                end = androidx.compose.ui.geometry.Offset(cx2 + r2, cy2 + r2),
            ),
        )
    }
}

/**
 * 现代金融用户头像徽标 (Finance User Avatar Badge)
 */
@Composable
fun FinanceUserAvatar(
    name: String,
    modifier: Modifier = Modifier,
    sizeDp: Dp = 52.dp,
) {
    Box(
        modifier = modifier
            .size(sizeDp)
            .background(
                brush = Brush.linearGradient(
                    colors = listOf(Color(0xFFFF9A9E), Color(0xFFFEE140)), // 温暖柔和的高阶落日渐变
                ),
                shape = CircleShape,
            )
            .border(2.dp, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(sizeDp * 0.52f)) {
            val w = size.width
            val h = size.height
            val color = Color.White
            // 头部
            drawCircle(
                color = color,
                radius = w * 0.26f,
                center = androidx.compose.ui.geometry.Offset(w * 0.5f, h * 0.30f),
            )
            // 身体弧线
            val body = Path().apply {
                moveTo(w * 0.12f, h * 0.95f)
                cubicTo(w * 0.15f, h * 0.65f, w * 0.85f, h * 0.65f, w * 0.88f, h * 0.95f)
                close()
            }
            drawPath(path = body, color = color)
        }
    }
}
@Composable
fun FinanceEmptyState(
    text: String,
    subtext: String? = null,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Filled.Category,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .background(LocalWebTokens.current.accentSubtle, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = LocalWebTokens.current.accent,
                modifier = Modifier.size(28.dp),
            )
        }
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            color = LocalWebTokens.current.fg,
            textAlign = TextAlign.Center,
        )
        if (subtext != null) {
            Text(
                text = subtext,
                style = MaterialTheme.typography.bodySmall,
                color = LocalWebTokens.current.muted,
                textAlign = TextAlign.Center,
            )
        }
    }
}
