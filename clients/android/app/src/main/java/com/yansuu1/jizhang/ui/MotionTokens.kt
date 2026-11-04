package com.yansuu1.jizhang.ui

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Durations shared by page and component transitions.
 *
 * The reduced policy uses zero duration so an interrupted or reduced-motion
 * transition always lands on its final pose immediately.
 */
@Immutable
data class MotionTokens(
    val pressMillis: Int = 90,
    val quickMillis: Int,
    val baseMillis: Int,
    val slowMillis: Int,
    val staggerMillis: Int,
    val reduced: Boolean,
) {
    companion object {
        val Default = MotionTokens(
            pressMillis = 90,
            quickMillis = 140,
            baseMillis = 220,
            slowMillis = 320,
            staggerMillis = 24,
            reduced = false,
        )

        val Reduced = MotionTokens(
            pressMillis = 0,
            quickMillis = 0,
            baseMillis = 0,
            slowMillis = 0,
            staggerMillis = 0,
            reduced = true,
        )
    }
}

val LocalMotionTokens = staticCompositionLocalOf { MotionTokens.Default }
