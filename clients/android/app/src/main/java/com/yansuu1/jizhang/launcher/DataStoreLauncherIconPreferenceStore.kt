package com.yansuu1.jizhang.launcher

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import com.yansuu1.jizhang.net.appPrefsOf
import kotlinx.coroutines.flow.first

private val LAUNCHER_ICON_KEY = intPreferencesKey("launcher_icon_id")

/** Persists only the confirmed selection; malformed/legacy values are ignored. */
class DataStoreLauncherIconPreferenceStore(context: Context) : LauncherIconPreferenceStore {
    private val prefs = appPrefsOf(context.applicationContext)

    override suspend fun readSelectedId(): Int? =
        prefs.data.first()[LAUNCHER_ICON_KEY]?.takeIf { LauncherIcons.isValid(it) }

    override suspend fun writeSelectedId(id: Int) {
        prefs.edit { it[LAUNCHER_ICON_KEY] = id }
    }
}
