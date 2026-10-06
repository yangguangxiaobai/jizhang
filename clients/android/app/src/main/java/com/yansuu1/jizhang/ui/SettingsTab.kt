package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.repo.AuthRepository
import kotlinx.coroutines.launch

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
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
    ) {
        Text("我的", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(16.dp))
        Button(onClick = {
            scope.launch {
                auth?.logout()
                onLogout()
            }
        }) {
            Text("退出登录")
        }
    }
}
