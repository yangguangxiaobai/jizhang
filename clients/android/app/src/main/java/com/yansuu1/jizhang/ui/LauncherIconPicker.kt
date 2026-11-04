package com.yansuu1.jizhang.ui

import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.R
import com.yansuu1.jizhang.launcher.AndroidLauncherComponentStore
import com.yansuu1.jizhang.launcher.DataStoreLauncherIconPreferenceStore
import com.yansuu1.jizhang.launcher.LauncherIconController
import com.yansuu1.jizhang.launcher.LauncherIconSnapshot
import com.yansuu1.jizhang.launcher.LauncherIcons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class LauncherIconOption(
    val id: Int,
    val labelRes: Int,
    val previewRes: Int,
)

private val LAUNCHER_ICON_OPTIONS = listOf(
    LauncherIconOption(1, R.string.launcher_icon_option_1, R.drawable.ic_launcher_preview_1),
    LauncherIconOption(2, R.string.launcher_icon_option_2, R.drawable.ic_launcher_preview_2),
    LauncherIconOption(3, R.string.launcher_icon_option_3, R.drawable.ic_launcher_preview_3),
    LauncherIconOption(4, R.string.launcher_icon_option_4, R.drawable.ic_launcher_preview_4),
    LauncherIconOption(5, R.string.launcher_icon_option_5, R.drawable.ic_launcher_preview_5),
    LauncherIconOption(6, R.string.launcher_icon_option_6, R.drawable.ic_launcher_preview_6),
)

/**
 * Real component-state picker: the selected marker comes from
 * PackageManager's currently launchable alias, never from the stored
 * preference alone. A failed switch keeps the previous entry and reports it.
 */
@Composable
internal fun LauncherIconPicker() {
    val context = LocalContext.current.applicationContext
    val controller = remember(context) {
        LauncherIconController(
            packageName = context.packageName,
            componentStore = AndroidLauncherComponentStore(context),
            preferenceStore = DataStoreLauncherIconPreferenceStore(context),
            apiLevel = Build.VERSION.SDK_INT,
        )
    }
    var snapshot by remember { mutableStateOf<LauncherIconSnapshot?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var pendingId by remember { mutableStateOf<Int?>(null) }
    var loadAttempt by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(controller, loadAttempt) {
        loading = true
        try {
            snapshot = withContext(Dispatchers.IO) { controller.load() }
        } catch (e: Exception) {
            snapshot = LauncherIconSnapshot(
                activeId = null,
                selectedId = LauncherIcons.DEFAULT_ID,
                launchableIds = emptySet(),
                persistedId = null,
                error = "读取桌面图标状态失败：${e.message?.takeIf { it.isNotBlank() } ?: "请重试"}",
            )
        } finally {
            loading = false
        }
    }

    fun selectIcon(id: Int) {
        if (busy || loading) return
        pendingId = id
        scope.launch {
            busy = true
            try {
                snapshot = withContext(Dispatchers.IO) { controller.select(id) }
            } catch (e: Exception) {
                snapshot = snapshot?.copy(
                    error = "切换桌面图标失败：${e.message?.takeIf { it.isNotBlank() } ?: "请重试"}",
                )
            } finally {
                busy = false
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (loading) {
            Text("正在读取当前桌面图标…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        for (row in LAUNCHER_ICON_OPTIONS.chunked(3)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (option in row) {
                    val selected = snapshot?.activeId == option.id
                    Card(
                        modifier = Modifier
                            .weight(1f)
                            .selectable(
                                selected = selected,
                                enabled = !busy && !loading,
                                role = Role.RadioButton,
                                onClick = { selectIcon(option.id) },
                            ),
                        border = BorderStroke(
                            width = if (selected) 2.dp else 1.dp,
                            color = if (selected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outlineVariant
                            },
                        ),
                        colors = CardDefaults.cardColors(
                            containerColor = if (selected) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                        ),
                    ) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Image(
                                painter = painterResource(option.previewRes),
                                contentDescription = stringResource(option.labelRes),
                                modifier = Modifier.size(64.dp).clip(RoundedCornerShape(14.dp)),
                                contentScale = ContentScale.Fit,
                            )
                            Text(
                                text = stringResource(option.labelRes),
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 1,
                            )
                            Text(
                                text = when {
                                    selected -> "当前使用"
                                    busy && pendingId == option.id -> "切换中…"
                                    else -> "选择"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = if (selected) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                                maxLines = 1,
                            )
                        }
                    }
                }
                repeat(3 - row.size) {
                    Spacer(Modifier.weight(1f))
                }
            }
        }

        val current = snapshot
        if (!loading && current != null) {
            when {
                current.activeId != null -> Text(
                    "当前桌面入口：第 ${current.activeId} 款。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                current.launchableIds.size > 1 -> Text(
                    "检测到多个桌面入口，请重试归一到唯一入口。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                else -> Text(
                    "暂时无法确认当前桌面入口。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            current.warning?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
            }
            current.error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }

        if (busy) {
            Text("正在切换桌面图标，请稍候…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (!loading && snapshot?.error != null || (snapshot?.launchableIds?.size ?: 0) > 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    enabled = !busy,
                    onClick = {
                        selectIcon(pendingId ?: snapshot?.selectedId ?: LauncherIcons.DEFAULT_ID)
                    },
                ) {
                    Text("重试切换")
                }
                OutlinedButton(
                    enabled = !busy,
                    onClick = { selectIcon(LauncherIcons.DEFAULT_ID) },
                ) {
                    Text("恢复默认图标")
                }
            }
        }
    }
}
