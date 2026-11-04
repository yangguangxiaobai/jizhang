package com.yansuu1.jizhang.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.text.font.FontFamily
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AdminRepository
import com.yansuu1.jizhang.repo.LedgerRepository
import com.yansuu1.jizhang.repo.MetaRepository
import java.io.IOException
import java.util.Calendar
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Monthly transaction list. Query parameters and their meanings remain aligned
 * with LedgerRepository; money and budget values are displayed as returned.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TransactionsTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onNew: () -> Unit,
    onOpen: (String) -> Unit,
    onEdit: (String) -> Unit,
    refreshToken: Long = 0L,
) {
    val scope = rememberCoroutineScope()
    val ledger = remember(api) { LedgerRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    val admin = remember(api) { AdminRepository(api) }

    val loadCoordinator = remember { TransactionLoadCoordinator() }
    val metadataCoordinator = remember { TransactionMetadataCoordinator() }
    var viewState by remember { mutableStateOf(loadCoordinator.state) }
    var metadataState by remember { mutableStateOf(metadataCoordinator.state) }
    var loadJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    var metadataJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    var dailySummaries by remember { mutableStateOf<Map<String, TransactionDaySummary>>(emptyMap()) }
    var dailySummaryError by remember { mutableStateOf<String?>(null) }

    var confirmDelete by remember { mutableStateOf<JSONObject?>(null) }
    var searchText by remember { mutableStateOf("") }
    var showFilters by remember { mutableStateOf(false) }
    var draftAccountFilter by remember { mutableStateOf<String?>(null) }
    var draftCategoryFilter by remember { mutableStateOf("") }
    var draftTagFilter by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }

    val activeFilterCount = listOfNotNull(
        viewState.currentQuery.accountId,
        viewState.currentQuery.categoryId.takeIf { it.isNotEmpty() },
        viewState.currentQuery.tag.takeIf { it.isNotEmpty() },
    ).size

    suspend fun executeLoad(initialQuery: TransactionQuery, initialGen: Long) {
        var currentTarget = initialQuery
        var currentGen = initialGen
        while (true) {
            val stepGen = currentGen
            val stepQuery = currentTarget
            coroutineContext.ensureActive()
            try {
                val (from, to) = monthRange(stepQuery.monthOffset)
                val result = loadTransactionMonth(stepQuery, from, to, ledger::listTransactions)
                if (!stepQuery.requiresSearchSummary) {
                    when (val outcome = loadCoordinator.onLoadSuccess(stepGen, stepQuery, result.items, result.total)) {
                        is TransactionLoadCoordinator.LoadResultOutcome.PageCorrectionRequired -> {
                            currentTarget = stepQuery.copy(page = outcome.correctedPage)
                            currentGen = loadCoordinator.startLoad(currentTarget)
                            viewState = loadCoordinator.state
                            continue
                        }
                        is TransactionLoadCoordinator.LoadResultOutcome.Applied -> {
                            viewState = loadCoordinator.state
                            dailySummaries = emptyMap()
                            dailySummaryError = null
                        }
                        TransactionLoadCoordinator.LoadResultOutcome.RejectedStale -> return
                    }
                }
                if (stepQuery.isAllHistorySearch) return
                var summaryError: String? = null
                val summaries = try {
                    val decoded = decodeTransactionDaySummaries(
                        ledger.dailyTransactionSummary(
                            stepQuery.toServerParams(from, to) +
                                ("timeZone" to transactionSummaryTimeZone()),
                        ),
                        searching = stepQuery.search.isNotBlank(),
                        expectedSearchRevision = result.searchRevision,
                    )
                    validateTransactionDaySummaryCounts(result.items, decoded)
                    decoded
                } catch (e: CancellationException) {
                    throw e
                } catch (e: AuthExpiredException) {
                    throw e
                } catch (e: TransactionSearchRevisionChangedException) {
                    if (loadCoordinator.invalidateLoaded(stepGen, stepQuery, e.message.orEmpty())) {
                        viewState = loadCoordinator.state
                        dailySummaries = emptyMap()
                        dailySummaryError = null
                    }
                    return
                } catch (e: ApiException) {
                    if (stepQuery.requiresSearchSummary && e.status == 400) {
                        if (loadCoordinator.invalidateLoaded(stepGen, stepQuery, e.message ?: "搜索条件无效，请调整后重试")) {
                            viewState = loadCoordinator.state
                            dailySummaries = emptyMap()
                            dailySummaryError = null
                        }
                        return
                    }
                    summaryError = e.message ?: "每日收支暂不可用"
                    emptyMap()
                } catch (e: Exception) {
                    if (stepQuery.requiresSearchSummary && e !is IOException) {
                        if (loadCoordinator.invalidateLoaded(stepGen, stepQuery, e.message ?: "每日汇总校验失败，请刷新重试")) {
                            viewState = loadCoordinator.state
                            dailySummaries = emptyMap()
                            dailySummaryError = null
                        }
                        return
                    }
                    summaryError = e.message ?: "每日收支暂不可用"
                    emptyMap()
                }
                coroutineContext.ensureActive()
                if (stepQuery.requiresSearchSummary) {
                    when (val outcome = loadCoordinator.onLoadSuccess(stepGen, stepQuery, result.items, result.total)) {
                        is TransactionLoadCoordinator.LoadResultOutcome.PageCorrectionRequired -> {
                            currentTarget = stepQuery.copy(page = outcome.correctedPage)
                            currentGen = loadCoordinator.startLoad(currentTarget)
                            viewState = loadCoordinator.state
                            continue
                        }
                        is TransactionLoadCoordinator.LoadResultOutcome.Applied -> viewState = loadCoordinator.state
                        TransactionLoadCoordinator.LoadResultOutcome.RejectedStale -> return
                    }
                }
                if (stepGen == loadCoordinator.currentGeneration() && stepQuery == viewState.currentQuery) {
                    dailySummaries = summaries
                    dailySummaryError = summaryError
                }
                return
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (stepGen == loadCoordinator.currentGeneration()) {
                    onAuthExpired()
                }
                return
            } catch (e: TransactionSearchRevisionChangedException) {
                if (loadCoordinator.invalidateLoaded(stepGen, stepQuery, e.message.orEmpty())) {
                    viewState = loadCoordinator.state
                    dailySummaries = emptyMap()
                    dailySummaryError = null
                }
                return
            } catch (e: Exception) {
                val errorMsg = e.message ?: "加载失败"
                if (loadCoordinator.onLoadError(stepGen, stepQuery, errorMsg)) {
                    viewState = loadCoordinator.state
                }
                return
            } finally {
                if (loadCoordinator.onLoadFinally(stepGen, stepQuery)) {
                    viewState = loadCoordinator.state
                }
            }
        }
    }

    fun dispatchQuery(newQuery: TransactionQuery) {
        // The visible list always represents the complete month, never one API page.
        val query = newQuery.copy(page = 0)
        val sameScope = query == viewState.loadedQuery && !query.requiresSearchSummary
        val gen = loadCoordinator.startLoad(query)
        viewState = loadCoordinator.state
        if (!sameScope) {
            dailySummaries = emptyMap()
            dailySummaryError = null
        }
        loadJob?.cancel()
        loadJob = scope.launch {
            executeLoad(query, gen)
        }
    }

    fun dispatchMetadata() {
        val accGen = metadataCoordinator.startAccountsLoad()
        val otherGen = metadataCoordinator.startOtherMetadataLoad()
        metadataState = metadataCoordinator.state
        metadataJob?.cancel()
        metadataJob = scope.launch {
            launch {
                coroutineContext.ensureActive()
                try {
                    val accs = admin.accounts(includeDeleted = true).optJSONArray("items")
                    coroutineContext.ensureActive()
                    val an = mutableMapOf<String, String>()
                    for (i in 0 until (accs?.length() ?: 0)) {
                        val a = accs?.optJSONObject(i) ?: continue
                        an[a.optString("id")] = a.optString("name")
                    }
                    if (metadataCoordinator.onAccountsSuccess(accGen, an)) {
                        metadataState = metadataCoordinator.state
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: AuthExpiredException) {
                    if (accGen == metadataCoordinator.currentAccountsGeneration()) {
                        onAuthExpired()
                    }
                } catch (e: Exception) {
                    val errorMsg = e.message ?: "账户加载失败"
                    if (metadataCoordinator.onAccountsError(accGen, errorMsg)) {
                        metadataState = metadataCoordinator.state
                    }
                }
            }
            launch {
                coroutineContext.ensureActive()
                try {
                    val cats = admin.categories(includeDeleted = true).optJSONArray("items")
                    val tagRows = meta.tags().optJSONArray("items")
                    coroutineContext.ensureActive()
                    val cn = mutableMapOf<String, String>()
                    val ci = mutableMapOf<String, String>()
                    val cc = mutableMapOf<String, Long>()
                    for (i in 0 until (cats?.length() ?: 0)) {
                        val c = cats?.optJSONObject(i) ?: continue
                        val id = c.optString("id")
                        cn[id] = c.optString("name")
                        ci[id] = c.optString("icon", "other")
                        cc[id] = c.optLong("color", 0L)
                    }
                    val tg = (0 until (tagRows?.length() ?: 0))
                        .mapNotNull { tagRows?.optJSONObject(it)?.optString("name") }

                    if (metadataCoordinator.onOtherMetadataSuccess(otherGen, cn, ci, cc, tg)) {
                        metadataState = metadataCoordinator.state
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: AuthExpiredException) {
                    if (otherGen == metadataCoordinator.currentOtherGeneration()) {
                        onAuthExpired()
                    }
                } catch (e: Exception) {
                    val errorMsg = e.message ?: "分类标签加载失败"
                    if (metadataCoordinator.onOtherMetadataError(otherGen, errorMsg)) {
                        metadataState = metadataCoordinator.state
                    }
                }
            }
        }
    }

    LaunchedEffect(api) { dispatchMetadata() }
    LaunchedEffect(api, refreshToken) {
        // Edits/refunds invalidate the loaded data, not the user's complete query.
        dispatchQuery(viewState.currentQuery)
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        // Keep month navigation beside the title; recording stays in the central tab action.
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "账单",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = LocalWebTokens.current.fg,
            )
            Row(
                modifier = Modifier.weight(1f).padding(start = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Start,
            ) {
                IconButton(
                    onClick = { dispatchQuery(TransactionQueryHelper.changeMonth(viewState.currentQuery, -1)) },
                    modifier = Modifier.size(44.dp),
                ) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "上个月") }
                Text(
                    monthLabel(viewState.currentQuery.monthOffset),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                IconButton(
                    onClick = { dispatchQuery(TransactionQueryHelper.changeMonth(viewState.currentQuery, 1)) },
                    modifier = Modifier.size(44.dp),
                ) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "下个月") }
            }
            IconButton(onClick = { dispatchQuery(viewState.currentQuery) }, enabled = !viewState.loading) {
                Icon(Icons.Filled.Refresh, contentDescription = "刷新账单")
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = searchText,
                onValueChange = { searchText = it },
                modifier = Modifier.weight(1f),
                label = { Text("搜索名称或金额") },
                singleLine = true,
            )
            Button(onClick = {
                val keyword = searchText.trim()
                searchText = keyword
                val wasSearching = viewState.currentQuery.search.isNotBlank()
                dispatchQuery(viewState.currentQuery.copy(
                    search = keyword,
                    searchAllHistory = if (keyword.isEmpty() || !wasSearching) true else viewState.currentQuery.searchAllHistory,
                    page = 0,
                ))
            }) { Text("搜索") }
        }
        if (viewState.currentQuery.search.isNotBlank()) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("搜索范围", style = MaterialTheme.typography.bodySmall)
                FilterChip(
                    selected = viewState.currentQuery.searchAllHistory,
                    onClick = { dispatchQuery(viewState.currentQuery.copy(searchAllHistory = true, page = 0)) },
                    label = { Text("全部历史") },
                )
                FilterChip(
                    selected = !viewState.currentQuery.searchAllHistory,
                    onClick = { dispatchQuery(viewState.currentQuery.copy(searchAllHistory = false, page = 0)) },
                    label = { Text("所选月份") },
                )
            }
            if (viewState.currentQuery.isAllHistorySearch) {
                Text("全部历史不受月份切换影响；切换月份范围可查看所选月。", style = MaterialTheme.typography.bodySmall)
            }
        }

        Spacer(Modifier.height(8.dp))
        val accountChoices = remember(metadataState.accountNames, viewState.currentQuery.accountId) {
            TransactionQueryHelper.buildAccountChoices(
                accountNames = metadataState.accountNames,
                selectedAccountId = viewState.currentQuery.accountId,
            )
        }
        ListChoice(
            label = "",
            choices = accountChoices,
            selected = viewState.currentQuery.accountId ?: "",
            onSelect = { selectedId ->
                val newQuery = TransactionQueryHelper.selectAccount(viewState.currentQuery, selectedId)
                if (newQuery != null) {
                    dispatchQuery(newQuery)
                }
            },
        )
        if (metadataState.accountsLoading) {
            Text(
                "正在加载账户…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        if (metadataState.accountsError != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "账户列表加载失败：${metadataState.accountsError}",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { dispatchMetadata() }) {
                    Text("重试")
                }
            }
        }
        if (metadataState.metadataError != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "分类标签加载失败：${metadataState.metadataError}",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { dispatchMetadata() }) {
                    Text("重试")
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilterChip(
                    selected = viewState.currentQuery.typeFilter == null,
                    onClick = { TransactionQueryHelper.selectType(viewState.currentQuery, null)?.let(::dispatchQuery) },
                    label = { Text("全部") },
                )
                FilterChip(
                    selected = viewState.currentQuery.typeFilter == 0,
                    onClick = { TransactionQueryHelper.selectType(viewState.currentQuery, 0)?.let(::dispatchQuery) },
                    label = { Text("支出") },
                )
                FilterChip(
                    selected = viewState.currentQuery.typeFilter == 1,
                    onClick = { TransactionQueryHelper.selectType(viewState.currentQuery, 1)?.let(::dispatchQuery) },
                    label = { Text("收入") },
                )
            }
            if (activeFilterCount > 0) {
                Spacer(Modifier.size(6.dp))
                Text("已选$activeFilterCount", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
        }

        if (viewState.currentQuery.accountId != null) {
            Text(
                "${TransactionQueryHelper.accountDisplayLabel(viewState.currentQuery.accountId, metadataState.accountNames)} · ${if (viewState.currentQuery.isAllHistorySearch) "全部历史" else monthLabel(viewState.currentQuery.monthOffset)}的账单",
                modifier = Modifier.padding(top = 2.dp, bottom = 2.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (activeFilterCount > 0 || viewState.currentQuery.search.isNotBlank()) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                viewState.currentQuery.accountId?.let { id ->
                    FilterChip(
                        selected = true,
                        onClick = { TransactionQueryHelper.selectAccount(viewState.currentQuery, null)?.let(::dispatchQuery) },
                        label = { Text("${TransactionQueryHelper.accountDisplayLabel(id, metadataState.accountNames)} ×") },
                    )
                }
                if (viewState.currentQuery.categoryId.isNotEmpty()) {
                    val catLabel = metadataState.categoryNames[viewState.currentQuery.categoryId] ?: "分类信息暂不可用"
                    FilterChip(
                        selected = true,
                        onClick = { dispatchQuery(viewState.currentQuery.copy(categoryId = "", page = 0)) },
                        label = { Text("分类：$catLabel ×") },
                    )
                }
                if (viewState.currentQuery.tag.isNotEmpty()) {
                    FilterChip(
                        selected = true,
                        onClick = { dispatchQuery(viewState.currentQuery.copy(tag = "", page = 0)) },
                        label = { Text("标签：${viewState.currentQuery.tag} ×") },
                    )
                }
                if (viewState.currentQuery.search.isNotBlank()) {
                    FilterChip(
                        selected = true,
                        onClick = {
                            searchText = ""
                            dispatchQuery(viewState.currentQuery.copy(search = "", searchAllHistory = true, page = 0))
                        },
                        label = { Text("搜索：${viewState.currentQuery.search} ×") },
                    )
                }
                TextButton(onClick = {
                    searchText = ""
                    dispatchQuery(TransactionQueryHelper.clearFilters(viewState.currentQuery))
                }) { Text("清除") }
            }
        }

        val totalText = if (viewState.total != null) "共 ${viewState.total} 笔" else if (viewState.loading) "加载中…" else "条数暂不可用"
        Text(
            totalText,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 8.dp),
        )
        if (dailySummaryError != null) {
            Text(
                "每日收支暂不可用：${dailySummaryError}。请点击右上角刷新重试。",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 4.dp),
            )
        }

        when {
            viewState.loading && viewState.items.isEmpty() -> {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator()
                        Text("正在加载账单", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            viewState.items.isEmpty() && viewState.error != null -> {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("账单暂时无法加载", style = MaterialTheme.typography.titleMedium)
                        Text(viewState.error.orEmpty(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = { dispatchQuery(viewState.currentQuery) }) { Text("重试") }
                    }
                }
            }
            else -> {
                if (viewState.loading) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    if (viewState.items.isNotEmpty()) {
                        Text(
                            "正在更新，当前显示上次结果",
                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                if (viewState.error != null) {
                    Text(
                        "更新失败，当前显示上次结果：${viewState.error}",
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (viewState.items.isEmpty()) {
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (activeFilterCount > 0 || viewState.currentQuery.search.isNotBlank()) "没有符合条件的账单" else "本月还没有账单", style = MaterialTheme.typography.titleMedium)
                            Text(
                                if (activeFilterCount > 0 || viewState.currentQuery.search.isNotBlank()) "试试调整月份或清除筛选条件" else "记录一笔后，这里会显示账单详情",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                            if (activeFilterCount > 0 || viewState.currentQuery.search.isNotBlank()) {
                                OutlinedButton(onClick = {
                                    searchText = ""
                                    dispatchQuery(TransactionQueryHelper.clearFilters(viewState.currentQuery))
                                }) { Text("清除筛选") }
                            } else {
                                OutlinedButton(onClick = onNew) { Text("开始记账") }
                            }
                        }
                    }
                } else {
                    // Daily totals are authoritative server figures, never sums of a partial page.
                    val grouped = viewState.items.groupBy { transactionDayKey(it.optLong("date")) }
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        grouped.forEach { (dayLabel, dayItems) ->
                            item(key = "header-$dayLabel-${dayItems.firstOrNull()?.optString("id")}") {
                                FlowRow(
                                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(
                                        if (viewState.currentQuery.isAllHistorySearch) dayLabel else formatDay(dayItems.first().optLong("date")),
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    val summary = dailySummaries[dayLabel]
                                    if (!viewState.currentQuery.isAllHistorySearch) FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Text(
                                            "支出 ${summary?.let { "¥${formatYuan(it.expenseCents)}" } ?: "—"}",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = LocalWebTokens.current.danger,
                                        )
                                        Text(
                                            "收入 ${summary?.let { "¥${formatYuan(it.incomeCents)}" } ?: "—"}",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = LocalWebTokens.current.ok,
                                        )
                                    }
                                }
                            }
                            items(dayItems, key = { it.optString("id") }) { tx ->
                                TransactionCard(
                                    tx = tx,
                                    categoryNames = metadataState.categoryNames,
                                    categoryIcons = metadataState.categoryIcons,
                                    categoryColors = metadataState.categoryColors,
                                    accountNames = metadataState.accountNames,
                                    onOpen = { onOpen(tx.optString("id")) },
                                    onEdit = { onEdit(tx.optString("id")) },
                                    onDelete = { confirmDelete = tx },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showFilters) {
        ModalBottomSheet(
            onDismissRequest = { showFilters = false },
            sheetState = sheetState,
        ) {
            val accountChoices = TransactionQueryHelper.buildAccountChoices(
                accountNames = metadataState.accountNames,
                selectedAccountId = draftAccountFilter,
            )
            val categoryChoices = buildList {
                add("" to "全部")
                if (draftCategoryFilter.isNotEmpty() && metadataState.categoryNames[draftCategoryFilter] == null) {
                    add(draftCategoryFilter to "分类信息暂不可用（保留当前条件）")
                }
                addAll(metadataState.categoryNames.entries.sortedBy { it.value }.map { it.key to it.value })
            }
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("筛选账单", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text("选择条件后点“应用”，列表才会更新。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("账户", style = MaterialTheme.typography.titleSmall)
                ListChoice("账户", accountChoices, draftAccountFilter ?: "") { draftAccountFilter = it.ifEmpty { null } }
                Text("分类", style = MaterialTheme.typography.titleSmall)
                ListChoice("分类", categoryChoices, draftCategoryFilter) { draftCategoryFilter = it }
                Text("标签", style = MaterialTheme.typography.titleSmall)
                ListChoice("标签", listOf("" to "全部") + metadataState.tags.sorted().map { it to it }, draftTagFilter) { draftTagFilter = it }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = {
                        draftAccountFilter = null
                        draftCategoryFilter = ""
                        draftTagFilter = ""
                    }) { Text("重置") }
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(onClick = { showFilters = false }) { Text("取消") }
                    Button(onClick = {
                        showFilters = false
                        val newQuery = viewState.currentQuery.copy(
                            accountId = draftAccountFilter,
                            categoryId = draftCategoryFilter,
                            tag = draftTagFilter,
                            page = 0,
                        )
                        dispatchQuery(newQuery)
                    }) { Text("应用") }
                }
            }
        }
    }

    if (confirmDelete != null) {
        val label = confirmDelete!!.optString("note").ifEmpty { "这笔账单" }
        AlertDialog(
            onDismissRequest = { if (!deleting) confirmDelete = null },
            title = { Text("删除$label？") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("删除后可在回收站恢复")
                    deleteError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                Button(enabled = !deleting, onClick = {
                    val id = confirmDelete!!.optString("id")
                    deleteError = null
                    scope.launch {
                        deleting = true
                        try {
                            ledger.removeTransaction(id)
                            confirmDelete = null
                            dispatchQuery(viewState.currentQuery)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: AuthExpiredException) {
                            onAuthExpired()
                        } catch (e: Exception) {
                            deleteError = e.message ?: "删除失败，请重试。"
                        } finally {
                            deleting = false
                        }
                    }
                }) { Text(if (deleting) "删除中…" else "删除") }
            },
            dismissButton = {
                OutlinedButton(enabled = !deleting, onClick = { confirmDelete = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun TransactionCard(
    tx: JSONObject,
    categoryNames: Map<String, String>,
    categoryIcons: Map<String, String>,
    categoryColors: Map<String, Long>,
    accountNames: Map<String, String>,
    onOpen: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuExpanded by remember(tx.optString("id")) { mutableStateOf(false) }
    val type = tx.optInt("type")
    val refund = tx.optBoolean("isRefund")
    val isIncome = type == 1 || refund
    val sign = if (isIncome) "+" else "−"
    val catId = tx.optString("categoryId")
    val category = categoryNames[catId].orEmpty()
    val note = tx.optString("note").trim()
    val title = note.ifEmpty { category.ifEmpty { "未分类" } }
    val subtitle = listOf(
        if (note.isNotEmpty() && category.isNotEmpty()) category else null,
        accountNames[tx.optString("accountId")].orEmpty().ifEmpty { null },
        formatDay(tx.optLong("date")),
    ).filterNotNull().filter { it.isNotEmpty() }.joinToString(" · ")

    val iconName = categoryIcons[catId]
    val colorVal = categoryThemeColor(iconName, categoryColors[catId])
    val kindLabel = if (refund) "退款" else if (type == 1) "收入" else "支出"

    FinanceCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 18.dp,
        contentPadding = 12.dp,
        onClick = onOpen,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FinanceCategoryIcon(
                iconName = iconName,
                backgroundColor = colorVal,
                size = 40.dp,
                iconSize = 22.dp,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = LocalWebTokens.current.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = LocalWebTokens.current.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = "$sign${formatYuan(tx.optLong("amountCents"))}",
                color = if (isIncome) LocalWebTokens.current.ok else LocalWebTokens.current.danger,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
            )
            Box {
                IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "账单操作", tint = LocalWebTokens.current.muted)
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("编辑") },
                        leadingIcon = { Icon(Icons.Filled.Edit, contentDescription = null) },
                        onClick = { menuExpanded = false; onEdit() },
                    )
                    DropdownMenuItem(
                        text = { Text("删除") },
                        leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
                        onClick = { menuExpanded = false; onDelete() },
                    )
                }
            }
        }
        val txTags = tx.optJSONArray("tags")
        if (refund || (txTags != null && txTags.length() > 0)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp, start = 56.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (refund) {
                    Surface(
                        shape = CircleShape,
                        color = LocalWebTokens.current.ok.copy(alpha = 0.15f),
                    ) {
                        Text(
                            kindLabel,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            color = LocalWebTokens.current.ok,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
                if (txTags != null) {
                    for (i in 0 until txTags.length()) {
                        Surface(
                            shape = CircleShape,
                            color = LocalWebTokens.current.surfaceSoft,
                        ) {
                            Text(
                                "#${txTags.optString(i)}",
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = LocalWebTokens.current.muted,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun monthRange(offset: Int): Pair<Long, Long> {
    val cal = Calendar.getInstance()
    cal.set(Calendar.DAY_OF_MONTH, 1)
    cal.set(Calendar.HOUR_OF_DAY, 0)
    cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    cal.add(Calendar.MONTH, offset)
    val from = cal.timeInMillis
    cal.add(Calendar.MONTH, 1)
    return from to cal.timeInMillis
}

private fun monthLabel(offset: Int): String {
    val cal = Calendar.getInstance()
    cal.add(Calendar.MONTH, offset)
    return "${cal.get(Calendar.YEAR)}年${cal.get(Calendar.MONTH) + 1}月"
}
