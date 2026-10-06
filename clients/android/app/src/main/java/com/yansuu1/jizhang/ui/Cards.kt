package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.ui.theme.LocalWebTokens

/**
 * Shared surfaces (A11). Web parity:
 * - `JzCard` = `.theme-card` (surface bg, border, 18dp radius, lift-1 shadow).
 * - `HeroCard` = dashboard asset card (`--hero` bg + `--on-hero` text, borderless).
 * - `JzPrimaryButton` lives in `Buttons.kt` (accent bg + `--on-accent` text).
 */
@Composable
fun JzCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val t = LocalWebTokens.current
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = t.surface, contentColor = t.fg),
        border = androidx.compose.foundation.BorderStroke(1.dp, t.border),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        content = { Column(Modifier.padding(18.dp), content = content) },
    )
}

@Composable
fun HeroCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val t = LocalWebTokens.current
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = t.hero, contentColor = t.onHero),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        content = { Column(Modifier.padding(20.dp), content = content) },
    )
}
