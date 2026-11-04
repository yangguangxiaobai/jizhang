package com.yansuu1.jizhang.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AdminRepository
import com.yansuu1.jizhang.repo.MetaRepository
import com.yansuu1.jizhang.repo.BudgetRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray

private fun JSONObject.rows(): List<JSONObject> {
    val array = optJSONArray("items") ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}

private val categoryIconLabels = mapOf(
    "food" to "餐饮", "transport" to "交通", "housing" to "住房", "shopping" to "购物",
    "entertainment" to "娱乐", "salary" to "工资", "medical" to "医疗", "education" to "教育",
    "pet" to "宠物", "other" to "其他",
)

/** Small choice menu shared by the master-data editors and ledger filters. */
@Composable
internal fun ListChoice(label: String, choices: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label.isNotBlank()) Text(label, style = MaterialTheme.typography.labelLarge)
        Box {
            OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(choices.find { it.first == selected }?.second ?: "请选择")
                    Text("⌄", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                choices.forEach { (id, name) ->
                    DropdownMenuItem(
                        text = { Text(name) },
                        trailingIcon = { if (id == selected) Text("✓", color = MaterialTheme.colorScheme.primary) },
                        onClick = { expanded = false; onSelect(id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PaletteSelector(
    selected: String,
    palette: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
) {
    val options = if (palette.any { it.first == selected }) palette else listOf(selected to "保留原色") + palette
    val selectedName = options.firstOrNull { it.first == selected }?.second ?: "未选择"
    val motion = LocalMotionTokens.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("分类颜色", style = MaterialTheme.typography.labelLarge)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(20.dp).background(Color(selected.toLongOrNull(16)?.toInt() ?: 0xFF64748F.toInt()), CircleShape).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape))
            Text("当前：$selectedName", style = MaterialTheme.typography.bodyMedium)
            if (selectedName == "保留原色") Text("#${selected.uppercase()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        options.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { (argb, label) ->
                    val isSelected = argb == selected
                    val selectionSurface by animateColorAsState(
                        targetValue = if (isSelected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                        animationSpec = tween(durationMillis = motion.quickMillis),
                        label = "palette-selection-surface",
                    )
                    val selectionBorder by animateColorAsState(
                        targetValue = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                        animationSpec = tween(durationMillis = motion.quickMillis),
                        label = "palette-selection-border",
                    )
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 52.dp)
                            .semantics { contentDescription = label }
                            .selectable(
                                selected = isSelected,
                                role = Role.RadioButton,
                                onClick = { onSelect(argb) },
                            ),
                        shape = RoundedCornerShape(20.dp),
                        color = selectionSurface,
                        border = androidx.compose.foundation.BorderStroke(
                            if (isSelected) 2.dp else 1.dp,
                            selectionBorder,
                        ),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Box(Modifier.size(18.dp).background(Color(argb.toLong(16).toInt()), CircleShape).border(1.dp, MaterialTheme.colorScheme.outline, CircleShape))
                            Column {
                                Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1)
                                if (isSelected) Text("✓ 已选", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ManageTab(api: ApiClient, onAuthExpired: () -> Unit) {
    val scope = rememberCoroutineScope()
    val admin = remember(api) { AdminRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var tab by remember { mutableStateOf("categories") }
    var categories by remember { mutableStateOf(emptyList<JSONObject>()) }
    var accounts by remember { mutableStateOf(emptyList<JSONObject>()) }
    var tags by remember { mutableStateOf(emptyList<JSONObject>()) }
    var balances by remember { mutableStateOf(emptyMap<String, Long>()) }
    var loading by remember { mutableStateOf(true) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmationAction by remember { mutableStateOf("删除") }
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var kind by remember { mutableStateOf("category") }
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf(0) }
    var parent by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("other") }
    var color by remember { mutableStateOf("FF64748B") }
    var balance by remember { mutableStateOf("0.00") }
    var confirmation by remember { mutableStateOf<Pair<String, suspend () -> Unit>?>(null) }
    val accountTypes = listOf("现金", "储蓄卡", "信用卡", "支付宝", "微信", "其他")
    // Mirrors packages/shared/src/palette.ts; these are presentation values.
    val palette = listOf("FF2A78D6" to "蓝", "FFD95D1E" to "橙", "FF0F8F77" to "青", "FFB8860B" to "黄", "FFD2497E" to "粉", "FF178A17" to "绿", "FF6B4FD0" to "紫", "FFD63A3A" to "红", "FF1A8BAB" to "天蓝", "FFA85C1E" to "棕", "FF9A3F8F" to "梅红", "FF6F8A10" to "橄榄")

    fun fail(e: Exception) {
        if (e is CancellationException) throw e
        if (e is AuthExpiredException) onAuthExpired() else error = e.message ?: "操作失败，请重试"
    }
    suspend fun reload() {
        if (!loaded) loading = true
        try {
            val nextCategories = admin.categories().rows()
            val nextAccounts = admin.accounts().rows()
            val nextTags = meta.tags().rows()
            val nextBalances = meta.balances().rows().associate { it.getString("accountId") to it.getLong("balanceCents") }
            categories = nextCategories
            accounts = nextAccounts
            tags = nextTags
            balances = nextBalances
            loaded = true
            error = null
        } finally { loading = false }
    }
    fun perform(action: suspend () -> Unit) {
        if (busy) return
        scope.launch {
            busy = true; error = null
            try { action() } catch (e: Exception) { fail(e) } finally { busy = false }
        }
    }
    fun edit(k: String, row: JSONObject) {
        kind = k; draft = row; error = null
        name = row.optString("name")
        type = row.optInt("type")
        parent = if (row.isNull("parentId")) "" else row.optString("parentId")
        icon = row.optString("icon", "other")
        color = row.optLong("color", 0xFF178A17L).toString(16).uppercase().padStart(8, '0')
        balance = formatYuan(row.optLong("initialBalanceCents"))
    }
    LaunchedEffect(api) { try { reload() } catch (e: Exception) { fail(e) } }
    val tabs = listOf("categories" to "分类", "accounts" to "账户", "tags" to "标签")
    val selectedTabIndex = tabs.indexOfFirst { it.first == tab }.coerceAtLeast(0)
    val visibleRows = when (tab) { "categories" -> categories; "accounts" -> accounts; else -> tags }
    val pageTitle = when (tab) { "categories" -> "分类管理"; "accounts" -> "账户管理"; else -> "标签管理" }
    val pageHint = when (tab) {
        "categories" -> "按支出、收入和父子层级整理分类。"
        "accounts" -> "余额来自服务端；初始余额是独立的账本设置。"
        else -> "标签在账单中使用；改名或删除会影响关联账单。"
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(pageTitle, style = MaterialTheme.typography.headlineSmall)
        Text(pageHint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TabRow(selectedTabIndex = selectedTabIndex) {
            tabs.forEachIndexed { index, (key, label) ->
                Tab(selected = selectedTabIndex == index, onClick = { tab = key }, enabled = !busy, text = { Text(label) })
            }
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = { perform { reload() } },
                enabled = !busy,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) {
                Text(if (busy) "处理中…" else "刷新")
            }
            if (tab != "tags") {
                Button(
                    onClick = { edit(if (tab == "categories") "category" else "account", JSONObject()) },
                    enabled = !busy && loaded,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                ) { Text(if (tab == "categories") "新建分类" else "新建账户") }
            }
        }
        if (loaded && draft == null) error?.let {
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(20.dp)) {
                Text(it, Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
        when {
            loading -> Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("正在加载${pageTitle}…", style = MaterialTheme.typography.titleSmall)
                    Text("列表会在读取完成后显示。", style = MaterialTheme.typography.bodySmall)
                }
            }
            !loaded -> Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.errorContainer) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("暂时无法读取${pageTitle}", style = MaterialTheme.typography.titleSmall)
                    Text(error ?: "请检查网络后重试。", style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = { perform { reload() } }, enabled = !busy) { Text("重试") }
                }
            }
            visibleRows.isEmpty() -> Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(when (tab) { "categories" -> "还没有分类"; "accounts" -> "还没有账户"; else -> "暂时没有标签" }, style = MaterialTheme.typography.titleMedium)
                    Text(when (tab) {
                        "categories" -> "创建分类后，可在账单和预算中选择它。"
                        "accounts" -> "创建账户后，可用于记录账单和查看余额。"
                        else -> "在账单中使用标签后，会在这里显示引用数量。"
                    }, style = MaterialTheme.typography.bodyMedium)
                    if (tab != "tags") Button(onClick = { edit(if (tab == "categories") "category" else "account", JSONObject()) }, enabled = !busy) {
                        Text(if (tab == "categories") "新建分类" else "新建账户")
                    }
                }
            }
            else -> LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(visibleRows, key = { it.optString(if (tab == "tags") "name" else "id") }) { row ->
                    val id = row.optString("id")
                    val itemKind = if (tab == "categories") "category" else "account"
                    val parentId = row.optString("parentId").takeUnless { row.isNull("parentId") }.orEmpty()
                    val parentName = categories.firstOrNull { it.optString("id") == parentId }?.optString("name")?.takeIf { it.isNotBlank() }
                    val motion = LocalMotionTokens.current
                    Card(Modifier.fillMaxWidth()
                        .padding(start = if (tab == "categories" && parentId.isNotEmpty()) 16.dp else 0.dp)
                        .animateItemPlacement(tween(durationMillis = motion.quickMillis))) {
                        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(row.optString("name"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                    when (tab) {
                                        "categories" -> {
                                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(50)) {
                                                    Text(if (row.optInt("type") == 0) "支出" else "收入", Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
                                                }
                                                if (row.optBoolean("isBuiltin")) Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(50)) {
                                                    Text("内建", Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium)
                                                }
                                            }
                                            Text("图标 · ${categoryIconLabels[row.optString("icon")] ?: row.optString("icon").ifBlank { "其他" }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            Text(
                                                if (parentId.isEmpty()) {
                                                    if (row.optInt("type") == 0) "父模块 · 可包含子分类" else "独立收入分类"
                                                } else "子分类 · ${parentName ?: "父级已移除"}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        "accounts" -> {
                                            val accountType = accountTypes.getOrElse(row.optInt("type")) { "其他" }
                                            Text("$accountType${if (row.optBoolean("isBuiltin")) " · 内建" else ""}", style = MaterialTheme.typography.bodySmall)
                                            Text("当前余额  ${balances[id]?.let { formatYuan(it) } ?: "—"}", style = MaterialTheme.typography.bodyLarge)
                                            Text("初始余额  ${formatYuan(row.optLong("initialBalanceCents"))}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            if (balances[id]?.let { it < 0 } == true) Text("负余额", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                                        }
                                        else -> Text("引用账单  ${row.optInt("count")} 笔", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                                if (tab == "categories") {
                                    Box(Modifier.size(22.dp).background(Color(row.optLong("color", 0xFF64748FL).toInt()), CircleShape))
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                TextButton(
                                    onClick = { edit(if (tab == "tags") "tag" else itemKind, row) },
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                ) { Text(if (tab == "tags") "改名" else "编辑") }
                                if (!row.optBoolean("isBuiltin")) TextButton(
                                    onClick = {
                                        perform {
                                            val impact = when (tab) {
                                                "categories" -> {
                                                    val count = admin.categoryUsage(id).getInt("transactions")
                                                    val children = categories.count { it.optString("parentId") == id }
                                                    "删除「${row.optString("name") }」？有 $count 笔账单引用，历史名称保留；$children 个子分类会变为独立分类。"
                                                }
                                                "accounts" -> {
                                                    val count = admin.accountUsage(id).getInt("transactions")
                                                    "删除「${row.optString("name") }」？有 $count 笔账单引用，历史账单保留；该账户当前余额 ${balances[id]?.let { formatYuan(it) } ?: "—"} 将从总余额中移除。"
                                                }
                                                else -> "从相关账单中移除标签「${row.optString("name") }」；账单本身不会删除。"
                                            }
                                            val selectedTab = tab
                                            confirmationAction = "删除"
                                            confirmation = impact to {
                                                when (selectedTab) {
                                                    "categories" -> admin.removeCategory(id)
                                                    "accounts" -> admin.removeAccount(id)
                                                    else -> admin.removeTag(row.getString("name"))
                                                }
                                                reload()
                                            }
                                        }
                                    },
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                ) { Text("删除") }
                            }
                            if (tab != "tags") Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                listOf(-1 to "上移", 1 to "下移").forEach { (direction, label) ->
                                    OutlinedButton(
                                        onClick = { perform { if (itemKind == "category") admin.moveCategory(id, direction) else admin.moveAccount(id, direction); reload() } },
                                        enabled = !busy,
                                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                    ) { Text(label) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    draft?.let { row ->
        val editorTitle = when (kind) {
            "category" -> if (row.has("id")) "编辑分类" else "新建分类"
            "account" -> if (row.has("id")) "编辑账户" else "新建账户"
            else -> "重命名标签"
        }
        AlertDialog(onDismissRequest = { if (!busy) draft = null }, title = { Text(editorTitle) }, text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).imePadding(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    when (kind) {
                        "category" -> "分类会用于账单筛选和预算分配。"
                        "account" -> "初始余额允许为负数，会参与服务端余额计算。"
                        else -> "改名会同步更新相关账单中的标签名称。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(name, { name = it }, modifier = Modifier.fillMaxWidth(), label = { Text(if (kind == "tag") "标签名称" else "名称") }, singleLine = true)
                if (kind == "category") {
                    if (!row.has("id")) ListChoice("类型", listOf("0" to "支出", "1" to "收入"), type.toString()) { type = it.toInt(); parent = "" }
                    if (type == 0) ListChoice("父模块", listOf("" to "独立分类") + categories.filter {
                        it.optInt("type") == 0 && it.isNull("parentId") && it.optString("id") != row.optString("id")
                    }.map { it.getString("id") to it.getString("name") }, parent) { parent = it }
                    ListChoice("图标", listOf("food" to "餐饮", "transport" to "交通", "housing" to "住房", "shopping" to "购物", "entertainment" to "娱乐", "salary" to "工资", "medical" to "医疗", "education" to "教育", "pet" to "宠物", "other" to "其他"), icon) { icon = it }
                    PaletteSelector(selected = color, palette = palette) { color = it }
                }
                if (kind == "account") {
                    ListChoice("账户类型", accountTypes.mapIndexed { index, label -> index.toString() to label }, type.toString()) { type = it.toInt() }
                    OutlinedTextField(
                        balance,
                        { balance = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("初始余额（元，可为负数）") },
                        supportingText = { Text("保存后由服务端按账本规则计算当前余额。") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }, confirmButton = {
            Button(enabled = !busy, onClick = { perform {
                require(name.trim().isNotEmpty()) { "请输入名称" }
                when (kind) {
                    "category" -> {
                        val argb = color.trim().removePrefix("#").takeIf { it.length == 8 }?.toLongOrNull(16)
                        require(argb != null && argb in 0..0xFFFFFFFFL) { "颜色需为8位十六进制 ARGB" }
                        val input = mutableMapOf<String, Any?>("name" to name.trim(), "icon" to icon, "color" to argb, "parentId" to if (type == 0 && parent.isNotEmpty()) parent else JSONObject.NULL)
                        if (row.has("id")) admin.updateCategory(row.getString("id"), input) else { input["type"] = type; admin.createCategory(input) }
                    }
                    "account" -> {
                        val cents = balance.trim().ifEmpty { "0" }.toBigDecimalOrNull()?.movePointRight(2)?.let {
                            try { it.longValueExact() } catch (_: ArithmeticException) { null }
                        }
                        require(cents != null && cents in -9007199254740991L..9007199254740991L) { "初始余额格式不正确，请最多输入两位小数" }
                        if (row.has("id")) admin.updateAccount(row.getString("id"), mapOf("name" to name.trim(), "type" to type, "initialBalanceCents" to cents)) else admin.createAccount(name.trim(), type, cents)
                    }
                    else -> admin.renameTag(row.getString("name"), name.trim())
                }
                draft = null; reload()
            } }) { Text(if (busy) "保存中…" else "保存") }
        }, dismissButton = { OutlinedButton(onClick = { draft = null }, enabled = !busy) { Text("取消") } })
    }
    confirmation?.let { (message, action) ->
        AlertDialog(onDismissRequest = { if (!busy) confirmation = null }, title = { Text("确认删除") }, text = { Text(message) }, confirmButton = {
            Button(enabled = !busy, onClick = { perform { action(); confirmation = null } }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError)) { Text(confirmationAction) }
        }, dismissButton = { OutlinedButton(onClick = { confirmation = null }, enabled = !busy) { Text("取消") } })
    }
}
@Composable
fun TemplatesTab(api: ApiClient, onAuthExpired: () -> Unit) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { BudgetRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var templates by remember { mutableStateOf(emptyList<JSONObject>()) }
    var categories by remember { mutableStateOf(emptyList<JSONObject>()) }
    var loading by remember { mutableStateOf(true) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var name by remember { mutableStateOf("") }
    var ratios by remember { mutableStateOf(emptyMap<String, String>()) }
    var addMenuExpanded by remember { mutableStateOf(false) }
    var confirmation by remember { mutableStateOf<Pair<String, suspend () -> Unit>?>(null) }
    var confirmationAction by remember { mutableStateOf("确认") }

    suspend fun reload() {
        if (!loaded) loading = true
        try {
            val nextTemplates = repo.templates().rows()
            val nextCategories = meta.categories(0).rows()
            templates = nextTemplates
            categories = nextCategories
            loaded = true
            error = null
        } finally { loading = false }
    }
    fun perform(action: suspend () -> Unit) {
        if (busy) return
        scope.launch {
            busy = true
            error = null
            message = null
            try {
                action()
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                onAuthExpired()
            } catch (e: Exception) {
                error = e.message ?: "操作失败"
            } finally {
                busy = false
                loading = false
            }
        }
    }
    fun edit(row: JSONObject) {
        draft = row
        name = row.optString("name")
        error = null
        val modules = row.optJSONArray("modules")
        ratios = (0 until (modules?.length() ?: 0)).associate {
            val module = modules!!.getJSONObject(it)
            module.getString("categoryId") to java.math.BigDecimal.valueOf(module.getDouble("ratio")).movePointRight(2).stripTrailingZeros().toPlainString()
        }
        addMenuExpanded = false
    }
    LaunchedEffect(api) { perform { reload() } }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("分配模板", style = MaterialTheme.typography.headlineSmall)
        Text("模板按比例分配工资。应用到当前周期会替换该周期现有工资分配。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { perform { reload() } }, enabled = !busy, modifier = Modifier.weight(1f)) { Text(if (busy) "处理中…" else "刷新") }
            Button(onClick = { edit(JSONObject()) }, enabled = !busy && loaded, modifier = Modifier.weight(1f)) { Text("新建模板") }
        }
        if (loaded && draft == null) error?.let {
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(20.dp)) {
                Text(it, Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
        message?.let {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(20.dp)) {
                Text(it, Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
        }
        when {
            loading -> Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("正在加载分配模板…", style = MaterialTheme.typography.titleSmall)
                    Text("模板和可分配分类会在读取完成后显示。", style = MaterialTheme.typography.bodySmall)
                }
            }
            !loaded -> Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.errorContainer) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("暂时无法读取模板", style = MaterialTheme.typography.titleSmall)
                    Text(error ?: "请检查网络后重试。", style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = { perform { reload() } }, enabled = !busy) { Text("重试") }
                }
            }
            templates.isEmpty() -> Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("还没有分配模板", style = MaterialTheme.typography.titleMedium)
                    Text("创建模板后，可在新增工资时选择它，或手动应用到当前周期。", style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = { edit(JSONObject()) }, enabled = !busy) { Text("新建模板") }
                }
            }
            else -> LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(templates, key = { it.getString("id") }) { row ->
                    val modules = row.optJSONArray("modules")
                    val totalRatio = (0 until (modules?.length() ?: 0)).fold(java.math.BigDecimal.ZERO) { total, index ->
                        total.add(java.math.BigDecimal.valueOf(modules!!.getJSONObject(index).optDouble("ratio")).movePointRight(2))
                    }.stripTrailingZeros().toPlainString()
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(row.optString("name"), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                if (row.optBoolean("isDefault")) Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(50)) {
                                    Text("默认模板", Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                }
                            }
                            Text("比例合计  $totalRatio%", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                for (index in 0 until (modules?.length() ?: 0)) {
                                    val module = modules!!.getJSONObject(index)
                                    val categoryId = module.optString("categoryId")
                                    val category = categories.firstOrNull { it.optString("id") == categoryId }
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                        Text(category?.optString("name") ?: "已移除分类 · $categoryId", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                                        Text("${java.math.BigDecimal.valueOf(module.optDouble("ratio")).movePointRight(2).stripTrailingZeros().toPlainString()}%", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    }
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = { edit(row) }, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("编辑") }
                                if (!row.optBoolean("isDefault")) TextButton(
                                    onClick = { perform { repo.setDefaultTemplate(row.getString("id")); reload(); message = "已将「${row.optString("name")}」设为默认模板" } },
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                ) { Text("设为默认") }
                                TextButton(
                                    onClick = {
                                        confirmationAction = "删除模板"
                                        confirmation = "删除模板「${row.optString("name") }」？历史工资分配会保留。" to {
                                            repo.removeTemplate(row.getString("id"))
                                            reload()
                                        }
                                    },
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                ) { Text("删除") }
                            }
                            OutlinedButton(
                                onClick = {
                                    confirmationAction = "应用模板"
                                    confirmation = "将「${row.optString("name") }」应用到当前周期？这会覆盖该周期现有工资分配。" to {
                                        repo.applyTemplateToCurrent(row.getString("id"))
                                        reload()
                                        message = "已应用到当前周期。"
                                    }
                                },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            ) { Text("应用到当前周期") }
                        }
                    }
                }
            }
        }
    }

    draft?.let { row ->
        val selectedIds = ratios.keys
        val ratioValues = ratios.filterValues { it.isNotBlank() }.mapValues { (_, value) -> value.trim().toBigDecimalOrNull() }
        val hasEmptyRatio = ratios.values.any { it.isBlank() }
        val hasInvalidRatio = ratioValues.values.any { it == null }
        val ratioTotal = ratioValues.values.filterNotNull().fold(java.math.BigDecimal.ZERO) { total, value -> total.add(value) }
        val ratioDelta = ratioTotal.subtract(java.math.BigDecimal("100")).abs()
        val ratioWithinServerTolerance = ratioDelta < java.math.BigDecimal("0.01")
        val missingCategoryIds = selectedIds.filter { id -> categories.none { it.optString("id") == id } }
        val hierarchyConflict = categories.firstOrNull { category ->
            category.optString("id") in selectedIds && !category.isNull("parentId") && category.optString("parentId") in selectedIds
        }
        val eligibleCategories = categories.filter { category ->
            val id = category.optString("id")
            id !in selectedIds &&
                categories.none { it.optString("id") in selectedIds && it.optString("parentId") == id } &&
                (category.isNull("parentId") || category.optString("parentId") !in selectedIds)
        }
        val categoryName: (String) -> String = { id -> categories.firstOrNull { it.optString("id") == id }?.optString("name") ?: "已移除分类 · $id" }
        AlertDialog(onDismissRequest = { if (!busy) draft = null }, title = { Text(if (row.has("id")) "编辑模板" else "新建模板") }, text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState()).imePadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("选择要分配的分类，只为已选分类填写比例。比例合计必须为 100%。应用到当前周期会覆盖该周期现有工资分配。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(name, { name = it }, modifier = Modifier.fillMaxWidth(), label = { Text("模板名称") }, singleLine = true)
                Text("分配模块", style = MaterialTheme.typography.titleSmall)
                if (ratios.isEmpty()) Text("还没有选择分类。添加分类后再填写比例。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                ratios.forEach { (id, value) ->
                    val missing = id in missingCategoryIds
                    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = if (missing) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant)) {
                        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(categoryName(id), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                TextButton(onClick = { ratios = ratios - id }, enabled = !busy) { Text("移除") }
                            }
                            if (missing) Text("该分类已从账本移除。请明确移除这一分配项后保存。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
                            OutlinedTextField(
                                value = value,
                                onValueChange = { ratios = ratios + (id to it) },
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text("分配比例（%）") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                singleLine = true,
                            )
                        }
                    }
                }
                Box {
                    OutlinedButton(onClick = { addMenuExpanded = true }, enabled = !busy && eligibleCategories.isNotEmpty(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text(if (eligibleCategories.isEmpty()) "没有可添加的分类" else "添加分配分类")
                    }
                    DropdownMenu(expanded = addMenuExpanded, onDismissRequest = { addMenuExpanded = false }) {
                        eligibleCategories.forEach { category ->
                            val id = category.optString("id")
                            DropdownMenuItem(text = { Text(category.optString("name")) }, onClick = { ratios = ratios + (id to ""); addMenuExpanded = false })
                        }
                    }
                }
                Text(
                    when {
                        hasInvalidRatio -> "合计暂不可计算，请检查比例格式。"
                        hasEmptyRatio -> "请为每个已选分类填写比例。"
                        else -> "比例合计  ${ratioTotal.stripTrailingZeros().toPlainString()}%  ·  剩余 ${java.math.BigDecimal("100").subtract(ratioTotal).stripTrailingZeros().toPlainString()}%"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = if (hasInvalidRatio || hasEmptyRatio || !ratioWithinServerTolerance) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
                if (hierarchyConflict != null) Text("父模块与子分类不能同时分配，请移除其中一项。", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }, confirmButton = {
            Button(enabled = !busy, onClick = { perform {
                require(name.trim().isNotEmpty()) { "请输入模板名称" }
                require(ratios.isNotEmpty()) { "请至少选择一个分配分类" }
                require(missingCategoryIds.isEmpty()) { "模板包含已移除的分类，请明确移除后再保存" }
                require(!hasEmptyRatio) { "请为每个已选分类填写比例" }
                require(!hasInvalidRatio) { "比例格式不正确，请只输入数字" }
                require(hierarchyConflict == null) { "父模块与子分类不能同时分配" }
                require(ratioWithinServerTolerance) { "比例合计必须为100%" }
                val modules = ratios.map { (id, value) ->
                    val percent = value.trim().toBigDecimal()
                    require(percent > java.math.BigDecimal.ZERO && percent <= java.math.BigDecimal("100")) { "单项比例需大于0且不超过100%" }
                    mapOf<String, Any?>("categoryId" to id, "ratio" to percent.divide(java.math.BigDecimal("100")).toDouble())
                }
                if (row.has("id")) repo.updateTemplate(row.getString("id"), mapOf("name" to name.trim(), "modules" to JSONArray(modules.map { JSONObject(it) }))) else repo.createTemplate(name.trim(), modules)
                draft = null
                reload()
            } }) { Text(if (busy) "保存中…" else "保存") }
        }, dismissButton = { OutlinedButton(onClick = { draft = null }, enabled = !busy) { Text("取消") } })
    }
    confirmation?.let { (label, action) ->
        AlertDialog(onDismissRequest = { if (!busy) confirmation = null }, title = { Text("请确认") }, text = { Text(label) }, confirmButton = {
            Button(enabled = !busy, onClick = { perform { action(); confirmation = null } }) { Text(confirmationAction) }
        }, dismissButton = { OutlinedButton(onClick = { confirmation = null }, enabled = !busy) { Text("取消") } })
    }
}
