package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import com.yansuu1.jizhang.ui.theme.LocalWebTokens

/**
 * Shared buttons (A11). Web parity (`.theme-button` + ghost):
 * - primary: `--accent` bg + `--on-accent` text (never hard-coded white — the
 *   dark accent is a light blue, white on it is unreadable per the CSS audit).
 * - ghost/destructive: outlined (danger has NO solid-text rung by design).
 */
@Composable
fun JzPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val t = LocalWebTokens.current
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val motion = LocalMotionTokens.current
    val scale by animateFloatAsState(
        targetValue = if (enabled && pressed && !motion.reduced) 0.97f else 1f,
        animationSpec = tween(
            durationMillis = motion.pressMillis,
            easing = FastOutSlowInEasing,
        ),
        label = "primary-button-press",
    )
    Button(
        onClick = onClick,
        enabled = enabled,
        interactionSource = interactionSource,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 46.dp)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            },
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = t.accent,
            contentColor = t.onAccent,
            disabledContainerColor = t.accent.copy(alpha = 0.4f),
            disabledContentColor = t.onAccent.copy(alpha = 0.7f),
        ),
    ) {
        Text(text, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
    }
}

@Composable
fun JzGhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val t = LocalWebTokens.current
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val motion = LocalMotionTokens.current
    val scale by animateFloatAsState(
        targetValue = if (enabled && pressed && !motion.reduced) 0.97f else 1f,
        animationSpec = tween(
            durationMillis = motion.pressMillis,
            easing = FastOutSlowInEasing,
        ),
        label = "ghost-button-press",
    )
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        interactionSource = interactionSource,
        modifier = modifier
            .heightIn(min = 40.dp)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            },
        shape = RoundedCornerShape(10.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, t.accent.copy(alpha = 0.45f)),
    ) {
        Text(text, color = t.accent, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
    }
}
