package com.yansuu1.jizhang.ui

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.repo.AuthRepository
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.ThemePreference
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

private val THEME_KEY = stringPreferencesKey("theme_preference")
private val ACCENT_KEY = stringPreferencesKey("accent_preset")

/**
 * 我的 tab (A2+A7+A10): settings hub. Mirrors web `SettingsView` + `DataView` entry
 * points: each section swaps inline (single-activity shell, no deep-link router).
 * Trash / transfers / templates / recurring-rules / manage / items / settings
 * all live here, matching Web where they hang off 我的 (nav:'settings').
 *
 * NOTE: theme state lives in MainActivity (applied to JizhangTheme) and is passed
 * down; this tab only renders the controls via callbacks.
 */
@Composable
fun MyTab(
    api: ApiClient,
    auth: AuthRepository? = null,
    theme: ThemePreference,
    accent: AccentPreset,
    onTheme: (ThemePreference) -> Unit,
    onAccent: (AccentPreset) -> Unit,
    onAuthExpired: () -> Unit,
    onLoggedOut: () -> Unit = {},
) {
    var section by remember { mutableStateOf("home") }
    if (section != "home") {
        Column(Modifier.fillMaxSize()) {
            OutlinedButton(
                onClick = { section = "home" },
                modifier = Modifier.padding(16.dp),
            ) { Text("‹ 返回我的") }
            when (section) {
                "manage" -> ManageTab(api = api, onAuthExpired = onAuthExpired)
                "templates" -> TemplatesTab(api = api, onAuthExpired = onAuthExpired)
                "recurring" -> RecurringRulesTab(api = api, onAuthExpired = onAuthExpired)
                "transfers" -> TransfersTab(api = api, onAuthExpired = onAuthExpired)
                "trash" -> TrashTab(api = api, onAuthExpired = onAuthExpired)
                "data" -> DataTab(api = api, onAuthExpired = onAuthExpired)
                "items" -> ItemsTab(api = api, onAuthExpired = onAuthExpired)
                "settings" -> SettingsFull(
                    api = api,
                    auth = auth,
                    theme = theme,
                    accent = accent,
                    onTheme = onTheme,
                    onAccent = onAccent,
                    onLoggedOut = onLoggedOut,
                )
            }
        }
        return
    }
    Column(
        Modifier.fillMaxSize().padding(16.dp),
    ) {
        Text("我的", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        for ((key, label) in listOf(
            "settings" to "设置（外观/密码/周期起点）",
            "items" to "物品资产",
            "manage" to "分类与账户",
            "templates" to "分配模板",
            "recurring" to "周期账单规则",
            "transfers" to "转账",
            "trash" to "回收站",
            "data" to "数据导出与备份",
        )) {
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                OutlinedButton(
                    onClick = { section = key },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(label) }
            }
        }
        Spacer(Modifier.height(16.dp))
        SettingsTab(auth = auth, onLogout = onLoggedOut)
    }
}

/** Read persisted theme prefs (called once from MainActivity). */
suspend fun readThemePrefs(context: Context): Pair<ThemePreference, AccentPreset> {
    return try {
        val p = context.appPrefs.data.first()
        val t = runCatching { ThemePreference.valueOf(p[THEME_KEY] ?: "System") }
            .getOrDefault(ThemePreference.System)
        val a = runCatching { AccentPreset.valueOf(p[ACCENT_KEY] ?: "Titanium") }
            .getOrDefault(AccentPreset.Titanium)
        t to a
    } catch (_: Exception) {
        ThemePreference.System to AccentPreset.Titanium
    }
}

/** Persist theme prefs (called from MainActivity callbacks). */
suspend fun writeThemePrefs(context: Context, theme: ThemePreference, accent: AccentPreset) {
    try {
        context.appPrefs.edit {
            it[THEME_KEY] = theme.name
            it[ACCENT_KEY] = accent.name
        }
    } catch (_: Exception) {
    }
}

/** Shared prefs accessor used by ApiClient-adjacent theme storage. */
val Context.appPrefs
    get() = com.yansuu1.jizhang.net.appPrefsOf(this)

/** Convenience: collect-once theme flow for previews/tests. */
fun themeLabels(): List<String> =
    ThemePreference.entries.map { it.label } + AccentPreset.entries.map { it.label }

@Suppress("UNUSED_PARAMETER")
fun consumeScope(scope: kotlinx.coroutines.CoroutineScope, block: () -> Unit = {}) {
    block()
}
