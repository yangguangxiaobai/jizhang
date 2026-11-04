package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.repo.AuthRepository
import kotlinx.coroutines.launch
import com.yansuu1.jizhang.ui.theme.LocalWebTokens

/**
 * 我的 tab (A2 slice): username + logout. Master-data / trash / data / items /
 * provider-settings entries land with their batches (A7/A3/A8/A10/A9).
 */
@Composable
fun SettingsTab(
    auth: AuthRepository? = null,
    onLogout: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val tokens = LocalWebTokens.current
    JzCard(Modifier.fillMaxWidth()) {
        Text("账户", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(
            "退出后需要重新登录。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            OutlinedButton(onClick = {
                scope.launch {
                    auth?.logout()
                    onLogout()
                }
            }) {
                Text("退出登录", color = tokens.danger)
            }
        }
    }
}