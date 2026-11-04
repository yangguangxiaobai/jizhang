package com.yansuu1.jizhang.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AdminRepository
import com.yansuu1.jizhang.repo.LedgerRepository
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.coroutines.coroutineContext

/**
 * 账单详情卡片弹窗（居中精美浮动卡片，对齐设计图：四边留白、圆角白底、顶部标题及关闭✕、
 * 中间大图标与分类金额 Hero、紧凑属性列表、底部胶囊编辑/退款/删除按钮）。
 * readOnly is used by AI review to inspect the original bill without mutating it.
 */
@Composable
fun TransactionDetailScreen(
    api: ApiClient,
    transactionId: String,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onRefund: () -> Unit = {},
    onDeleted: () -> Unit = {},
    readOnly: Boolean = false,
) {
    Dialog(
        onDismissRequest = onBack,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 24.dp),
            contentAlignment = Alignment.Center,
        ) {
            key(transactionId) {
                TransactionDetailCard(
                    api = api,
                    transactionId = transactionId,
                    onAuthExpired = onAuthExpired,
                    onBack = onBack,
                    onEdit = onEdit,
                    onRefund = onRefund,
                    onDeleted = onDeleted,
                    readOnly = readOnly,
                )
            }
        }
    }
}

@Composable
private fun TransactionDetailCard(
    api: ApiClient,
    transactionId: String,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onRefund: () -> Unit,
    onDeleted: () -> Unit,
    readOnly: Boolean,
) {
    val scope = rememberCoroutineScope()
    val ledger = remember(api) { LedgerRepository(api) }
    val admin = remember(api) { AdminRepository(api) }

    var transaction by remember(transactionId) { mutableStateOf<JSONObject?>(null) }
    var linkedTransactions by remember(transactionId) { mutableStateOf(emptyList<JSONObject>()) }
    var categoryNames by remember(transactionId) { mutableStateOf(emptyMap<String, String>()) }
    var categoryIcons by remember(transactionId) { mutableStateOf(emptyMap<String, String>()) }
    var accountNames by remember(transactionId) { mutableStateOf(emptyMap<String, String>()) }
    var loading by remember(transactionId) { mutableStateOf(true) }
    var error by remember(transactionId) { mutableStateOf<String?>(null) }

    var confirmDelete by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }

    val owner = remember { TransactionDetailLoadOwner() }
    var loadJob by remember { mutableStateOf<Job?>(null) }

    suspend fun reload(ticket: TransactionDetailLoadOwner.Ticket) {
        try {
            val item = ledger.getTransaction(ticket.transactionId)
            coroutineContext.ensureActive()
            if (!owner.owns(ticket)) return
            transaction = item

            var nextCategoryNames = emptyMap<String, String>()
            var nextCategoryIcons = emptyMap<String, String>()
            var nextAccountNames = emptyMap<String, String>()
            try {
                val categories = admin.categories(includeDeleted = true).optJSONArray("items")
                val cNames = mutableMapOf<String, String>()
                val cIcons = mutableMapOf<String, String>()
                for (i in 0 until (categories?.length() ?: 0)) {
                    val c = categories?.optJSONObject(i) ?: continue
                    val id = c.optString("id")
                    if (id.isNotBlank()) {
                        cNames[id] = c.optString("name")
                        cIcons[id] = c.optString("icon", "other")
                    }
                }
                nextCategoryNames = cNames
                nextCategoryIcons = cIcons

                val accounts = admin.accounts(includeDeleted = true).optJSONArray("items")
                val aNames = mutableMapOf<String, String>()
                for (i in 0 until (accounts?.length() ?: 0)) {
                    val a = accounts?.optJSONObject(i) ?: continue
                    val id = a.optString("id")
                    if (id.isNotBlank()) {
                        aNames[id] = a.optString("name")
                    }
                }
                nextAccountNames = aNames
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                throw e
            } catch (_: Exception) {
                // 元数据缺失降级
            }

            val links = item.optJSONArray("refundLinkedTxIds")
            val nextLinked = buildList {
                for (index in 0 until (links?.length() ?: 0)) {
                    val linkedId = links?.optString(index).orEmpty()
                    if (linkedId.isBlank()) continue
                    try {
                        add(ledger.getTransaction(linkedId))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: AuthExpiredException) {
                        throw e
                    } catch (_: Exception) { }
                }
            }

            coroutineContext.ensureActive()
            if (!owner.owns(ticket)) return
            categoryNames = nextCategoryNames
            categoryIcons = nextCategoryIcons
            accountNames = nextAccountNames
            linkedTransactions = nextLinked
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (owner.owns(ticket)) onAuthExpired()
        } catch (e: Exception) {
            if (owner.owns(ticket)) error = e.message?.takeIf(String::isNotBlank) ?: "账单详情暂时无法加载。"
        } finally {
            if (owner.owns(ticket)) loading = false
        }
    }

    fun dispatchLoad() {
        val ticket = owner.start(transactionId)
        loading = true
        error = null
        loadJob?.cancel()
        loadJob = scope.launch { reload(ticket) }
    }

    LaunchedEffect(transactionId) { dispatchLoad() }
    DisposableEffect(Unit) { onDispose { loadJob?.cancel() } }

    val item = transaction
    val isIncome = item?.optInt("type") == 1
    val isRefund = item?.optBoolean("isRefund") == true
    val catId = item?.optString("categoryId").orEmpty()
    val categoryDisplayName = categoryNames[catId] ?: item?.optString("categoryName")?.ifBlank { "未知分类" } ?: "未知分类"
    val categoryIconSemantic = categoryIcons[catId]
    val accountDisplayName = accountNames[item?.optString("accountId")] ?: item?.optString("accountName")?.ifBlank { "默认账户" } ?: "默认账户"

    Card(
        modifier = Modifier
            .widthIn(min = 280.dp, max = 345.dp)
            .fillMaxWidth()
            .wrapContentHeight(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp, vertical = 20.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            // 顶部标题与关闭按钮 (✕)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "账单详情",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF1E2329),
                )
                IconButton(
                    onClick = onBack,
                    modifier = Modifier.size(24.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "关闭",
                        tint = Color(0xFF8E959E),
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            if (loading && item == null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 36.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(32.dp), strokeWidth = 3.dp)
                    Text("正在读取账单详情…", fontSize = 13.sp, color = Color(0xFF8E959E))
                }
            } else if (error != null && item == null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(error!!, color = MaterialTheme.colorScheme.error, fontSize = 13.5.sp)
                    OutlinedButton(onClick = { dispatchLoad() }) {
                        Text("重试")
                    }
                }
            } else if (item != null) {
                // 中间分类图、分类大字、子标题与金额 Hero
                val tileBg = if (isIncome) Color(0xFFE8F5E9) else Color(0xFFFFF0EC)
                val iconTint = if (isIncome) Color(0xFF2E7D32) else Color(0xFFE65100)
                val amountColor = if (isIncome) Color(0xFF2E7D32) else Color(0xFFDF4A38)
                val prefix = if (isIncome) "+" else "−"
                val subtitle = item.optString("note").ifBlank { if (isIncome) "收入" else "支出" }

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        modifier = Modifier
                            .size(68.dp)
                            .clip(RoundedCornerShape(22.dp))
                            .background(tileBg),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = categoryIconFor(categoryIconSemantic),
                            contentDescription = null,
                            tint = iconTint,
                            modifier = Modifier.size(34.dp),
                        )
                    }

                    Spacer(Modifier.height(10.dp))

                    Text(
                        text = categoryDisplayName,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF1E2329),
                    )

                    Spacer(Modifier.height(3.dp))

                    Text(
                        text = subtitle,
                        fontSize = 13.sp,
                        color = Color(0xFF8E959E),
                    )

                    Spacer(Modifier.height(6.dp))

                    Text(
                        text = "$prefix¥${formatYuan(item.optLong("amountCents"))}",
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        color = amountColor,
                    )
                }

                Spacer(Modifier.height(14.dp))
                HorizontalDivider(color = Color(0xFFF3EFEF), thickness = 1.dp)
                Spacer(Modifier.height(8.dp))

                // 账单关键属性列表
                DetailRowItem(label = "分类：", value = categoryDisplayName)
                DetailRowItem(label = "时间：", value = formatDetailDateTime(item.optLong("date")))
                DetailRowItem(label = "账户：", value = accountDisplayName)
                if (item.optString("note").isNotBlank()) {
                    DetailRowItem(label = "备注：", value = item.optString("note"))
                }
                val rawPurpose = item.optString("financialPurpose").takeIf { it.isNotBlank() }
                    ?: item.optString("purpose").takeIf { it.isNotBlank() }
                val purposeText = when (rawPurpose) {
                    "essentials" -> "必要开支 (生活底线)"
                    "joy" -> "随心消费 (愿望享受)"
                    else -> if (!isIncome && !isRefund) "跟随分类规则 (无覆盖)" else null
                }
                if (purposeText != null) {
                    DetailRowItem(label = "理财用途：", value = purposeText)
                }
                val statusText = when {
                    isRefund -> "已退款"
                    isIncome -> "已收入"
                    else -> "已支出"
                }
                DetailRowItem(label = "状态：", value = statusText, valueColor = amountColor)

                val tags = item.optJSONArray("tags")
                if (tags != null && tags.length() > 0) {
                    val tagText = (0 until tags.length())
                        .map { tags.optString(it) }
                        .filter { it.isNotBlank() }
                        .joinToString(" · ") { "#$it" }
                    if (tagText.isNotBlank()) {
                        DetailRowItem(label = "标签：", value = tagText)
                    }
                }

                if (isRefund && linkedTransactions.isNotEmpty()) {
                    val linkedSummary = linkedTransactions.joinToString("\n") { linked ->
                        val lCat = categoryNames[linked.optString("categoryId")] ?: "原支出"
                        val lNote = linked.optString("note").ifBlank { lCat }
                        "$lNote · ¥${formatYuan(linked.optLong("amountCents"))}"
                    }
                    DetailRowItem(label = "原支出：", value = linkedSummary)
                }

                Spacer(Modifier.height(16.dp))

                // Review callers reuse the details without exposing ledger mutations.
                if (!readOnly) {
                    // 底部胶囊操作按钮
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        // 编辑胶囊按钮
                        Surface(
                            onClick = onEdit,
                            shape = RoundedCornerShape(20.dp),
                            color = Color(0xFFF7F5F4),
                            modifier = Modifier
                                .weight(1f)
                                .height(42.dp),
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = "编辑",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Color(0xFF555B62),
                                )
                            }
                        }

                        // 记录退款按钮（仅支出可退款）
                        if (!isIncome && !isRefund) {
                            Surface(
                                onClick = onRefund,
                                shape = RoundedCornerShape(20.dp),
                                color = Color(0xFFEBF3F7),
                                modifier = Modifier
                                    .weight(1.2f)
                                    .height(42.dp),
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        text = "记录退款",
                                        fontSize = 13.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Color(0xFF2F6F8F),
                                    )
                                }
                            }
                        }

                        // 删除胶囊按钮（软粉底，红字）
                        Surface(
                            onClick = { confirmDelete = true },
                            shape = RoundedCornerShape(20.dp),
                            color = Color(0xFFFEECEC),
                            modifier = Modifier
                                .weight(1f)
                                .height(42.dp),
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = "删除",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Color(0xFFDF4A38),
                                )
                            }
                        }
                    }

                }

                if (!readOnly && deleteError != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = deleteError!!,
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 12.sp,
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    )
                }
            }
        }
    }

    if (!readOnly && confirmDelete) {
        AlertDialog(
            onDismissRequest = { if (!deleting) confirmDelete = false },
            title = { Text("确认删除这笔账单？") },
            text = { Text("删除后账单将移入回收站，可随时从“我的 → 回收站”恢复。") },
            confirmButton = {
                Button(
                    enabled = !deleting,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDF4A38)),
                    onClick = {
                        scope.launch {
                            deleting = true
                            deleteError = null
                            try {
                                ledger.removeTransaction(transactionId)
                                confirmDelete = false
                                onDeleted()
                                onBack()
                            } catch (e: Exception) {
                                deleteError = e.message ?: "删除失败，请重试"
                            } finally {
                                deleting = false
                            }
                        }
                    },
                ) {
                    Text(if (deleting) "删除中…" else "确认删除")
                }
            },
            dismissButton = {
                OutlinedButton(
                    enabled = !deleting,
                    onClick = { confirmDelete = false },
                ) {
                    Text("取消")
                }
            },
        )
    }
}

@Composable
private fun DetailRowItem(
    label: String,
    value: String,
    valueColor: Color = Color(0xFF1E2329),
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            fontSize = 13.5.sp,
            color = Color(0xFF8E959E),
            modifier = Modifier.width(66.dp),
        )
        Text(
            text = value,
            fontSize = 13.5.sp,
            fontWeight = FontWeight.Normal,
            color = valueColor,
            modifier = Modifier.weight(1f),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * 格式化详情时间，今天显示“今天 HH:mm”，昨天显示“昨天 HH:mm”，当年显示“M月d日 HH:mm”
 */
private fun formatDetailDateTime(epochMs: Long): String {
    val now = Calendar.getInstance()
    val target = Calendar.getInstance().apply { timeInMillis = epochMs }
    val sameYear = now.get(Calendar.YEAR) == target.get(Calendar.YEAR)
    val dayDiff = now.get(Calendar.DAY_OF_YEAR) - target.get(Calendar.DAY_OF_YEAR)
    val timeFormat = SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(epochMs))
    return when {
        sameYear && dayDiff == 0 -> "今天 $timeFormat"
        sameYear && dayDiff == 1 -> "昨天 $timeFormat"
        sameYear -> SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(Date(epochMs))
        else -> SimpleDateFormat("yyyy年M月d日", Locale.CHINA).format(Date(epochMs))
    }
}
