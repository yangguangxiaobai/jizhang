package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.repo.AuthRepository
import kotlinx.coroutines.launch

/**
 * Login screen (A2). Mirrors web `LoginView.vue`, plus the N1 server-URL field:
 * the server address is user-configured + remembered, never hardcoded (PRD R3).
 * Single account: no sign-up affordance (account comes from `set-password` CLI).
 */
@Composable
fun LoginScreen(
    api: ApiClient,
    auth: AuthRepository,
    onLoggedIn: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var serverUrl by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        // N1: prefill the remembered server address; then check the session
        // (router guard parity: resolve once before deciding where to land).
        serverUrl = api.getBaseUrl().orEmpty()
        auth.refresh()
        checking = false
        if (auth.username != null) onLoggedIn()
    }

    if (checking) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(96.dp))
            CircularProgressIndicator()
        }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text("记账", style = MaterialTheme.typography.headlineMedium)
        Text(
            "信封预算法 · 个人账本",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = serverUrl,
            onValueChange = { serverUrl = it },
            label = { Text("服务端地址") },
            placeholder = { Text("https://…") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
            isError = error != null && serverUrl.isBlank(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("用户名") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("密码") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    error = null
                    if (serverUrl.isBlank()) {
                        error = "请先填写服务端地址"
                        return@launch
                    }
                    if (!ApiClient.looksLikeUrl(serverUrl)) {
                        error = "服务端地址须以 http(s):// 开头"
                        return@launch
                    }
                    if (username.trim().isEmpty() || password.isEmpty()) return@launch
                    loading = true
                    try {
                        api.setBaseUrl(serverUrl)
                    } catch (e: IllegalArgumentException) {
                        error = e.message
                        loading = false
                        return@launch
                    }
                    val ok = auth.login(username.trim(), password)
                    loading = false
                    if (ok) onLoggedIn() else error = auth.lastError ?: "登录失败，请重试。"
                }
            },
            enabled = !loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (loading) "登录中…" else "登录")
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "首次使用请在服务器上运行 set-password 设置密码",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
