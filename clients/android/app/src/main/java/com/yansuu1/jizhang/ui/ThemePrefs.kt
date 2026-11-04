package com.yansuu1.jizhang.ui

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.yansuu1.jizhang.net.appPrefsOf
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.ThemePreference
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val THEME_KEY = stringPreferencesKey("theme_preference")
private val ACCENT_KEY = stringPreferencesKey("accent_preset")
private val REDUCE_MOTION_KEY = booleanPreferencesKey("reduce_motion")

/** Local accessibility preference. Missing/corrupt values follow system motion. */
suspend fun readReduceMotionPref(context: Context): Boolean = try {
    appPrefsOf(context).data.first()[REDUCE_MOTION_KEY] ?: false
} catch (_: Exception) {
    false
}

/** Store only the user's explicit override; system animation scale is read separately. */
suspend fun writeReduceMotionPref(context: Context, reduced: Boolean) {
    appPrefsOf(context).edit { it[REDUCE_MOTION_KEY] = reduced }
}

/** Theme preference persistence (A10/A11). DataStore-backed like baseURL. */
suspend fun loadThemePrefs(prefs: androidx.datastore.core.DataStore<androidx.datastore.preferences.core.Preferences>): Pair<ThemePreference, AccentPreset> {
    val p = prefs.data.first()
    val theme = try {
        ThemePreference.valueOf(p[THEME_KEY] ?: "System")
    } catch (_: Exception) {
        ThemePreference.System
    }
    val accent = try {
        AccentPreset.valueOf(p[ACCENT_KEY] ?: "Titanium")
    } catch (_: Exception) {
        AccentPreset.Titanium
    }
    return theme to accent
}

suspend fun saveThemePrefs(
    prefs: androidx.datastore.core.DataStore<androidx.datastore.preferences.core.Preferences>,
    theme: ThemePreference,
    accent: AccentPreset,
) {
    prefs.edit {
        it[THEME_KEY] = theme.name
        it[ACCENT_KEY] = accent.name
    }
}

@Suppress("UNUSED_PARAMETER")
fun themeStore(context: Context) = Unit
