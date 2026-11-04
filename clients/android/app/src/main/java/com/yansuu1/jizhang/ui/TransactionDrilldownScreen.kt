package com.yansuu1.jizhang.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.LedgerRepository
import com.yansuu1.jizhang.repo.StatsRepository
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

/**
 * Same-range expense bills for one exact category. The scoped server summary owns
 * money and count; [loadTransactionDrilldown] validates the full list without summing
 * row amounts. Failed completeness is an error, never partial success. A changed
 * source amount is a warning, not a claim of an exact matching financial snapshot.
 *
 * The source statistics stays mounted under its host Dialog. Single-bill detail
 * reuses read-only [TransactionDetailScreen]; this screen owns no write path.
 */
@Composable
fun TransactionDrilldownScreen(
    api: ApiClient,
    query: TransactionDrilldownQuery,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
) {
    val ledger = remember(api) { LedgerRepository(api) }
    val stats = remember(api) { StatsRepository(api) }
    val tokens = LocalWebTokens.current

    var retry by remember(api, query) { mutableIntStateOf(0) }
    // Isolate a new API/query/attempt immediately, before cancelling the old effect.
    val owner = remember(api, query, retry) { StatsReadOwner() }
    DisposableEffect(owner) { onDispose { owner.dispose() } }
    var loading by remember(owner) { mutableStateOf(true) }
    var outcome by remember(owner) { mutableStateOf<DrilldownOutcome?>(null) }
    var detailTransactionId by remember(api, query) { mutableStateOf<String?>(null) }

    BackHandler {
        if (detailTransactionId != null) detailTransactionId = null else onBack()
    }

    LaunchedEffect(owner, retry) {
        val ticket = owner.start()
        loading = true
        outcome = null
        try {
            val result = loadTransactionDrilldown(
                query = query,
                resolveScope = { FinancialPrefs.resolveAuthenticatedScope(api) },
                fetchSummary = { requested ->
                    stats.categoryShare(requested.from, requested.to, requested.accountId, requested.categoryId)
                },
                fetchTransactions = ledger::listTransactions,
            )
            if (owner.owns(ticket)) outcome = DrilldownOutcome.Complete(result)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (owner.owns(ticket)) onAuthExpired()
        } catch (e: Exception) {
            if (owner.owns(ticket)) outcome = DrilldownOutcome.Failed(
                if (e is ApiException && e.status == 404) {
                    "当前服务不支持完整分类明细统计，请升级服务端。未使用本地金额或不完整列表代替。"
                } else e.message ?: "明细加载失败，请重试。",
            )
        } finally {
            if (owner.owns(ticket)) loading = false
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = tokens.bg) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回统计")
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("分类账单", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        query.categoryName.ifBlank { "未分类" },
                        style = MaterialTheme.typography.titleSmall,
                        color = tokens.fg,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Text(
                query.rangeLabel,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp, bottom = 4.dp),
            )

            when {
                loading -> {
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            CircularProgressIndicator()
                            Text("正在加载该分类的全部账单…", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                outcome is DrilldownOutcome.Failed -> {
                    val failed = outcome as DrilldownOutcome.Failed
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text("明细暂时不可用，未显示不完整结果", style = MaterialTheme.typography.titleMedium)
                            Text(
                                failed.message,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall,
                            )
                            OutlinedButton(onClick = { retry += 1 }) { Text("重试") }
                            OutlinedButton(onClick = onBack) { Text("返回统计") }
                        }
                    }
                }
                outcome is DrilldownOutcome.Complete -> {
                    val complete = (outcome as DrilldownOutcome.Complete).result
                    Text(
                        "服务端合计 ¥${formatYuan(complete.totalCents)} · 共 ${complete.expenseCount} 笔支出",
                        style = MaterialTheme.typography.titleMedium,
                        color = tokens.fg,
                        modifier = Modifier.padding(vertical = 6.dp),
                    )
                    if (complete.statisticsChanged) {
                        Text(
                            "数据已变化：当前服务端合计 ¥${formatYuan(complete.totalCents)}，" +
                                "进入时分类统计为 ¥${formatYuan(query.expectedTotalCents)}。" +
                                "请返回统计页刷新后核对；不将本次明细视为原统计的精确快照。",
                            style = MaterialTheme.typography.bodySmall,
                            color = tokens.danger,
                        )
                    } else {
                        Text(
                            "金额来自同条件服务端统计；全部明细已通过笔数与筛选条件校验。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    if (complete.items.isEmpty()) {
                        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text("该分类在此范围没有支出账单", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "当前同条件服务端统计为 0 笔支出；不是读取失败或截断列表。",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(complete.items, key = { it.optString("id") }) { item ->
                                DrilldownBillRow(
                                    item = item,
                                    categoryName = query.categoryName,
                                    onOpen = { detailTransactionId = item.optString("id") },
                                )
                            }
                            item(key = "drilldown-footnote") {
                                Text(
                                    "已完整加载全部 ${complete.expenseCount} 笔；点开单笔查看只读详情。",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(vertical = 8.dp),
                                )
                            }
                        }
                    }
                }
                else -> {
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }

    // Read-only reuse of the existing detail card; it must not edit from the drilldown.
    detailTransactionId?.let { transactionId ->
        TransactionDetailScreen(
            api = api,
            transactionId = transactionId,
            onAuthExpired = onAuthExpired,
            onBack = { detailTransactionId = null },
            onEdit = {},
            readOnly = true,
        )
    }
}

private sealed class DrilldownOutcome {
    data class Complete(val result: TransactionDrilldownResult) : DrilldownOutcome()
    data class Failed(val message: String) : DrilldownOutcome()
}

@Composable
private fun DrilldownBillRow(
    item: JSONObject,
    categoryName: String,
    onOpen: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    val note = item.optString("note").trim()
    val title = note.ifEmpty { categoryName.ifEmpty { "未分类" } }
    val subtitle = formatDay(item.optLong("date")) +
        if (note.isNotEmpty() && categoryName.isNotEmpty()) " · $categoryName" else ""

    FinanceCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 16.dp,
        contentPadding = 12.dp,
        onClick = onOpen,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FinanceCategoryIcon(
                categoryName = categoryName.ifBlank { "未" },
                backgroundColor = tokens.surfaceSoft,
                tint = tokens.accent,
                size = 36.dp,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = tokens.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = "−${formatYuan(item.optLong("amountCents"))}",
                color = tokens.danger,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
            )
        }
    }
}
