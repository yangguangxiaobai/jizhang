package com.yansuu1.jizhang.launcher

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * PackageManager-backed component store. Only components that currently answer
 * MAIN/LAUNCHER are reported as launchable; declared-but-disabled aliases are
 * therefore never mistaken for the active desktop entry.
 */
class AndroidLauncherComponentStore(context: Context) : LauncherComponentStore {
    private val appContext = context.applicationContext
    private val packageManager = appContext.packageManager
    private val packageName = appContext.packageName

    override fun launchableAliases(): Set<String> {
        val intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(packageName)
        val activities = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                intent,
                PackageManager.ResolveInfoFlags.of(0L),
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(intent, 0)
        }
        return activities
            .mapNotNull { it.activityInfo?.name }
            .map { if (it.startsWith(".")) packageName + it else it }
            .filter { it.startsWith("$packageName.") }
            .toSet()
    }

    override fun setEnabled(aliasName: String, enabled: Boolean) {
        packageManager.setComponentEnabledSetting(
            ComponentName(packageName, aliasName),
            if (enabled) {
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            } else {
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            },
            PackageManager.DONT_KILL_APP,
        )
    }

    override fun setEnabledBatch(settings: List<LauncherComponentSetting>): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        val changes = settings.map { setting ->
            PackageManager.ComponentEnabledSetting(
                ComponentName(packageName, setting.aliasName),
                if (setting.enabled) {
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                } else {
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                },
                PackageManager.DONT_KILL_APP,
            )
        }
        packageManager.setComponentEnabledSettings(changes)
        return true
    }
}
