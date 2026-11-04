package com.yansuu1.jizhang.ui

import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.MetaRepository
import com.yansuu1.jizhang.repo.RecurringRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

private enum class PendingAction { Confirm, Ignore }
private data class PendingChoice(val item: JSONObject, val action: PendingAction)
private data class PendingNames(
    val categoryNames: Map<String, String>,
    val accountNames: Map<String, String>,
)

/**
 * Shows server-generated occurrences as decisions, not as bills. Only a
 * confirmed API response allows an item to leave the pending list.
 */
@Composable
@OptIn(ExperimentalFoundationApi::class)
fun PendingTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    showPageHeader: Boolean = false,
    onBack: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { RecurringRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var items by remember { mutableStateOf(emptyList<JSONObject>()) }
    var total by remember { mutableStateOf(0) }
    var totalIsCurrent by remember { mutableStateOf(false) }
    var hasLoaded by remember { mutableStateOf(false) }
    var categoryNames by remember { mutableStateOf(emptyMap<String, String>()) }
    var accountNames by remember { mutableStateOf(emptyMap<String, String>()) }
    var masterDataLoaded by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var actionMessage by remember { mutableStateOf<String?>(null) }
    var generationNotice by remember { mutableStateOf<String?>(null) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var choice by remember { mutableStateOf<PendingChoice?>(null) }
    var reconciling by remember { mutableStateOf(false) }
    var needsReconcile by remember { mutableStateOf(false) }

    suspend fun readPending(generateFirst: Boolean) {
        loading = true
        loadError = null
        var failingStage = if (generateFirst) "generate" else "pending"
        if (generateFirst) generationNotice = null
        try {
            if (generateFirst) {
                val generated = repo.generate()
                val truncated = generated.optInt("truncated")
                generationNotice = if (truncated > 0) {
                    "$truncated 条周期规则超过本次生成上限；再次刷新可继续处理。"
                } else {
                    null
                }
            }
            failingStage = "pending"
            val response = repo.pending()
            val array = response.optJSONArray("items")
            val fresh = (0 until (array?.length() ?: 0)).mapNotNull { array?.optJSONObject(it) }
            items = fresh
            total = response.optInt("total")
            totalIsCurrent = true
            hasLoaded = true
            needsReconcile = false
            loadError = null
            actionError = null

            if (fresh.isEmpty()) {
                categoryNames = emptyMap()
                accountNames = emptyMap()
                masterDataLoaded = true
            } else {
                // Supplemental names improve the review row. A metadata failure must not
                // hide or discard the pending occurrences themselves.
                try {
                    val names = coroutineScope {
                        val categoriesCall = async { meta.categories() }
                        val accountsCall = async { meta.accounts() }
                        PendingNames(
                            categoryNames = categoriesCall.await().optJSONArray("items").toNameMap(),
                            accountNames = accountsCall.await().optJSONArray("items").toNameMap(),
                        )
                    }
                    categoryNames = names.categoryNames
                    accountNames = names.accountNames
                    masterDataLoaded = true
                } catch (e: CancellationException) {
                    throw e
                } catch (e: AuthExpiredException) {
                    onAuthExpired()
                } catch (e: Exception) {
                    masterDataLoaded = false
                    categoryNames = emptyMap()
                    accountNames = emptyMap()
                    actionError = "分类或账户名称暂时无法读取；请刷新后再确认，待确认项目仍保留。${e.message.orEmpty()}"
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            needsReconcile = true
            totalIsCurrent = false
            loadError = when (failingStage) {
                "generate" -> "生成待确认项目失败；列表未更新。${e.message.orEmpty()}"
                else -> "读取待确认列表失败；当前保留上次列表。${e.message.orEmpty()}"
            }
        } finally {
            loading = false
        }
    }

    suspend fun reconcile(id: String) {
        reconciling = true
        actionError = null
        loadError = null
        try {
            val response = repo.pending()
            val array = response.optJSONArray("items")
            val fresh = (0 until (array?.length() ?: 0)).mapNotNull { array?.optJSONObject(it) }
            items = fresh
            total = response.optInt("total")
            totalIsCurrent = true
            hasLoaded = true
            needsReconcile = false
            if (fresh.none { it.optString("id") == id }) {
                choice = null
                actionMessage = "此项已从待确认列表中移除，页面已按服务器结果更新。"
            } else {
                actionError = "服务器仍显示此项待确认；请核对后再选择操作。"
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            actionError = "核对结果失败，请保持当前页面并稍后重试。${e.message.orEmpty()}"
        } finally {
            reconciling = false
        }
    }

    suspend fun perform(choiceToRun: PendingChoice) {
        val item = choiceToRun.item
        val id = item.optString("id")
        busyId = id
        actionError = null
        actionMessage = null
        needsReconcile = true
        try {
            when (choiceToRun.action) {
                PendingAction.Confirm -> {
                    val result = repo.confirm(id)
                    actionMessage = if (result.optBoolean("created", true)) {
                        "已确认并记入账本；相关页面将在刷新后更新。"
                    } else {
                        "此项此前已经确认，已同步服务端结果。"
                    }
                }
                PendingAction.Ignore -> {
                    repo.ignore(id)
                    actionMessage = "已忽略此周期项目，不会创建账单。"
                }
            }
            // The server has confirmed this decision, so removing this row is no
            // longer optimistic. The total remains marked stale until GET /pending.
            items = items.filterNot { it.optString("id") == id }
            totalIsCurrent = false
            needsReconcile = false
            choice = null
            readPending(generateFirst = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            actionError = "操作结果未确认。先刷新或核对结果，再决定是否重试，避免按旧状态操作。${e.message.orEmpty()}"
        } finally {
            busyId = null
        }
    }

    LaunchedEffect(Unit) { readPending(generateFirst = true) }

    val motion = LocalMotionTokens.current
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showPageHeader && onBack != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack, enabled = busyId == null, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                Column(Modifier.weight(1f)) {
                    Text("待确认周期账单", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text("核对后逐项确认或忽略", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { scope.launch { readPending(generateFirst = true) } }, enabled = !loading && busyId == null) {
                    Icon(Icons.Filled.Refresh, contentDescription = "生成并刷新待确认列表")
                }
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("待确认项目", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text("金额尚未记入账本；每项需单独核对。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { scope.launch { readPending(generateFirst = true) } }, enabled = !loading && busyId == null, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Filled.Refresh, contentDescription = "生成并刷新待确认列表")
                }
            }
        }

        if (hasLoaded) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer,
                ) {
                    Text(
                        if (totalIsCurrent) "服务器待确认：$total 项" else "上次读取：$total 项",
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                if (loading && items.isNotEmpty()) {
                    Text("正在更新…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        if (loading && items.isEmpty()) {
            PendingStatePanel(
                title = "正在检查周期账单",
                body = "按服务端周期生成待确认项目，不会自动记入账本。",
                loading = true,
            )
        } else if (loadError != null && items.isEmpty()) {
            PendingStatePanel(
                title = "待确认列表暂不可用",
                body = loadError!!,
                actionLabel = "重试",
                onAction = { scope.launch { readPending(generateFirst = true) } },
            )
        } else {
            if (loading && !motion.reduced) LinearProgressIndicator(Modifier.fillMaxWidth())
            loadError?.let {
                PendingInlineNotice(
                    message = "更新失败，仍显示上次列表。$it",
                    isError = true,
                    actionLabel = "重试",
                    onAction = { scope.launch { readPending(generateFirst = true) } },
                )
            }
            generationNotice?.let { PendingInlineNotice(message = it, isError = false) }
            actionError?.let {
                PendingInlineNotice(
                    message = it,
                    isError = true,
                    actionLabel = "刷新列表",
                    onAction = { scope.launch { readPending(generateFirst = true) } },
                )
            }
            actionMessage?.let { PendingInlineNotice(message = it, isError = false) }

            if (items.isEmpty()) {
                PendingStatePanel(
                    title = "目前没有待确认周期账单",
                    body = "新生成的周期项目会先停留在这里，确认后才会创建账单。",
                    actionLabel = "重新检查",
                    onAction = { scope.launch { readPending(generateFirst = true) } },
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(items, key = { it.optString("id") }) { occurrence ->
                        val rowMotion = LocalMotionTokens.current
                        PendingCard(
                            modifier = if (rowMotion.reduced || rowMotion.quickMillis == 0) {
                                Modifier
                            } else {
                                Modifier.animateItemPlacement(tween(durationMillis = rowMotion.quickMillis))
                            },
                            item = occurrence,
                            categoryName = categoryNames[occurrence.optString("categoryId")] ?: "分类信息不可用",
                            accountName = accountNames[occurrence.optString("accountId")] ?: "账户信息不可用",
                            busy = busyId == occurrence.optString("id"),
                            actionsEnabled = busyId == null && !loading && !needsReconcile,
                            canConfirm = masterDataLoaded && categoryNames.containsKey(occurrence.optString("categoryId")) && accountNames.containsKey(occurrence.optString("accountId")),
                            reduceMotion = motion.reduced,
                            onConfirm = { choice = PendingChoice(occurrence, PendingAction.Confirm); actionError = null },
                            onIgnore = { choice = PendingChoice(occurrence, PendingAction.Ignore); actionError = null },
                        )
                    }
                }
            }
        }
    }

    choice?.let { selected ->
        val item = selected.item
        val id = item.optString("id")
        val isBusy = busyId == id
        val confirming = selected.action == PendingAction.Confirm
        AlertDialog(
            onDismissRequest = { if (!isBusy && !reconciling) choice = null },
            title = { Text(if (confirming) "确认记入账本？" else "忽略这一项？") },
            text = {
                Column(
                    modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        if (confirming) {
                            "确认后会创建一笔${if (item.optInt("type") == 1) "收入" else "支出"}账单，并影响账本及相关预算。请核对金额、日期、分类和账户。"
                        } else {
                            "忽略后不会创建账单。该周期项目会从待确认列表移除。"
                        },
                    )
                    PendingSummary(
                        name = item.optString("note").ifBlank { "周期账单" },
                        amount = formatYuan(item.optLong("amountCents")),
                        plannedDate = dateInput(item.optLong("plannedDate")),
                        category = categoryNames[item.optString("categoryId")] ?: "分类信息不可用",
                        account = accountNames[item.optString("accountId")] ?: "账户信息不可用",
                    )
                    actionError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    if (isBusy) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (!motion.reduced) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Text(if (confirming) "正在等待服务器确认…" else "正在等待服务器处理…")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !isBusy && !reconciling && !needsReconcile,
                    onClick = { scope.launch { perform(selected) } },
                ) { Text(if (confirming) "确认入账" else "确认忽略") }
            },
            dismissButton = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (actionError != null) {
                        TextButton(
                            enabled = !isBusy && !reconciling,
                            onClick = { scope.launch { reconcile(id) } },
                        ) { Text(if (reconciling) "核对中…" else "刷新核对") }
                    }
                    TextButton(enabled = !isBusy && !reconciling, onClick = { choice = null }) { Text("取消") }
                }
            },
        )
    }
}

@Composable
private fun PendingCard(
    modifier: Modifier,
    item: JSONObject,
    categoryName: String,
    accountName: String,
    busy: Boolean,
    actionsEnabled: Boolean,
    canConfirm: Boolean,
    reduceMotion: Boolean,
    onConfirm: () -> Unit,
    onIgnore: () -> Unit,
) {
    val name = item.optString("note").ifBlank { "周期账单" }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "${if (item.optInt("type") == 1) "收入" else "支出"} · ${dateInput(item.optLong("plannedDate"))}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    formatYuan(item.optLong("amountCents")),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = if (item.optInt("type") == 1) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.tertiaryContainer) {
                    Text("待确认", modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium)
                }
                Text(
                    "分类：$categoryName · 账户：$accountName",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!canConfirm) {
                Text(
                    "分类或账户信息不可用，暂不能确认入账。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = onConfirm, enabled = actionsEnabled && canConfirm, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                    if (busy && !reduceMotion) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(if (busy) "处理中…" else "确认入账")
                }
                OutlinedButton(onClick = onIgnore, enabled = actionsEnabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                    Text("忽略")
                }
            }
        }
    }
}

@Composable
private fun PendingSummary(
    name: String,
    amount: String,
    plannedDate: String,
    category: String,
    account: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text("金额：$amount", style = MaterialTheme.typography.bodyMedium)
            Text("计划日期：$plannedDate", style = MaterialTheme.typography.bodyMedium)
            Text("分类：$category", style = MaterialTheme.typography.bodyMedium)
            Text("账户：$account", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun PendingStatePanel(
    title: String,
    body: String,
    loading: Boolean = false,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val motion = LocalMotionTokens.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (loading && !motion.reduced) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            if (actionLabel != null && onAction != null) OutlinedButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}

@Composable
private fun PendingInlineNotice(
    message: String,
    isError: Boolean,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
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

private fun org.json.JSONArray?.toNameMap(): Map<String, String> {
    val array = this ?: return emptyMap()
    return buildMap {
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optString("id")
            if (id.isNotEmpty()) put(id, item.optString("name", "未命名"))
        }
    }
}
