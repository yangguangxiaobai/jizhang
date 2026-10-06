package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.buttonColors(
            containerColor = t.accent,
            contentColor = t.onAccent,
            disabledContainerColor = t.accent.copy(alpha = 0.4f),
            disabledContentColor = t.onAccent.copy(alpha = 0.7f),
        ),
    ) {
        Text(text)
    }
}

@Composable
fun JzGhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = MaterialTheme.shapes.small,
    ) {
        Text(text)
    }
}
