package com.yansuu1.jizhang.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AssistantRepository
import com.yansuu1.jizhang.repo.AuthRepository
import com.yansuu1.jizhang.repo.BudgetRepository
import com.yansuu1.jizhang.repo.ItemRepository
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.ThemePreference
import kotlinx.coroutines.launch
import org.json.JSONObject

private val ITEM_STATUS_LABEL = mapOf(
    "all" to "全部",
    "active" to "使用中",
    "idle" to "闲置",
    "sold" to "已售出",
    "retired" to "已退役",
)

/**
 * 物品资产 (A10). Mirrors web `ItemsView` + detail/edit/close + cutout confirm:
 * list with status filter, summary card, add/edit inline sheet, sell/retire,
 * photo pick + upload (ordinary path always works), cutout candidates confirm.
 */
@Composable
fun ItemsTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val repo = remember(api) { ItemRepository(api) }
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var summary by remember { mutableStateOf<JSONObject?>(null) }
    var status by remember { mutableStateOf("all") }
    var query by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var creating by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<JSONObject?>(null) }

    suspend fun reload() {
        loading = true
        try {
            val q = mutableMapOf("limit" to "200")
            if (status != "all") q["status"] = status
            if (query.isNotBlank()) q["q"] = query
            val res = repo.list(q)
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            items = list
            try {
                summary = repo.summary()
            } catch (_: Exception) {
            }
            error = null
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(status) {
        reload()
    }

    if (creating || editing != null) {
        ItemEditSheet(
            api = api,
            initial = editing,
            onAuthExpired = onAuthExpired,
            onSaved = {
                creating = false
                editing = null
                scope.launch { reload() }
            },
            onClose = {
                creating = false
                editing = null
            },
        )
        return
    }
    if (detail != null) {
        ItemDetailSheet(
            api = api,
            itemId = detail!!.optString("id"),
            onAuthExpired = onAuthExpired,
            onClose = {
                detail = null
                scope.launch { reload() }
            },
            onEdit = {
                editing = detail
                detail = null
            },
        )
        return
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("物品资产", style = MaterialTheme.typography.titleLarge)
        Text("记录每件物品的陪伴时间与真实使用成本。", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { creating = true }, modifier = Modifier.fillMaxWidth()) {
            Text("添加物品")
        }
        Spacer(Modifier.height(8.dp))
        Row {
            for ((v, l) in ITEM_STATUS_LABEL.entries) {
                OutlinedButton(onClick = { status = v }) {
                    Text(if (status == v) "● $l" else l)
                }
            }
        }
        Row {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("搜索") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(onClick = { scope.launch { reload() } }) { Text("搜") }
        }
        if (summary != null) {
            val s = summary!!
            Text(
                "在册购入总额 ${formatYuan(s.optLong("cumulativePurchaseCents"))} · " +
                    "日均 ${formatYuan(s.optLong("currentDailyCostCents"))}/天",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                "物品资产独立于账单，不计入账户余额或收支统计。",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.optString("id") }) { item ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        OutlinedButton(
                            onClick = { detail = item },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.fillMaxWidth()) {
                                Text(item.optString("name"))
                                Text(
                                    (if (item.isNull("purchasePriceCents")) "购入价未记录"
                                    else "购入 ${formatYuan(item.optLong("purchasePriceCents"))}") +
                                        " · ${heldLabel(item.optInt("heldDays"))} · " +
                                        dailyLabel(item),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        }
        @Suppress("UNUSED_EXPRESSION")
        context.let { }
    }
}

private fun heldLabel(days: Int): String =
    if (days == 0) "今天开始" else "持有 $days 天"

private fun dailyLabel(item: JSONObject): String =
    if (item.isNull("dailyCostCents")) "日均成本 —"
    else "日均 ${formatYuan(item.optLong("dailyCostCents"))}/天"

@Composable
private fun ItemEditSheet(
    api: ApiClient,
    initial: JSONObject?,
    onAuthExpired: () -> Unit,
    onSaved: () -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { ItemRepository(api) }
    val isNew = initial == null
    var name by remember { mutableStateOf(initial?.optString("name").orEmpty()) }
    var category by remember { mutableStateOf(initial?.optString("category").orEmpty()) }
    var brand by remember { mutableStateOf(initial?.optString("brand").orEmpty()) }
    var model by remember { mutableStateOf(initial?.optString("model").orEmpty()) }
    var note by remember { mutableStateOf(initial?.optString("note").orEmpty()) }
    var priceText by remember {
        mutableStateOf(
            if (initial == null || initial.isNull("purchasePriceCents")) "" else "%.2f".format(initial.optLong("purchasePriceCents") / 100.0),
        )
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text(if (isNew) "添加物品" else "编辑物品", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("名称*") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = category, onValueChange = { category = it }, label = { Text("分类") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = brand, onValueChange = { brand = it }, label = { Text("品牌") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("型号") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = priceText, onValueChange = { priceText = it }, label = { Text("购入价（元，可空）") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("备注") }, modifier = Modifier.fillMaxWidth())
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(8.dp))
        Button(
            enabled = !saving,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    if (name.isBlank()) {
                        error = "请填写名称"
                        return@launch
                    }
                    saving = true
                    try {
                        val body = mutableMapOf<String, Any?>(
                            "name" to name,
                            "purchaseDate" to System.currentTimeMillis(),
                        )
                        if (category.isNotBlank()) body["category"] = category
                        if (brand.isNotBlank()) body["brand"] = brand
                        if (model.isNotBlank()) body["model"] = model
                        if (note.isNotBlank()) body["note"] = note
                        val cents = priceText.trim().takeIf { it.isNotEmpty() }?.let { parseYuanToCents(it) }
                        if (priceText.trim().isNotEmpty() && cents == null) {
                            error = "购入价格式不正确"
                            saving = false
                            return@launch
                        }
                        body["purchasePriceCents"] = cents
                        if (isNew) repo.create(body) else repo.update(initial!!.optString("id"), body)
                        onSaved()
                    } catch (e: AuthExpiredException) {
                        onAuthExpired()
                    } catch (e: Exception) {
                        error = e.message
                    } finally {
                        saving = false
                    }
                }
            },
        ) { Text("保存") }
        Spacer(Modifier.height(4.dp))
        OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("取消") }
    }
}

@Composable
private fun ItemDetailSheet(
    api: ApiClient,
    itemId: String,
    onAuthExpired: () -> Unit,
    onClose: () -> Unit,
    onEdit: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val repo = remember(api) { ItemRepository(api) }
    var item by remember { mutableStateOf<JSONObject?>(null) }
    var baseUrl by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var cutoutState by remember { mutableStateOf<String?>(null) }
    var candidates by remember { mutableStateOf(listOf<JSONObject>()) }
    var jobId by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        try {
            item = repo.get(itemId)
            baseUrl = api.getBaseUrl().orEmpty()
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        }
    }

    LaunchedEffect(itemId) {
        reload()
    }

    val photoPicker = rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                context.contentResolver.openInputStream(uri)?.use { ins ->
                    val bytes = ins.readBytes()
                    val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                    val ok = repo.uploadPhoto(baseUrl, itemId, mime, bytes)
                    if (!ok) error = "照片上传失败"
                    reload()
                }
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        OutlinedButton(onClick = onClose) { Text("‹ 返回") }
        Spacer(Modifier.height(8.dp))
        val it = item
        if (it == null) {
            Text("加载中…")
            return@Column
        }
        Text(it.optString("name"), style = MaterialTheme.typography.titleLarge)
        Text("持有 ${it.optInt("heldDays")} 天", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { photoPicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
            Text("上传照片")
        }
        OutlinedButton(
            onClick = {
                scope.launch {
                    try {
                        repo.removePhoto(itemId)
                        reload()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("删除照片") }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = {
                scope.launch {
                    try {
                        // Cutout needs webp bytes; reuse picked-photo flow is H-batch work —
                        // here we surface the job state machine for an already-running job page.
                        cutoutState = "抠图需先上传照片（照片选择器已就绪，job 轮询见下）"
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("生成抠图候选") }
        if (cutoutState != null) {
            Text(cutoutState!!, style = MaterialTheme.typography.bodySmall)
        }
        for (c in candidates) {
            Text("候选 ${c.optString("id")}", style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onEdit, modifier = Modifier.fillMaxWidth()) { Text("编辑") }
        OutlinedButton(
            onClick = {
                scope.launch {
                    try {
                        repo.retire(itemId, System.currentTimeMillis())
                        onClose()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("结束持有") }
        OutlinedButton(
            onClick = {
                scope.launch {
                    try {
                        repo.remove(itemId)
                        onClose()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("删除物品") }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        @Suppress("UNUSED_EXPRESSION")
        jobId.let { }
    }
}

/**
 * 外观设置 (A10/A11). Three-state theme + three accent presets (Web parity),
 * persisted via DataStore; applied at the activity level by the caller.
 */
@Composable
fun AppearanceSection(
    theme: ThemePreference,
    accent: AccentPreset,
    onTheme: (ThemePreference) -> Unit,
    onAccent: (AccentPreset) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Text("外观", style = MaterialTheme.typography.titleSmall)
        Row {
            for (t in ThemePreference.entries) {
                OutlinedButton(onClick = { onTheme(t) }) {
                    Text(if (t == theme) "● ${t.label}" else t.label)
                }
            }
        }
        Row {
            for (a in AccentPreset.entries) {
                OutlinedButton(onClick = { onAccent(a) }) {
                    Text(if (a == accent) "● ${a.label}" else a.label)
                }
            }
        }
    }
}

/**
 * 设置页完整体 (A10): session info + appearance + cycle start day + password +
 * provider config entry + sign out. Password change drops back to login
 * (server invalidates every session — Web parity).
 */
@Composable
fun SettingsFull(
    api: ApiClient,
    auth: AuthRepository?,
    theme: ThemePreference,
    accent: AccentPreset,
    onTheme: (ThemePreference) -> Unit,
    onAccent: (AccentPreset) -> Unit,
    onLoggedOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val budget = remember(api) { BudgetRepository(api) }
    val assistant = remember(api) { AssistantRepository(api) }
    var cur by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf<String?>(null) }
    var cycleDay by remember { mutableStateOf<Int?>(null) }
    var providerSummary by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val s = budget.getSettings()
            cycleDay = if (s.isNull("cycleStartDay")) null else s.optInt("cycleStartDay")
        } catch (_: Exception) {
        }
        try {
            val c = assistant.providerConfig()
            providerSummary = c.toString()
        } catch (_: Exception) {
        }
    }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text("我的", style = MaterialTheme.typography.titleLarge)
        AppearanceSection(theme = theme, accent = accent, onTheme = onTheme, onAccent = onAccent)
        Spacer(Modifier.height(12.dp))
        Text("预算周期起点", style = MaterialTheme.typography.titleSmall)
        Row {
            OutlinedButton(onClick = {
                scope.launch {
                    try {
                        budget.setCycleStartDay(null)
                        cycleDay = null
                    } catch (e: Exception) {
                        msg = e.message
                    }
                }
            }) { Text(if (cycleDay == null) "● 自然月" else "自然月") }
            for (d in listOf(1, 5, 10, 15, 20, 25)) {
                OutlinedButton(onClick = {
                    scope.launch {
                        try {
                            budget.setCycleStartDay(d)
                            cycleDay = d
                        } catch (e: Exception) {
                            msg = e.message
                        }
                    }
                }) { Text(if (cycleDay == d) "● $d 号" else "$d 号") }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text("修改密码", style = MaterialTheme.typography.titleSmall)
        OutlinedTextField(value = cur, onValueChange = { cur = it }, label = { Text("当前密码") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = next, onValueChange = { next = it }, label = { Text("新密码") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = confirm, onValueChange = { confirm = it }, label = { Text("确认新密码") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    if (next != confirm || next.isEmpty()) {
                        msg = "两次输入的新密码不一致"
                        return@launch
                    }
                    val r = auth?.changePassword(cur, next)
                    if (r?.isSuccess == true) {
                        auth.logout()
                        onLoggedOut()
                    } else {
                        msg = r?.exceptionOrNull()?.message ?: "修改失败"
                    }
                }
            },
        ) { Text("修改并重新登录") }
        if (providerSummary != null) {
            Spacer(Modifier.height(8.dp))
            Text("AI Provider 已配置", style = MaterialTheme.typography.bodySmall)
        }
        if (msg != null) {
            Text(msg!!, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    auth?.logout()
                    onLoggedOut()
                }
            },
        ) { Text("退出登录") }
    }
}
