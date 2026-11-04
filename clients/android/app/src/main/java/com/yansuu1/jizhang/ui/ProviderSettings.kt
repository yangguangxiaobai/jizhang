package com.yansuu1.jizhang.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AssistantRepository
import com.yansuu1.jizhang.repo.ProviderModels
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import org.json.JSONObject

internal data class ProviderDraft(
    val enabled: Boolean = false,
    val mode: String = "chat-completions",
    val method: String = "POST",
    val authKind: String = "bearer",
    val name: String = "",
    val url: String = "",
    val model: String = "",
    val timeoutMs: String = "20000",
    val headers: String = "{}",
    val bodyTemplate: String = "",
    val responsePath: String = "choices[0].message.content",
    val headerName: String = "",
) {
    fun modelConnection(): ProviderDraft = copy(model = "")

    fun canDiscoverModels(saved: ProviderDraft?, secret: String, clearSecret: Boolean): Boolean =
        saved != null && saved.modelConnection() == modelConnection() &&
            secret.isEmpty() && !clearSecret && mode != "custom" && url.isNotBlank()
}

@Composable
fun ProviderSettings(api: ApiClient, onAuthExpired: () -> Unit) {
    val repo = remember(api) { AssistantRepository(api) }
    val scope = rememberCoroutineScope()
    val t = LocalWebTokens.current
    val motion = LocalMotionTokens.current
    val revealDistancePx = with(LocalDensity.current) { 8.dp.roundToPx() }

    var draft by remember { mutableStateOf(ProviderDraft()) }
    var savedDraft by remember { mutableStateOf<ProviderDraft?>(null) }
    // Secrets intentionally stay in ordinary in-memory Compose state only.
    var secret by remember { mutableStateOf("") }
    var hasSecret by remember { mutableStateOf(false) }
    var clearSecret by remember { mutableStateOf(false) }
    var bodyTemplateUnavailable by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var operation by remember { mutableStateOf<String?>(null) }
    var advancedExpanded by remember { mutableStateOf(false) }
    var clearDialog by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var statusIsError by remember { mutableStateOf(false) }
    var testStatusMessage by remember { mutableStateOf<String?>(null) }
    var testStatusIsError by remember { mutableStateOf(false) }
    var testedSavedDraft by remember { mutableStateOf<ProviderDraft?>(null) }
    var timeoutError by remember { mutableStateOf<String?>(null) }
    var headersError by remember { mutableStateOf<String?>(null) }
    var headerNameError by remember { mutableStateOf<String?>(null) }
    var modelIds by remember(api) { mutableStateOf<List<String>?>(null) }
    var modelsFor by remember(api) { mutableStateOf<ProviderDraft?>(null) }
    var modelsError by remember(api) { mutableStateOf<String?>(null) }
    var showModels by remember(api) { mutableStateOf(false) }
    var modelQuery by remember(api) { mutableStateOf("") }

    // Model-only draft edits do not change the discovery destination. All other
    // config edits require saving first, matching the saved-provider API contract.
    val modelConnection = draft.modelConnection()
    val discoveryAllowed = loaded && draft.canDiscoverModels(savedDraft, secret, clearSecret)
    val currentModels = modelIds.takeIf { modelsFor == modelConnection && discoveryAllowed }
    LaunchedEffect(modelConnection, secret, clearSecret) {
        modelIds = null
        modelsFor = null
        modelsError = null
        showModels = false
    }

    val hasUnsavedChanges = loaded && ProviderSettingsHelper.isDraftDirty(draft, savedDraft, secret, clearSecret)
    val fieldsEnabled = loaded && operation == null

    suspend fun loadConfiguration() {
        loading = true
        try {
            val config = repo.providerConfig()
            val auth = config.optJSONObject("auth")
            val loadedDraft = ProviderDraft(
                enabled = config.optBoolean("enabled"),
                mode = config.optString("mode", "chat-completions"),
                method = config.optString("method", "POST"),
                authKind = auth?.optString("kind", "bearer") ?: "bearer",
                name = config.optString("name"),
                url = config.optString("url"),
                model = config.optString("model"),
                timeoutMs = config.optInt("timeoutMs", 20_000).toString(),
                headers = config.optJSONObject("headers")?.toString(2) ?: "{}",
                bodyTemplate = if (config.isNull("bodyTemplate")) "" else config.optString("bodyTemplate"),
                responsePath = config.optString("responsePath", "choices[0].message.content"),
                headerName = auth?.optString("headerName").orEmpty(),
            )
            draft = loadedDraft
            savedDraft = loadedDraft
            testedSavedDraft = null
            testStatusMessage = null
            bodyTemplateUnavailable = loadedDraft.mode != "custom" && config.isNull("bodyTemplate")
            hasSecret = config.optBoolean("hasSecret")
            secret = ""
            clearSecret = false
            timeoutError = null
            headersError = null
            headerNameError = null
            statusMessage = null
            loaded = true
        } catch (e: AuthExpiredException) {
            statusMessage = "登录状态已过期，请重新登录。"
            statusIsError = true
            onAuthExpired()
        } catch (e: Exception) {
            statusMessage = e.message ?: "无法读取 AI 配置，请重试。"
            statusIsError = true
        } finally {
            loading = false
        }
    }

    LaunchedEffect(repo) { loadConfiguration() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding(),
    ) {
        if (loading && !loaded) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = t.accent)
                Spacer(Modifier.height(12.dp))
                Text("正在读取 AI 配置…", color = t.muted)
            }
        } else if (!loaded) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .widthIn(max = 640.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ProviderNotice(statusMessage ?: "配置加载失败，当前不能保存空配置。", isError = true)
                    OutlinedButton(
                        enabled = !loading,
                        onClick = { scope.launch { loadConfiguration() } },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, t.accent.copy(alpha = 0.5f)),
                    ) {
                        Text(if (loading) "正在重试…" else "重新加载配置", color = t.accent)
                    }
                }
            }
        } else {
            // 滚动内容主体
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .widthIn(max = 640.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    // ==========================================
                    // [Card 1] 真实服务状态与主开关
                    // ==========================================
                    JzCard(Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Column(
                                    modifier = Modifier
                                        .weight(1f)
                                        .padding(end = 12.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Text(
                                            "AI 助理服务",
                                            style = MaterialTheme.typography.titleMedium,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        val isSavedEnabled = savedDraft?.enabled == true
                                        val pillBg = if (isSavedEnabled) t.ok.copy(alpha = 0.12f) else t.muted.copy(alpha = 0.12f)
                                        val pillFg = if (isSavedEnabled) t.ok else t.muted
                                        val pillText = ProviderSettingsHelper.savedStatusLabel(savedDraft)
                                        Box(
                                            modifier = Modifier
                                                .background(pillBg, RoundedCornerShape(12.dp))
                                                .padding(horizontal = 8.dp, vertical = 3.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                            ) {
                                                Box(
                                                    modifier = Modifier
                                                        .size(6.dp)
                                                        .background(pillFg, CircleShape),
                                                )
                                                Text(
                                                    pillText,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Medium,
                                                    color = pillFg,
                                                )
                                            }
                                        }
                                        ProviderSettingsHelper.draftStatusBadge(draft, savedDraft, secret, clearSecret)?.let { badgeText ->
                                            Box(
                                                modifier = Modifier
                                                    .background(t.warning.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
                                                    .padding(horizontal = 8.dp, vertical = 3.dp),
                                                contentAlignment = Alignment.Center,
                                            ) {
                                                Text(
                                                    badgeText,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Medium,
                                                    color = t.warning,
                                                )
                                            }
                                        }
                                    }
                                    Text(
                                        if (draft.enabled) "草稿已开启（需保存生效）。保存后记账会话与账单解析可调用模型。"
                                        else "草稿已关闭（需保存生效）。关闭后 AI 助理功能将暂停模型调用。",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = t.muted,
                                    )
                                }
                                Switch(
                                    checked = draft.enabled,
                                    enabled = fieldsEnabled,
                                    onCheckedChange = {
                                        draft = draft.copy(enabled = it)
                                        testStatusMessage = null
                                    },
                                    colors = SwitchDefaults.colors(
                                        checkedThumbColor = t.surface,
                                        checkedTrackColor = t.accent,
                                        uncheckedThumbColor = t.surface,
                                        uncheckedTrackColor = t.border,
                                    ),
                                )
                            }
                        }
                    }

                    // ==========================================
                    // [Card 2] 连接与认证设置 (模式与认证就近配置)
                    // ==========================================
                    JzCard(Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.AutoAwesome,
                                    contentDescription = null,
                                    tint = t.accent,
                                    modifier = Modifier.size(20.dp),
                                )
                                Column {
                                    Text(
                                        "连接与认证设置",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        "接口模式、服务地址、认证方式与密钥",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = t.muted,
                                    )
                                }
                            }

                            // 接口模式
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("接口模式", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    listOf(
                                        "chat-completions" to "Chat",
                                        "responses" to "Responses",
                                        "custom" to "自定义",
                                    ).forEach { (value, label) ->
                                        val isSelected = draft.mode == value
                                        FilterChip(
                                            selected = isSelected,
                                            enabled = fieldsEnabled,
                                            onClick = {
                                                draft = draft.copy(mode = value)
                                                testStatusMessage = null
                                            },
                                            label = { Text(label, fontSize = 12.sp) },
                                            modifier = Modifier.weight(1f),
                                            shape = RoundedCornerShape(8.dp),
                                            colors = FilterChipDefaults.filterChipColors(
                                                selectedContainerColor = t.accentSubtle,
                                                selectedLabelColor = t.accent,
                                            ),
                                        )
                                    }
                                }
                                Text(
                                    when (draft.mode) {
                                        "responses" -> "Responses 模式。切换模式不会改写响应路径或自定义模板。"
                                        "custom" -> "自定义模式需在下方高级设置中配置请求体模板与响应路径。"
                                        else -> "Chat Completions 模式（OpenAI / New API 兼容标准接口）。"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = t.muted,
                                )
                            }

                            // 配置名称 (可选)
                            ProviderTextField(
                                value = draft.name,
                                onValueChange = {
                                    draft = draft.copy(name = it)
                                    testStatusMessage = null
                                },
                                label = "配置名称（可选）",
                                placeholder = "例如：自建 New API / DeepSeek",
                                enabled = fieldsEnabled,
                                singleLine = true,
                            )

                            // 服务地址 (Base URL)
                            val normalizedPreview = remember(draft.url, draft.mode) {
                                ProviderSettingsHelper.normalizeUrl(draft.url, draft.mode)
                            }
                            val urlSupportingText = when {
                                draft.url.isNotBlank() && normalizedPreview != draft.url.trim() && draft.mode == "chat-completions" ->
                                    "💡 保存时将自动补全为: $normalizedPreview"
                                else -> "支持直接粘贴中转站根域名，Chat 模式保存时自动补全 /v1/chat/completions"
                            }
                            ProviderTextField(
                                value = draft.url,
                                onValueChange = {
                                    draft = draft.copy(url = it)
                                    testStatusMessage = null
                                },
                                label = "服务地址 (Base URL)",
                                placeholder = "https://api.my-domain.com",
                                enabled = fieldsEnabled,
                                singleLine = true,
                                keyboardType = KeyboardType.Uri,
                                supportingText = urlSupportingText,
                            )

                            // 认证方式
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("认证方式", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    listOf("bearer" to "Bearer", "header" to "自定义头", "none" to "无认证")
                                        .forEach { (value, label) ->
                                            val isSelected = draft.authKind == value
                                            FilterChip(
                                                selected = isSelected,
                                                enabled = fieldsEnabled,
                                                onClick = {
                                                    draft = draft.copy(authKind = value)
                                                    testStatusMessage = null
                                                    headerNameError = null
                                                },
                                                label = { Text(label, fontSize = 12.sp) },
                                                modifier = Modifier.weight(1f),
                                                shape = RoundedCornerShape(8.dp),
                                                colors = FilterChipDefaults.filterChipColors(
                                                    selectedContainerColor = t.accentSubtle,
                                                    selectedLabelColor = t.accent,
                                                ),
                                            )
                                        }
                                }
                                if (draft.authKind == "header") {
                                    ProviderTextField(
                                        value = draft.headerName,
                                        onValueChange = {
                                            draft = draft.copy(headerName = it)
                                            headerNameError = null
                                            testStatusMessage = null
                                        },
                                        label = "自定义认证请求头名称",
                                        placeholder = "例如 X-API-Key",
                                        enabled = fieldsEnabled,
                                        singleLine = true,
                                        isError = headerNameError != null,
                                        supportingText = headerNameError ?: "请输入服务商要求的认证头名称",
                                    )
                                }
                            }

                            // API 密钥 (API Key)
                            val secretSupportingText = when {
                                secret.isNotEmpty() -> "已输入新密钥（将在保存时加密发送至服务器）"
                                hasSecret && !clearSecret && draft.authKind == "none" -> "服务器已保存密钥；当前认证方式为“无认证”，暂不使用"
                                hasSecret && !clearSecret -> "服务器已加密保存密钥；留空保持不变"
                                clearSecret -> "已标记清除；保存配置后才真正从服务器移除"
                                draft.authKind == "none" -> "当前认证方式不使用密钥"
                                else -> "尚未保存密钥"
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                ProviderTextField(
                                    value = secret,
                                    onValueChange = {
                                        secret = it
                                        if (it.isNotEmpty()) clearSecret = false
                                        testStatusMessage = null
                                    },
                                    label = "API 密钥 (API Key)",
                                    placeholder = if (hasSecret && !clearSecret) "已保存密钥（留空不改）" else "sk-...",
                                    enabled = fieldsEnabled,
                                    singleLine = true,
                                    isPassword = true,
                                    keyboardType = KeyboardType.Password,
                                    supportingText = secretSupportingText,
                                )

                                if (hasSecret && !clearSecret) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.End,
                                    ) {
                                        TextButton(
                                            enabled = fieldsEnabled,
                                            onClick = { clearDialog = true },
                                        ) {
                                            Text("清除已保存密钥…", color = t.danger, fontSize = 13.sp)
                                        }
                                    }
                                } else if (clearSecret) {
                                    Surface(
                                        color = t.dangerSubtle,
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, t.danger.copy(alpha = 0.35f)),
                                    ) {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(horizontal = 12.dp, vertical = 8.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            Text(
                                                "已标记清除。保存后原密钥将从服务器删除。",
                                                modifier = Modifier.weight(1f),
                                                color = t.danger,
                                                style = MaterialTheme.typography.bodySmall,
                                            )
                                            TextButton(
                                                enabled = fieldsEnabled,
                                                onClick = { clearSecret = false },
                                            ) {
                                                Text("撤销", color = t.accent)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // ==========================================
                    // [Card 3] 独立模型设置卡 (手填 + 统一模型库入口)
                    // ==========================================
                    JzCard(Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Filled.Tune,
                                    contentDescription = null,
                                    tint = t.accent,
                                    modifier = Modifier.size(20.dp),
                                )
                                Column {
                                    Text(
                                        "模型设置",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        "手填模型名称，或从可用模型库/预设中选择",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = t.muted,
                                    )
                                }
                            }

                            ProviderTextField(
                                value = draft.model,
                                onValueChange = {
                                    draft = draft.copy(model = it)
                                    testStatusMessage = null
                                },
                                label = "模型名称 (Model)",
                                placeholder = "如 gpt-4o-mini 或 deepseek-chat",
                                enabled = fieldsEnabled,
                                singleLine = true,
                                supportingText = "手动输入，或点击右侧选择器打开模型库；保存后生效",
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                OutlinedButton(
                                    enabled = fieldsEnabled,
                                    onClick = {
                                        modelQuery = ""
                                        showModels = true
                                    },
                                    modifier = Modifier
                                        .weight(1f)
                                        .heightIn(min = 44.dp),
                                    shape = RoundedCornerShape(10.dp),
                                ) {
                                    Text(
                                        if (!currentModels.isNullOrEmpty()) "打开模型库（${currentModels.size}）" else "打开模型库与预设",
                                        fontSize = 13.sp,
                                    )
                                }

                                OutlinedButton(
                                    enabled = fieldsEnabled && discoveryAllowed,
                                    onClick = {
                                        if (operation != null || !discoveryAllowed) return@OutlinedButton
                                        val requestedConnection = modelConnection
                                        operation = "models"
                                        modelsError = null
                                        modelIds = null
                                        modelsFor = null
                                        scope.launch {
                                            try {
                                                val service = api.getBaseUrl()
                                                val ids = repo.providerModels()
                                                currentCoroutineContext().ensureActive()
                                                if (api.getBaseUrl() != service || !api.hasSession() ||
                                                    draft.modelConnection() != requestedConnection ||
                                                    secret.isNotEmpty() || clearSecret) return@launch
                                                modelsFor = requestedConnection
                                                modelIds = ids
                                                modelQuery = ""
                                                showModels = true
                                            } catch (e: CancellationException) {
                                                throw e
                                            } catch (e: AuthExpiredException) {
                                                modelsError = "登录状态已过期，请重新登录。"
                                                onAuthExpired()
                                            } catch (e: ApiException) {
                                                modelsError = if (e.status == 404) {
                                                    "服务器尚未支持拉取模型，请先更新后端；仍可手动填写。"
                                                } else when (e.code) {
                                                    "AI_PROVIDER_TIMEOUT" -> "拉取模型超时，请稍后重试；当前模型未改变，可手动填写。"
                                                    "AI_PROVIDER_ERROR" -> "接口未能提供模型列表，请检查已保存的地址、密钥与服务商支持情况；可手动填写。"
                                                    "AI_RESPONSE_INVALID" -> "接口返回的模型列表格式不受支持，可继续手动填写。"
                                                    "AI_SECRET_UNAVAILABLE", "AI_ENCRYPTION_KEY_REQUIRED" -> "服务器无法使用已保存密钥，请检查密钥与服务器加密配置。"
                                                    "AI_NOT_CONFIGURED" -> "请先保存接口地址和密钥，再拉取模型。"
                                                    "AI_CONFIG_INVALID" -> "已保存接口不支持标准模型列表，请检查接口模式和完整地址，或手动填写模型名。"
                                                    else -> "拉取模型失败，请检查后端与已保存配置；可继续手动填写。"
                                                }
                                            } catch (_: Exception) {
                                                modelsError = "无法拉取模型，请检查已保存接口或稍后重试；可继续手动填写。"
                                            } finally {
                                                operation = null
                                            }
                                        }
                                    },
                                    modifier = Modifier
                                        .weight(1f)
                                        .heightIn(min = 44.dp),
                                    shape = RoundedCornerShape(10.dp),
                                ) {
                                    if (operation == "models") {
                                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                                        Spacer(Modifier.width(6.dp))
                                    }
                                    Text(if (operation == "models") "正在拉取…" else "从接口拉取最新", fontSize = 13.sp)
                                }
                            }

                            Text(
                                when {
                                    draft.mode == "custom" -> "自定义接口暂不支持拉取模型列表，请手动填写模型名。"
                                    !discoveryAllowed -> "请先保存接口地址和密钥，再拉取模型列表。首次配置可先关闭 AI、留空模型名保存。"
                                    currentModels?.isEmpty() == true -> "接口返回了空模型列表，当前模型未改变；可重试或手动填写。"
                                    else -> "使用服务器已保存的地址和密钥，仅获取模型列表，不发起对话或测试。"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = t.muted,
                            )
                            modelsError?.let { ProviderNotice(it, isError = true) }
                        }
                    }

                    // ==========================================
                    // [Card 4] 高级请求设置 (折叠收拢)
                    // ==========================================
                    JzCard(Modifier.fillMaxWidth()) {
                        Column {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { advancedExpanded = !advancedExpanded }
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Icon(
                                        imageVector = Icons.Filled.Tune,
                                        contentDescription = null,
                                        tint = t.muted,
                                        modifier = Modifier.size(20.dp),
                                    )
                                    Column {
                                        Text(
                                            "高级请求设置",
                                            style = MaterialTheme.typography.titleMedium,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        Text(
                                            ProviderSettingsHelper.formatAdvancedSummary(draft.method, draft.timeoutMs, draft.authKind),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = t.muted,
                                        )
                                    }
                                }
                                IconButton(
                                    onClick = { advancedExpanded = !advancedExpanded },
                                    enabled = loaded,
                                ) {
                                    Icon(
                                        imageVector = if (advancedExpanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                                        contentDescription = if (advancedExpanded) "收起高级设置" else "展开高级设置",
                                        tint = t.muted,
                                    )
                                }
                            }

                            AnimatedVisibility(
                                visible = advancedExpanded,
                                enter = if (motion.reduced) EnterTransition.None else
                                    fadeIn(tween(motion.baseMillis, easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f))) +
                                        slideInVertically(
                                            animationSpec = tween(motion.baseMillis, easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)),
                                            initialOffsetY = { -it.coerceAtMost(revealDistancePx) },
                                        ),
                                exit = if (motion.reduced) ExitTransition.None else
                                    fadeOut(tween(motion.quickMillis)) +
                                        slideOutVertically(
                                            animationSpec = tween(motion.quickMillis),
                                            targetOffsetY = { -it.coerceAtMost(revealDistancePx) },
                                        ),
                            ) {
                                Column(
                                    modifier = Modifier.padding(top = 12.dp),
                                    verticalArrangement = Arrangement.spacedBy(14.dp),
                                ) {
                                    // HTTP 请求方式
                                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text("HTTP 请求方式", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                            listOf("GET", "POST", "PUT", "PATCH").forEach { value ->
                                                val isSelected = draft.method == value
                                                FilterChip(
                                                    selected = isSelected,
                                                    enabled = fieldsEnabled,
                                                    onClick = {
                                                        draft = draft.copy(method = value)
                                                        testStatusMessage = null
                                                    },
                                                    label = { Text(value, fontSize = 12.sp) },
                                                    modifier = Modifier.weight(1f),
                                                    shape = RoundedCornerShape(8.dp),
                                                    colors = FilterChipDefaults.filterChipColors(
                                                        selectedContainerColor = t.accentSubtle,
                                                        selectedLabelColor = t.accent,
                                                    ),
                                                )
                                            }
                                        }
                                    }

                                    // 超时时间
                                    ProviderTextField(
                                        value = draft.timeoutMs,
                                        onValueChange = {
                                            draft = draft.copy(timeoutMs = it)
                                            timeoutError = null
                                            testStatusMessage = null
                                        },
                                        label = "超时时间 (毫秒)",
                                        placeholder = "20000",
                                        enabled = fieldsEnabled,
                                        singleLine = true,
                                        keyboardType = KeyboardType.Number,
                                        supportingText = timeoutError ?: "有效范围：3000 到 60000 之间的整数毫秒",
                                        isError = timeoutError != null,
                                    )

                                    // 额外请求头
                                    ProviderTextField(
                                        value = draft.headers,
                                        onValueChange = {
                                            draft = draft.copy(headers = it)
                                            headersError = null
                                            testStatusMessage = null
                                        },
                                        label = "额外请求头 JSON",
                                        placeholder = "{}",
                                        enabled = fieldsEnabled,
                                        minLines = 3,
                                        maxLines = 7,
                                        supportingText = headersError ?: "敏感认证头请在上方认证设置中配置",
                                        isError = headersError != null,
                                    )

                                    // 自定义请求体模板
                                    ProviderTextField(
                                        value = draft.bodyTemplate,
                                        onValueChange = {
                                            draft = draft.copy(bodyTemplate = it)
                                            bodyTemplateUnavailable = false
                                            testStatusMessage = null
                                        },
                                        label = "自定义请求体模板（留空使用模式默认值）",
                                        placeholder = "留空使用默认模板",
                                        enabled = fieldsEnabled,
                                        minLines = 4,
                                        maxLines = 10,
                                        supportingText = "模板变量由服务器校验；不能在模板中引用密钥。",
                                    )
                                    if (bodyTemplateUnavailable && draft.bodyTemplate.isBlank()) {
                                        ProviderNotice(
                                            "现有接口在已保存模式不是 custom 时不会返回 bodyTemplate。此处留空表示当前不可读取，不表示服务器已清空；未明确编辑此字段时，保存其它设置会保留服务器原值。",
                                            isError = false,
                                        )
                                    }

                                    // 响应内容路径
                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        ProviderTextField(
                                            value = draft.responsePath,
                                            onValueChange = {
                                                draft = draft.copy(responsePath = it)
                                                testStatusMessage = null
                                            },
                                            label = "响应内容路径",
                                            placeholder = "choices[0].message.content",
                                            enabled = fieldsEnabled,
                                            singleLine = true,
                                        )
                                        if (draft.mode != "custom") {
                                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                                TextButton(
                                                    enabled = fieldsEnabled,
                                                    onClick = {
                                                        draft = draft.copy(responsePath = ProviderSettingsHelper.defaultResponsePath(draft.mode))
                                                        testStatusMessage = null
                                                    },
                                                ) {
                                                    Text("填入当前模式常用路径", color = t.accent, fontSize = 13.sp)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(8.dp))
                }
            }

            // ==========================================
            // [Fixed Bottom Bar] 常驻吸底操作栏 (保存与测试)
            // ==========================================
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = t.surface,
                shadowElevation = 8.dp,
                border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .widthIn(max = 640.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (hasUnsavedChanges) {
                            ProviderNotice(
                                "草稿有未保存修改。测试只针对服务器已保存配置，请先保存。",
                                isError = false,
                                isWarning = true,
                            )
                        } else if (testStatusMessage != null) {
                            ProviderNotice(testStatusMessage!!, isError = testStatusIsError)
                        } else if (statusMessage != null) {
                            ProviderNotice(statusMessage!!, isError = statusIsError)
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            // 次要操作：测试连接 (保持原契约：仅依赖 fieldsEnabled && !hasUnsavedChanges，支持 authKind=none 无密钥测试)
                            val canTest = fieldsEnabled && !hasUnsavedChanges
                            OutlinedButton(
                                enabled = canTest,
                                onClick = {
                                    if (hasUnsavedChanges) {
                                        testStatusMessage = "请先保存修改；测试只会调用服务器上已保存的配置。"
                                        testStatusIsError = false
                                        return@OutlinedButton
                                    }
                                    if (operation != null) return@OutlinedButton
                                    operation = "test"
                                    scope.launch {
                                        testStatusMessage = "正在测试连接…"
                                        testStatusIsError = false
                                        statusMessage = null
                                        val start = System.currentTimeMillis()
                                        try {
                                            repo.testProvider()
                                            val duration = System.currentTimeMillis() - start
                                            testStatusMessage = "连通性测试通过 (耗时 ${duration}ms)"
                                            testStatusIsError = false
                                            testedSavedDraft = savedDraft
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: AuthExpiredException) {
                                            testStatusMessage = "登录状态已过期，请重新登录。"
                                            testStatusIsError = true
                                            onAuthExpired()
                                        } catch (e: Exception) {
                                            testStatusMessage = e.message ?: "测试失败，请检查已保存配置。"
                                            testStatusIsError = true
                                        } finally {
                                            operation = null
                                        }
                                    }
                                },
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 48.dp),
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(
                                    1.dp,
                                    if (canTest) t.accent.copy(alpha = 0.5f) else t.border.copy(alpha = 0.3f),
                                ),
                            ) {
                                if (operation == "test") {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(16.dp),
                                        color = t.accent,
                                        strokeWidth = 2.dp,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text("正在测试…")
                                } else {
                                    Text(
                                        "测试已保存配置",
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (canTest) t.accent else t.muted,
                                    )
                                }
                            }

                            // 主要操作：保存配置
                            Button(
                                enabled = fieldsEnabled,
                                onClick = {
                                    val timeoutErr = ProviderSettingsHelper.validateTimeout(draft.timeoutMs)
                                    if (timeoutErr != null) {
                                        timeoutError = timeoutErr
                                        advancedExpanded = true
                                        return@Button
                                    }
                                    val parsedHeaders = try {
                                        JSONObject(draft.headers)
                                    } catch (_: Exception) {
                                        headersError = "请求头必须是有效的 JSON 对象。"
                                        advancedExpanded = true
                                        return@Button
                                    }
                                    if (draft.authKind == "header" && draft.headerName.isBlank()) {
                                        headerNameError = "请填写自定义认证请求头名称。"
                                        statusMessage = "请填写自定义认证请求头名称。"
                                        statusIsError = true
                                        return@Button
                                    }

                                    val timeout = draft.timeoutMs.trim().toInt()
                                    val normalizedUrl = ProviderSettingsHelper.normalizeUrl(draft.url, draft.mode)
                                    val actualDraft = draft.copy(url = normalizedUrl)
                                    draft = actualDraft

                                    if (operation != null) return@Button
                                    operation = "save"
                                    scope.launch {
                                        statusMessage = null
                                        statusIsError = false
                                        testStatusMessage = null
                                        testedSavedDraft = null
                                        try {
                                            val input = mutableMapOf<String, Any?>(
                                                "enabled" to actualDraft.enabled,
                                                "mode" to actualDraft.mode,
                                                "method" to actualDraft.method,
                                                "name" to actualDraft.name,
                                                "url" to normalizedUrl,
                                                "model" to actualDraft.model,
                                                "timeoutMs" to timeout,
                                                "headers" to parsedHeaders,
                                                "auth" to JSONObject().put("kind", actualDraft.authKind).apply {
                                                    if (actualDraft.authKind == "header") put("headerName", actualDraft.headerName)
                                                },
                                                "responsePath" to actualDraft.responsePath,
                                                "clearSecret" to clearSecret,
                                            )
                                            if (!bodyTemplateUnavailable) {
                                                input["bodyTemplate"] = actualDraft.bodyTemplate.takeIf { it.isNotBlank() }
                                            }
                                            if (secret.isNotEmpty()) input["secret"] = secret
                                            val saved = repo.saveProviderConfig(input)
                                            hasSecret = saved.optBoolean(
                                                "hasSecret",
                                                when {
                                                    clearSecret -> false
                                                    secret.isNotEmpty() -> true
                                                    else -> hasSecret
                                                },
                                            )
                                            secret = ""
                                            clearSecret = false
                                            if (actualDraft.mode == "custom" && !saved.isNull("bodyTemplate")) {
                                                draft = actualDraft.copy(bodyTemplate = saved.optString("bodyTemplate"))
                                                bodyTemplateUnavailable = false
                                            } else if (actualDraft.mode != "custom" && saved.isNull("bodyTemplate")) {
                                                bodyTemplateUnavailable = actualDraft.bodyTemplate.isBlank()
                                            }
                                            savedDraft = draft
                                            statusMessage = "配置已保存。旧测试结果已失效，请重新测试。"
                                            statusIsError = false
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: AuthExpiredException) {
                                            statusMessage = "登录状态已过期，请重新登录。"
                                            statusIsError = true
                                            onAuthExpired()
                                        } catch (e: Exception) {
                                            statusMessage = e.message ?: "保存失败，请检查配置后重试。"
                                            statusIsError = true
                                        } finally {
                                            operation = null
                                        }
                                    }
                                },
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 48.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = t.accent,
                                    contentColor = t.onAccent,
                                ),
                            ) {
                                if (operation == "save") {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(16.dp),
                                        color = t.onAccent,
                                        strokeWidth = 2.dp,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text("正在保存…")
                                } else {
                                    Text("保存配置", fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ==========================================
    // 模型选择与搜索弹窗 (始终可打开；内含快捷预设与接口模型)
    // ==========================================
    if (showModels) {
        val matches = ProviderModels.search(currentModels ?: emptyList(), modelQuery)
        AlertDialog(
            onDismissRequest = { showModels = false },
            title = { Text("选择模型") },
            text = {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedTextField(
                        value = modelQuery,
                        onValueChange = { modelQuery = it.take(200) },
                        label = { Text("搜索模型") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )

                    // 常用模型预设（移至选择器内部，明确标注不保证服务商可用性）
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "常用快捷预设（非服务端拉取，不保证接口可用性）：",
                            style = MaterialTheme.typography.labelSmall,
                            color = t.muted,
                        )
                        @OptIn(ExperimentalLayoutApi::class)
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            ProviderSettingsHelper.POPULAR_MODELS.forEach { modelName ->
                                val isSelected = draft.model.trim() == modelName
                                FilterChip(
                                    selected = isSelected,
                                    enabled = fieldsEnabled,
                                    onClick = {
                                        draft = draft.copy(model = modelName)
                                        testStatusMessage = null
                                        showModels = false
                                    },
                                    label = {
                                        Text(
                                            modelName,
                                            fontSize = 11.sp,
                                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                        )
                                    },
                                    shape = RoundedCornerShape(8.dp),
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = t.accentSubtle,
                                        selectedLabelColor = t.accent,
                                        containerColor = t.surfaceSoft.copy(alpha = 0.6f),
                                        labelColor = t.fg,
                                    ),
                                    border = FilterChipDefaults.filterChipBorder(
                                        enabled = fieldsEnabled,
                                        selected = isSelected,
                                        borderColor = if (isSelected) t.accent else t.border.copy(alpha = 0.65f),
                                    ),
                                )
                            }
                        }
                    }

                    // 接口拉取的模型列表
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        val headerText = if (currentModels == null) {
                            "接口模型列表：尚未拉取"
                        } else {
                            "接口模型列表（匹配 ${matches.size} / 共 ${currentModels.size} 个）："
                        }
                        Text(
                            headerText,
                            style = MaterialTheme.typography.labelSmall,
                            color = t.muted,
                        )
                        Text(
                            "点击选入草稿，需显式保存配置生效",
                            style = MaterialTheme.typography.bodySmall,
                            color = t.muted,
                        )
                        if (currentModels.isNullOrEmpty()) {
                            Text(
                                if (currentModels?.isEmpty() == true) "接口返回了空模型列表，可选择上方预设或手动填写。"
                                else "尚未从服务商拉取模型列表。可先在页面中拉取，或直接选择上方预设/手填。",
                                style = MaterialTheme.typography.bodySmall,
                                color = t.muted,
                                modifier = Modifier.padding(vertical = 4.dp),
                            )
                        } else if (matches.isEmpty()) {
                            Text(
                                "没有匹配的模型，可更换搜索词或手动填写。",
                                style = MaterialTheme.typography.bodySmall,
                                color = t.muted,
                                modifier = Modifier.padding(vertical = 4.dp),
                            )
                        } else {
                            LazyColumn(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 280.dp),
                            ) {
                                items(matches, key = { it }) { id ->
                                    val isSelected = draft.model.trim() == id
                                    TextButton(
                                        onClick = {
                                            draft = draft.copy(model = id)
                                            testStatusMessage = null
                                            showModels = false
                                        },
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .heightIn(min = 44.dp),
                                    ) {
                                        Text(
                                            (if (isSelected) "✓ " else "") + id,
                                            modifier = Modifier.weight(1f),
                                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                            color = if (isSelected) t.accent else t.fg,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showModels = false }) { Text("关闭") } },
        )
    }

    if (clearDialog) {
        AlertDialog(
            onDismissRequest = { clearDialog = false },
            title = { Text("清除已保存密钥？") },
            text = {
                Text("确认后会先标记清除；只有保存配置后才会从服务器移除密钥。清除后，使用该密钥的认证请求将无法连接。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        secret = ""
                        clearSecret = true
                        statusMessage = null
                        testStatusMessage = null
                        clearDialog = false
                    },
                ) { Text("标记清除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { clearDialog = false }) { Text("返回") }
            },
        )
    }
}

@Composable
private fun ProviderTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 4,
    isPassword: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    supportingText: String? = null,
    isError: Boolean = false,
) {
    val t = LocalWebTokens.current
    var passwordVisible by remember { mutableStateOf(false) }

    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it, color = t.muted.copy(alpha = 0.6f)) } },
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        shape = RoundedCornerShape(12.dp),
        visualTransformation = if (isPassword && !passwordVisible) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        trailingIcon = if (isPassword) {
            {
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        imageVector = if (passwordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = if (passwordVisible) "隐藏密码" else "显示密码",
                        tint = t.muted,
                    )
                }
            }
        } else null,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = t.surface,
            unfocusedContainerColor = t.surfaceSoft.copy(alpha = 0.5f),
            disabledContainerColor = t.surfaceSoft.copy(alpha = 0.25f),
            focusedBorderColor = t.accent,
            unfocusedBorderColor = t.border.copy(alpha = 0.65f),
            disabledBorderColor = t.border.copy(alpha = 0.35f),
            focusedLabelColor = t.accent,
            cursorColor = t.accent,
        ),
        isError = isError,
        supportingText = supportingText?.let { valueText ->
            { Text(valueText, style = MaterialTheme.typography.bodySmall) }
        },
    )
}

@Composable
private fun ProviderNotice(
    message: String,
    isError: Boolean,
    isWarning: Boolean = false,
) {
    val t = LocalWebTokens.current
    val bg = when {
        isError -> t.dangerSubtle
        isWarning -> t.warning.copy(alpha = 0.12f)
        else -> t.accentSubtle
    }
    val fg = when {
        isError -> t.danger
        isWarning -> t.warning
        else -> t.accent
    }
    val borderCol = when {
        isError -> t.danger.copy(alpha = 0.35f)
        isWarning -> t.warning.copy(alpha = 0.4f)
        else -> t.accent.copy(alpha = 0.35f)
    }
    val icon = when {
        isError -> Icons.Filled.Warning
        isWarning -> Icons.Filled.Info
        else -> Icons.Filled.CheckCircle
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = bg,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, borderCol),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = fg,
                modifier = Modifier.size(18.dp),
            )
            Text(
                message,
                modifier = Modifier.weight(1f),
                color = fg,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
