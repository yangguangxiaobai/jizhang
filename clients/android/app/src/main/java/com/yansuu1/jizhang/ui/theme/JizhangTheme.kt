package com.yansuu1.jizhang.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.ui.LocalMotionTokens
import com.yansuu1.jizhang.ui.MotionTokens

/**
 * Web token parity (`packages/web/src/styles/main.css`).
 *
 * Source values (light / dark), measured contrast floors per the CSS audit:
 * - 钛蓝 titanium: bg #f7f5f0, surface #ffffff, hero #244d60, accent #2f6f8f.
 * - 森林绿 forest: bg #f2f5ef, hero #294d3e, accent #2d6a4f.
 * - 极简黑白 mono: bg #f4f3f1, hero #30343a, accent #1c1f23.
 * - Dark: bg #131c22, surface #1e2127, hero #234353, accent #7fb6d3
 *   (forest-dark accent #74c69d, mono-dark accent #e8eaed).
 *
 * Rules mirrored here:
 * - hero card (`--hero` + `--on-hero`) is NOT the accent: the dark accent is too
 *   light for a card, so the balance card keeps its own deep tone in every theme.
 * - primary buttons use `--on-accent` on `--accent` (never hard-coded white).
 * - radii: card 1.15rem (~18dp), control 0.65rem (~10dp).
 */

/** Accent presets mirroring Web (`titanium` / `forest` / `mono`). */
enum class AccentPreset(val label: String) {
    Titanium("钛蓝"),
    Forest("森林绿"),
    Mono("极简黑白"),
}

enum class ThemePreference(val label: String) {
    System("跟随系统"),
    Light("浅色"),
    Dark("深色"),
}

/** Full Web token set for one (preset × dark) combination. */
@Immutable
data class WebTokens(
    val bg: Color,
    val surface: Color,
    val surfaceSoft: Color,
    val border: Color,
    val fg: Color,
    val muted: Color,
    val hero: Color,
    val onHero: Color,
    val heroMuted: Color,
    val heroDanger: Color,
    val accent: Color,
    val onAccent: Color,
    val accentSubtle: Color,
    val ok: Color,
    val warning: Color,
    val danger: Color,
    val dangerSubtle: Color,
    /** Twelve category slots, theme-stepped (dark values lifted for #1e2127). */
    val cats: List<Color>,
)

private fun tokens(
    bg: Long, surface: Long, surfaceSoft: Long, border: Long, fg: Long, muted: Long,
    hero: Long, accent: Long, onAccent: Long, accentSubtle: Long,
    ok: Long, warning: Long, danger: Long, dangerSubtle: Long,
    cats: List<Long>,
): WebTokens = WebTokens(
    bg = Color(bg), surface = Color(surface), surfaceSoft = Color(surfaceSoft),
    border = Color(border), fg = Color(fg), muted = Color(muted),
    hero = Color(hero), onHero = Color(0xFFFFFFFF),
    heroMuted = Color(0xFFD8E5E9), heroDanger = Color(0xFFFFD1CA),
    accent = Color(accent), onAccent = Color(onAccent), accentSubtle = Color(accentSubtle),
    ok = Color(ok), warning = Color(warning), danger = Color(danger),
    dangerSubtle = Color(dangerSubtle), cats = cats.map { Color(it) },
)

// Light slots == stored palette ints; dark slots re-stepped for the dark surface.
private val LIGHT_CATS = listOf(
    0xFF2A78D6, 0xFFD95D1E, 0xFF0F8F77, 0xFFB8860B, 0xFFD2497E, 0xFF178A17,
    0xFF6B4FD0, 0xFFD63A3A, 0xFF1A8BAB, 0xFFA85C1E, 0xFF9A3F8F, 0xFF6F8A10,
)
private val DARK_CATS = listOf(
    0xFF3987E5, 0xFFD95926, 0xFF199E70, 0xFFBF7F00, 0xFFD55181, 0xFF2F9E2F,
    0xFF8579E6, 0xFFE66767, 0xFF2394B8, 0xFFBF7A3D, 0xFFB85CAD, 0xFF7F9820,
)

private val TITANIUM_LIGHT = tokens(
    bg = 0xFFF7F5F0, surface = 0xFFFFFFFF, surfaceSoft = 0xFFFAF9F6,
    border = 0xFFE7E4DC, fg = 0xFF1D292E, muted = 0xFF748087,
    hero = 0xFF244D60, accent = 0xFF2F6F8F, onAccent = 0xFFFFFFFF, accentSubtle = 0xFFE7F0F4,
    ok = 0xFF2D8B68, warning = 0xFFD97706, danger = 0xFFB94A42, dangerSubtle = 0xFFFDF0ED,
    cats = LIGHT_CATS,
)
private val TITANIUM_DARK = tokens(
    bg = 0xFF131C22, surface = 0xFF1E2127, surfaceSoft = 0xFF252E35,
    border = 0xFF2F333B, fg = 0xFFE8EEF7, muted = 0xFF8B97A7,
    hero = 0xFF234353, accent = 0xFF7FB6D3, onAccent = 0xFF10151C, accentSubtle = 0xFF1D3545,
    ok = 0xFF3F9E6A, warning = 0xFFD97706, danger = 0xFFE05252, dangerSubtle = 0xFF352224,
    cats = DARK_CATS,
)
private val FOREST_LIGHT = TITANIUM_LIGHT.copy(
    bg = Color(0xFFF2F5EF), surfaceSoft = Color(0xFFF4F7F3),
    hero = Color(0xFF294D3E), accent = Color(0xFF2D6A4F),
    onAccent = Color(0xFFFFFFFF), accentSubtle = Color(0xFFE3F0E9),
)
private val FOREST_DARK = TITANIUM_DARK.copy(
    bg = Color(0xFF151D18), surfaceSoft = Color(0xFF263029),
    hero = Color(0xFF264737), accent = Color(0xFF74C69D),
    onAccent = Color(0xFF10151C), accentSubtle = Color(0xFF1D3328),
)
private val MONO_LIGHT = TITANIUM_LIGHT.copy(
    bg = Color(0xFFF4F3F1), surfaceSoft = Color(0xFFF7F6F4),
    hero = Color(0xFF30343A), accent = Color(0xFF1C1F23),
    onAccent = Color(0xFFFFFFFF), accentSubtle = Color(0xFFE9EBEE),
)
private val MONO_DARK = TITANIUM_DARK.copy(
    bg = Color(0xFF17191D), surfaceSoft = Color(0xFF292D33),
    hero = Color(0xFF32373F), accent = Color(0xFFE8EAED),
    onAccent = Color(0xFF10151C), accentSubtle = Color(0xFF2B2F36),
)

fun webTokens(preset: AccentPreset, dark: Boolean): WebTokens = when (preset) {
    AccentPreset.Titanium -> if (dark) TITANIUM_DARK else TITANIUM_LIGHT
    AccentPreset.Forest -> if (dark) FOREST_DARK else FOREST_LIGHT
    AccentPreset.Mono -> if (dark) MONO_DARK else MONO_LIGHT
}

val LocalWebTokens = staticCompositionLocalOf { TITANIUM_LIGHT }

val JizhangShapes = Shapes(
    small = RoundedCornerShape(12.dp), // controls/buttons 10–12dp (iOS style)
    medium = RoundedCornerShape(18.dp), // cards ~1.15rem = 18dp (iPhone Web style)
    large = RoundedCornerShape(20.dp),
)

/**
 * 精致紧凑型字体规范（针对个人财务 App 调优，避免原生 Material 字体过大过笨拙）
 */
val JizhangTypography = Typography(
    displayLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 40.sp),
    displayMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 34.sp),
    displaySmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 30.sp),
    headlineLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 28.sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 19.sp, lineHeight = 25.sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 23.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 12.5.sp, lineHeight = 17.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.Normal, fontSize = 11.5.sp, lineHeight = 15.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 15.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Normal, fontSize = 10.sp, lineHeight = 14.sp),
)

/**
 * Full theme entry (A10/A11). `preference` selects system/light/dark like Web's
 * three-state `data-theme`; `accent` picks one of the three presets. Material3
 * roles are derived from the Web tokens so every component follows the preset;
 * `LocalWebTokens` carries the full ladder (hero/cats/muted) for custom drawing.
 */
@Composable
fun JizhangTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    preference: ThemePreference = ThemePreference.System,
    accent: AccentPreset = AccentPreset.Titanium,
    reduceMotion: Boolean = false,
    content: @Composable () -> Unit,
) {
    val useDark = when (preference) {
        ThemePreference.System -> darkTheme
        ThemePreference.Light -> false
        ThemePreference.Dark -> true
    }
    val t = webTokens(accent, useDark)
    val motion = if (reduceMotion) MotionTokens.Reduced else MotionTokens.Default
    val colors = if (useDark) {
        darkColorScheme(
            primary = t.accent, onPrimary = t.onAccent,
            primaryContainer = t.accentSubtle, onPrimaryContainer = t.accent,
            secondary = t.accent, tertiary = t.ok,
            background = t.bg, onBackground = t.fg,
            surface = t.surface, onSurface = t.fg,
            surfaceVariant = t.surfaceSoft, onSurfaceVariant = t.muted,
            outline = t.border, error = t.danger,
            surfaceContainerHighest = t.surfaceSoft,
        )
    } else {
        lightColorScheme(
            primary = t.accent, onPrimary = t.onAccent,
            primaryContainer = t.accentSubtle, onPrimaryContainer = t.accent,
            secondary = t.accent, tertiary = t.ok,
            background = t.bg, onBackground = t.fg,
            surface = t.surface, onSurface = t.fg,
            surfaceVariant = t.surfaceSoft, onSurfaceVariant = t.muted,
            outline = t.border, error = t.danger,
            surfaceContainerHighest = t.surfaceSoft,
        )
    }
    androidx.compose.runtime.CompositionLocalProvider(
        LocalWebTokens provides t,
        LocalMotionTokens provides motion,
    ) {
        MaterialTheme(
            colorScheme = colors,
            shapes = JizhangShapes,
            typography = JizhangTypography,
            content = content,
        )
    }
}
