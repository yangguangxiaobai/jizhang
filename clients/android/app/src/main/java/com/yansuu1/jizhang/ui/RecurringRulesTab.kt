package com.yansuu1.jizhang.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.net.OfflineException
import com.yansuu1.jizhang.repo.MetaRepository
import com.yansuu1.jizhang.repo.RecurringRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private data class RecurringCategory(val id: String, val name: String, val type: Int)
private data class RecurringAccount(val id: String, val name: String)
private data class RuleSnapshot(
    val rules: JSONObject,
    val expenseCategories: JSONObject,
    val incomeCategories: JSONObject,
    val accounts: JSONObject,
)

/**
 * Owns recurring-rule list and editing state while leaving date arithmetic and
 * amount truth with the API. A rule is shown as enabled/disabled only after the
 * server confirms the toggle.
 */
@Composable
@OptIn(ExperimentalFoundationApi::class)
fun RecurringRulesTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { RecurringRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var rules by remember { mutableStateOf(emptyList<JSONObject>()) }
    var categories by remember { mutableStateOf(emptyList<RecurringCategory>()) }
    var accounts by remember { mutableStateOf(emptyList<RecurringAccount>()) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var actionMessage by remember { mutableStateOf<String?>(null) }
    var busyRuleId by remember { mutableStateOf<String?>(null) }
    var needsReload by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var deleteTarget by remember { mutableStateOf<JSONObject?>(null) }
    val motion = LocalMotionTokens.current

    suspend fun reload() {
        loading = true
        loadError = null
        actionError = null
        try {
            val snapshot = coroutineScope {
                val ruleCall = async { repo.rules() }
                val expenseCall = async { meta.categories(type = 0) }
                val incomeCall = async { meta.categories(type = 1) }
                val accountCall = async { meta.accounts() }
                RuleSnapshot(
                    rules = ruleCall.await(),
                    expenseCategories = expenseCall.await(),
                    incomeCategories = incomeCall.await(),
                    accounts = accountCall.await(),
                )
            }
            rules = snapshot.rules.optJSONArray("items").toJsonObjects()
            categories = snapshot.expenseCategories.toCategories(0) + snapshot.incomeCategories.toCategories(1)
            accounts = snapshot.accounts.toAccounts()
            needsReload = false
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            loadError = e.message ?: "周期规则暂时无法读取。"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    if (editing != null) {
        RuleEditor(
            api = api,
            initial = editing,
            categories = categories,
            accounts = accounts,
            onAuthExpired = onAuthExpired,
            onSaved = {
                editing = null
                actionError = null
                actionMessage = if (it) "周期规则已创建。" else "周期规则已更新。"
                scope.launch { reload() }
            },
            onClose = { saveUncertain ->
                editing = null
                scope.launch {
                    reload()
                    actionMessage = if (saveUncertain && loadError == null) {
                        "规则列表已重新读取；请核对刚才的保存结果后再决定是否重试。"
                    } else if (saveUncertain) {
                        "保存结果仍未核对，规则列表刷新失败；请稍后重试读取。"
                    } else {
                        null
                    }
                }
            },
        )
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text("管理周期规则", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("规则只生成待确认项目；确认后才会记入账本。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = { scope.launch { reload() } }, enabled = !loading) {
                Text(if (loading && rules.isNotEmpty()) "更新中…" else "刷新")
            }
        }

        Button(
            onClick = {
                actionError = null
                actionMessage = null
                editing = JSONObject()
            },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            enabled = !needsReload,
        ) { Text("新建周期规则") }

        if (loading && rules.isEmpty()) {
            RuleStatePanel(
                title = "正在读取周期规则",
                body = "规则和分类信息来自当前账本。",
                loading = true,
            )
        } else if (loadError != null && rules.isEmpty()) {
            RuleStatePanel(
                title = "周期规则读取失败",
                body = loadError!!,
                actionLabel = "重试",
                retry = { scope.launch { reload() } },
            )
        } else {
            if (loading && !motion.reduced) androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth())
            if (loadError != null) {
                RuleInlineNotice(
                    message = "更新失败，当前显示上次读取的内容。${loadError!!}",
                    isError = true,
                    actionLabel = "重试",
                    onAction = { scope.launch { reload() } },
                )
            }
            actionError?.let {
                RuleInlineNotice(
                    message = it,
                    isError = true,
                    actionLabel = "重新读取",
                    onAction = {
                        actionError = null
                        scope.launch { reload() }
                    },
                )
            }
            actionMessage?.let {
                RuleInlineNotice(message = it, isError = false)
            }

            if (rules.isEmpty()) {
                RuleStatePanel(
                    title = "还没有周期规则",
                    body = "创建规则后，符合周期的项目会先进入待确认列表。",
                    actionLabel = "新建规则",
                    retry = {
                        actionError = null
                        actionMessage = null
                        editing = JSONObject()
                    },
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(rules, key = { it.optString("id") }) { rule ->
                        val rowMotion = LocalMotionTokens.current
                        RuleCard(
                            modifier = if (rowMotion.reduced || rowMotion.quickMillis == 0) {
                                Modifier
                            } else {
                                Modifier.animateItemPlacement(tween(durationMillis = rowMotion.quickMillis))
                            },
                            rule = rule,
                            categoryName = categories.firstOrNull { it.id == rule.optString("categoryId") }?.name
                                ?: "分类不可用",
                            accountName = accounts.firstOrNull { it.id == rule.optString("accountId") }?.name
                                ?: "账户不可用",
                            busy = busyRuleId == rule.optString("id"),
                            anyBusy = busyRuleId != null || needsReload,
                            onEdit = {
                                actionError = null
                                actionMessage = null
                                editing = JSONObject(rule.toString())
                            },
                            onDelete = { deleteTarget = rule },
                            onEnabledChange = { enabled ->
                                scope.launch {
                                    val id = rule.optString("id")
                                    busyRuleId = id
                                    actionError = null
                                    actionMessage = null
                                    try {
                                        val updated = repo.setEnabled(id, enabled)
                                        rules = rules.map { current ->
                                            if (current.optString("id") == id) updated else current
                                        }
                                        needsReload = false
                                        actionMessage = if (enabled) "规则已启用。" else "规则已停用。"
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: AuthExpiredException) {
                                        onAuthExpired()
                                    } catch (e: Exception) {
                                        needsReload = true
                                        actionError = "状态未确认，规则仍按上次读取的状态显示。${e.message.orEmpty()}"
                                    } finally {
                                        busyRuleId = null
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { if (busyRuleId == null) deleteTarget = null },
            title = { Text("删除周期规则？") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("将删除「${target.optString("name")}」规则及其尚未处理的待确认项目。已经确认入账的账单会保留。")
                    actionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = busyRuleId == null,
                    onClick = {
                        scope.launch {
                            val id = target.optString("id")
                            busyRuleId = id
                            actionError = null
                            actionMessage = null
                            try {
                                repo.removeRule(id)
                                rules = rules.filterNot { it.optString("id") == id }
                                needsReload = false
                                deleteTarget = null
                                actionMessage = "周期规则已删除。"
                                scope.launch { reload() }
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: AuthExpiredException) {
                                onAuthExpired()
                            } catch (e: Exception) {
                                needsReload = true
                                deleteTarget = null
                                actionError = "删除结果未确认；已暂停规则操作，请先重新读取后再决定是否重试。${e.message.orEmpty()}"
                            } finally {
                                busyRuleId = null
                            }
                        }
                    },
                ) { Text(if (busyRuleId == target.optString("id")) "删除中…" else "删除规则") }
            },
            dismissButton = {
                TextButton(enabled = busyRuleId == null, onClick = { deleteTarget = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun RuleCard(
    modifier: Modifier,
    rule: JSONObject,
    categoryName: String,
    accountName: String,
    busy: Boolean,
    anyBusy: Boolean,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onEnabledChange: (Boolean) -> Unit,
) {
    var menuExpanded by remember(rule.optString("id")) { mutableStateOf(false) }
    val enabled = rule.optBoolean("enabled")
    val motion = LocalMotionTokens.current

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(rule.optString("name", "未命名规则"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "${if (rule.optInt("type") == 1) "收入" else "支出"} · ${formatYuan(rule.optLong("amountCents"))}",
                        style = MaterialTheme.typography.titleSmall,
                        color = if (rule.optInt("type") == 1) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(if (enabled) "已启用" else "已停用", style = MaterialTheme.typography.labelMedium)
                    if (motion.reduced) {
                        TextButton(onClick = { onEnabledChange(!enabled) }, enabled = !anyBusy) {
                            Text(if (enabled) "停用" else "启用")
                        }
                    } else {
                        Switch(
                            checked = enabled,
                            onCheckedChange = onEnabledChange,
                            enabled = !anyBusy,
                            modifier = Modifier.size(width = 56.dp, height = 48.dp),
                        )
                    }
                }
                Box {
                    IconButton(onClick = { menuExpanded = true }, enabled = !anyBusy) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "${rule.optString("name")}规则操作")
                    }
                    DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                        DropdownMenuItem(text = { Text("编辑规则") }, onClick = { menuExpanded = false; onEdit() })
                        DropdownMenuItem(text = { Text("删除规则") }, onClick = { menuExpanded = false; onDelete() })
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RuleDetailPill(
                    "${freqLabel(rule.optString("frequency"))} · 锚点 ${dateInput(rule.optLong("anchorDate"))}",
                    Modifier.weight(1f),
                )
            }
            Text(
                "分类：$categoryName    账户：$accountName",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (busy) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!motion.reduced) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("正在等待服务器确认规则状态。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun RuleDetailPill(text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Text(text, modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp), style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun RuleOption(selected: Boolean, label: String, onClick: () -> Unit) {
    if (LocalMotionTokens.current.reduced) {
        OutlinedButton(onClick = onClick) { Text(if (selected) "✓ $label" else label) }
    } else {
        androidx.compose.material3.FilterChip(
            selected = selected,
            onClick = onClick,
            label = { Text(label) },
        )
    }
}

@Composable
private fun RuleStatePanel(
    title: String,
    body: String,
    loading: Boolean = false,
    actionLabel: String? = null,
    retry: (() -> Unit)? = null,
) {
    val motion = LocalMotionTokens.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.Start,
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (loading && !motion.reduced) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            if (actionLabel != null && retry != null) OutlinedButton(onClick = retry) { Text(actionLabel) }
        }
    }
}

@Composable
private fun RuleInlineNotice(
    message: String,
    isError: Boolean,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(message, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            if (actionLabel != null && onAction != null) TextButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}

private fun freqLabel(frequency: String): String = when (frequency) {
    "daily" -> "每天"
    "weekly" -> "每周"
    "monthly" -> "每月"
    "quarterly" -> "每季"
    "yearly" -> "每年"
    else -> "未知频率：$frequency"
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun RuleEditor(
    api: ApiClient,
    initial: JSONObject?,
    categories: List<RecurringCategory>,
    accounts: List<RecurringAccount>,
    onAuthExpired: () -> Unit,
    onSaved: (Boolean) -> Unit,
    onClose: (saveUncertain: Boolean) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { RecurringRepository(api) }
    val isNew = initial == null || !initial.has("id")
    val initialName = remember(initial) { initial?.optString("name").orEmpty() }
    val initialType = remember(initial) { initial?.optInt("type") ?: 0 }
    val initialAmount = remember(initial) {
        if (isNew) "" else formatYuan(initial?.optLong("amountCents") ?: 0L)
    }
    val initialCategoryId = remember(initial) { initial?.optString("categoryId").orEmpty() }
    val initialAccountId = remember(initial) { initial?.optString("accountId").orEmpty() }
    val initialFrequency = remember(initial) { initial?.optString("frequency") ?: "monthly" }
    val initialAnchor = remember(initial) {
        dateInput(initial?.optLong("anchorDate")?.takeIf { it > 0 } ?: System.currentTimeMillis())
    }
    var name by remember(initial) { mutableStateOf(initialName) }
    var type by remember(initial) { mutableStateOf(initialType) }
    var amountText by remember(initial) { mutableStateOf(initialAmount) }
    var categoryId by remember(initial) { mutableStateOf(initialCategoryId) }
    var accountId by remember(initial) { mutableStateOf(initialAccountId) }
    var frequency by remember(initial) { mutableStateOf(initialFrequency) }
    var anchor by remember(initial) { mutableStateOf(initialAnchor) }
    var saving by remember { mutableStateOf(false) }
    var saveUncertain by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showDiscardDialog by remember { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }

    val dirty = name != initialName || type != initialType || amountText != initialAmount ||
        categoryId != initialCategoryId || accountId != initialAccountId ||
        frequency != initialFrequency || anchor != initialAnchor

    fun requestClose() {
        if (saving) return
        if (dirty) showDiscardDialog = true else onClose(saveUncertain)
    }
    BackHandler(enabled = !showDatePicker && !showDiscardDialog) { requestClose() }

    val categoryOptions = categories.filter { it.type == type }
    Column(
        modifier = Modifier.fillMaxSize().imePadding(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().height(48.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = ::requestClose, enabled = !saving) { Text("‹ 返回规则") }
            Text(
                if (isNew) "新建周期规则" else "编辑周期规则",
                modifier = Modifier.weight(1f).padding(start = 8.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        Column(
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            RuleEditorSection("基本信息", "只设置规则本身；实际账单要在待确认页核对后才会入账。") {
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= 60) name = it },
                    label = { Text("规则名称") },
                    supportingText = { Text("最多 60 个字符") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RuleOption(selected = type == 0, label = "支出", onClick = {
                        type = 0
                        if (categories.none { it.id == categoryId && it.type == 0 }) categoryId = ""
                    })
                    RuleOption(selected = type == 1, label = "收入", onClick = {
                        type = 1
                        if (categories.none { it.id == categoryId && it.type == 1 }) categoryId = ""
                    })
                }
                OutlinedTextField(
                    value = amountText,
                    onValueChange = { amountText = it },
                    label = { Text("金额（元）") },
                    supportingText = { Text("提交时按整数分保存；金额由服务器用于实际账单。") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
            }

            RuleEditorSection("账单归属", "选择这条规则生成项目使用的分类和账户。") {
                RecurringDropdown(
                    label = "分类",
                    selectedId = categoryId,
                    selectedLabel = categoryOptions.firstOrNull { it.id == categoryId }?.name
                        ?: if (categoryId.isNotEmpty()) "原分类不可用，请重新选择" else "请选择分类",
                    enabled = categoryOptions.isNotEmpty(),
                    options = categoryOptions.map { it.id to it.name },
                    onSelect = { categoryId = it },
                )
                if (categoryOptions.isEmpty()) {
                    Text("当前收支类型没有可用分类，请先在分类管理中添加。", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                RecurringDropdown(
                    label = "账户",
                    selectedId = accountId,
                    selectedLabel = accounts.firstOrNull { it.id == accountId }?.name
                        ?: if (accountId.isNotEmpty()) "原账户不可用，请重新选择" else "请选择账户",
                    enabled = accounts.isNotEmpty(),
                    options = accounts.map { it.id to it.name },
                    onSelect = { accountId = it },
                )
                if (accounts.isEmpty()) {
                    Text("当前没有可用账户，请先添加账户。", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }

            RuleEditorSection("重复周期", "选择完整的周期频率，不会在此页面推算下一次发生日期。") {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    maxItemsInEachRow = 3,
                ) {
                    listOf(
                        "daily" to "每天",
                        "weekly" to "每周",
                        "monthly" to "每月",
                        "quarterly" to "每季",
                        "yearly" to "每年",
                    ).forEach { (value, label) -> RuleOption(selected = frequency == value, label = label, onClick = { frequency = value }) }
                }
                OutlinedTextField(
                    value = anchor,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("锚点起始日期") },
                    supportingText = { Text("${freqLabel(frequency)}的周期以此日期为锚点；服务端负责计算待确认日期。") },
                    trailingIcon = {
                        IconButton(onClick = { showDatePicker = true }) {
                            Icon(Icons.Filled.CalendarMonth, contentDescription = "选择锚点起始日期")
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }

            error?.let { RuleInlineNotice(message = it, isError = true) }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).imePadding(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedButton(
                onClick = ::requestClose,
                enabled = !saving,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text("取消") }
            Button(
                enabled = !saving && !saveUncertain,
                onClick = {
                    val cents = parseYuanToCents(amountText)
                    if (name.isBlank() || name.length > 60 || cents == null || cents <= 0 || categoryId.isEmpty() || accountId.isEmpty()) {
                        error = when {
                            name.isBlank() -> "请填写规则名称。"
                            cents == null || cents <= 0 -> "请输入大于 0 的有效金额。"
                            categoryId.isEmpty() -> "请选择当前收支类型的分类。"
                            accountId.isEmpty() -> "请选择账户。"
                            else -> "请检查输入内容。"
                        }
                        return@Button
                    }
                    val anchorDate = try {
                        parseDateInput(anchor)
                    } catch (e: Exception) {
                        error = e.message ?: "请选择有效的锚点日期。"
                        return@Button
                    }
                    error = null
                    saving = true
                    scope.launch {
                        try {
                            val body = mapOf(
                                "name" to name.trim(),
                                "type" to type,
                                "amountCents" to cents,
                                "categoryId" to categoryId,
                                "accountId" to accountId,
                                "frequency" to frequency,
                                "anchorDate" to anchorDate,
                            )
                            if (isNew) repo.createRule(body)
                            else repo.updateRule(initial!!.optString("id"), body)
                            onSaved(isNew)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: AuthExpiredException) {
                            onAuthExpired()
                        } catch (e: ApiException) {
                            if (e.status >= 500) saveUncertain = true
                            error = if (saveUncertain) {
                                "服务器未返回明确保存结果，输入仍保留。请先返回规则列表刷新核对，不要立即重复提交。${e.message.orEmpty()}"
                            } else {
                                "服务器未接受本次保存，输入仍保留。请按提示修正后再试。${e.message.orEmpty()}"
                            }
                        } catch (e: OfflineException) {
                            error = "当前离线，保存请求未提交；输入仍保留。${e.message.orEmpty()}"
                        } catch (e: Exception) {
                            saveUncertain = true
                            error = "保存结果未确认，输入内容仍保留。若请求超时，请先返回列表刷新核对再决定是否重试。${e.message.orEmpty()}"
                        } finally {
                            saving = false
                        }
                    }
                },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) {
                if (saving && !LocalMotionTokens.current.reduced) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                Text(if (saving) "保存中…" else "保存规则")
            }
        }
    }

    if (showDatePicker) {
        val dateState = rememberDatePickerState(initialSelectedDateMillis = datePickerUtcMillis(anchor))
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    dateState.selectedDateMillis?.let { anchor = dateFromPickerUtcMillis(it) }
                    showDatePicker = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("取消") } },
        ) { DatePicker(state = dateState) }
    }

    if (showDiscardDialog) {
        AlertDialog(
            onDismissRequest = { showDiscardDialog = false },
            title = { Text("放弃未保存的修改？") },
            text = {
                Text(
                    if (saveUncertain) {
                        "离开后，本页填写的规则内容将丢失。规则列表会重新读取，请先核对保存结果。"
                    } else {
                        "离开后，本页填写的规则内容将丢失。"
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = { showDiscardDialog = false; onClose(saveUncertain) }) { Text("放弃修改") }
            },
            dismissButton = { TextButton(onClick = { showDiscardDialog = false }) { Text("继续编辑") } },
        )
    }
}

@Composable
private fun RuleEditorSection(
    title: String,
    description: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}

@Composable
private fun RecurringDropdown(
    label: String,
    selectedId: String,
    selectedLabel: String,
    enabled: Boolean,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            OutlinedButton(
                onClick = { expanded = true },
                enabled = enabled,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(selectedLabel, modifier = Modifier.weight(1f), maxLines = 2)
                Text("⌄")
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { (id, name) ->
                    DropdownMenuItem(
                        text = { Text(if (id == selectedId) "✓  $name" else name) },
                        onClick = { onSelect(id); expanded = false },
                    )
                }
            }
        }
    }
}

private fun JSONArray?.toJsonObjects(): List<JSONObject> {
    val array = this ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}

private fun JSONObject.toCategories(type: Int): List<RecurringCategory> =
    optJSONArray("items").toJsonObjects().mapNotNull { item ->
        val id = item.optString("id")
        id.takeIf { it.isNotEmpty() }?.let {
            RecurringCategory(it, item.optString("name", "未命名分类"), item.optInt("type", type))
        }
    }

private fun JSONObject.toAccounts(): List<RecurringAccount> =
    optJSONArray("items").toJsonObjects().mapNotNull { item ->
        val id = item.optString("id")
        id.takeIf { it.isNotEmpty() }?.let { RecurringAccount(it, item.optString("name", "未命名账户")) }
    }

private fun datePickerUtcMillis(text: String): Long {
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
        isLenient = false
        timeZone = TimeZone.getTimeZone("UTC")
    }
    return try {
        formatter.parse(text)?.time ?: formatter.parse(dateInput())!!.time
    } catch (_: Exception) {
        formatter.parse(dateInput())!!.time
    }
}

private fun dateFromPickerUtcMillis(epochMs: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).apply {
    timeZone = TimeZone.getTimeZone("UTC")
}.format(Date(epochMs))
