package com.yansuu1.jizhang.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AssistantRepository
import com.yansuu1.jizhang.repo.AuthRepository
import com.yansuu1.jizhang.repo.BudgetRepository
import com.yansuu1.jizhang.repo.ItemRepository
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.ThemePreference
import com.yansuu1.jizhang.ui.theme.webTokens
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
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
    var summaryError by remember { mutableStateOf<String?>(null) }
    var offset by remember { mutableStateOf(0) }
    var total by remember { mutableStateOf(0) }

    suspend fun reload() {
        loading = true
        try {
            val q = mutableMapOf("limit" to "50", "offset" to offset.toString())
            if (status != "all") q["status"] = status
            if (query.isNotBlank()) q["q"] = query
            val res = repo.list(q)
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            items = list
            total = res.getInt("total")
            try {
                summary = repo.summary()
                summaryError = null
            } catch (e: AuthExpiredException) {
                throw e
            } catch (e: Exception) {
                summary = null
                summaryError = "物品汇总加载失败：${e.message ?: "请重试"}"
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

    LaunchedEffect(status, offset) {
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

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("物品资产", style = MaterialTheme.typography.headlineSmall)
        Text(
            "记录每件物品的陪伴时间与真实使用成本。物品不影响账户余额与收支统计。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = { creating = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Text("添加物品")
        }
        Spacer(Modifier.height(4.dp))
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for ((v, l) in ITEM_STATUS_LABEL.entries) {
                FilterChip(
                    selected = status == v,
                    onClick = { status = v; offset = 0 },
                    label = { Text(l) },
                    modifier = Modifier.heightIn(min = 48.dp),
                )
            }
        }
        if (summaryError != null) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("物品汇总暂时不可用", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
                Text(summaryError!!, style = MaterialTheme.typography.bodySmall)
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("搜索") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(
                onClick = { if (offset == 0) scope.launch { reload() } else offset = 0 },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("搜索") }
        }
        if (summary != null) {
            val s = summary!!
            JzCard(Modifier.fillMaxWidth()) {
                Text("物品概览", style = MaterialTheme.typography.titleSmall)
                Text(
                    "在册购入总额 " + formatYuan(s.optLong("cumulativePurchaseCents")),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text("当前日均使用成本", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(formatYuan(s.optLong("currentDailyCostCents")) + " / 天", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "物品资产独立于账单，不计入账户余额或收支统计。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        if (loading) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("正在加载物品…", style = MaterialTheme.typography.titleSmall)
                Text("第 51 件可通过下一页到达。", style = MaterialTheme.typography.bodySmall)
            }
        } else if (error != null) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("物品暂时不可用", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
                Text(error!!, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { scope.launch { reload() } },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("重试") }
            }
        } else {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                OutlinedButton(
                    enabled = offset > 0,
                    onClick = { offset = maxOf(0, offset - 50) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("上一页") }
                Text("${offset / 50 + 1} 页 · 共 $total 件", modifier = Modifier.weight(1f))
                OutlinedButton(
                    enabled = offset + items.size < total,
                    onClick = { offset += 50 },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("下一页") }
            }
            if (items.isEmpty()) {
                JzCard(Modifier.fillMaxWidth()) {
                    Text(
                        if (query.isBlank()) "还没有物品" else "没有符合条件的物品",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        if (query.isBlank()) "添加一件开始记录持有天数与日均成本。"
                        else "调整搜索条件或状态筛选后重试。",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            } else {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(items, key = { it.optString("id") }) { item ->
                        JzCard(
                            Modifier.fillMaxWidth().clickable(role = Role.Button) { detail = item },
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(item.optString("name"), style = MaterialTheme.typography.titleSmall)
                                Text(
                                    listOfNotNull(
                                        ITEM_STATUS_LABEL[item.optString("status")],
                                        item.optString("category").takeIf { value -> value.isNotBlank() },
                                        heldLabel(item.optInt("heldDays")),
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    if (item.isNull("purchasePriceCents")) "购入价未记录"
                                    else "购入 " + formatYuan(item.optLong("purchasePriceCents")),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(dailyLabel(item), style = MaterialTheme.typography.bodySmall)
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

/** Bound decoded memory even when a compact JPEG has very large dimensions. */
private fun decodeItemPhoto(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

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
    var purchaseDate by remember { mutableStateOf(dateInput(initial?.optLong("purchaseDate") ?: System.currentTimeMillis())) }
    var itemStatus by remember { mutableStateOf(initial?.optString("status") ?: "active") }
    var purchaseLink by remember { mutableStateOf(if (initial?.isNull("purchaseTransactionId") != false) "" else initial.optString("purchaseTransactionId")) }
    var priceText by remember {
        mutableStateOf(
            if (initial == null || initial.isNull("purchasePriceCents")) "" else formatYuan(initial.optLong("purchasePriceCents")),
        )
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()).imePadding(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(if (isNew) "添加物品" else "编辑物品", style = MaterialTheme.typography.headlineSmall)
        JzCard(Modifier.fillMaxWidth()) {
            Text("物品信息", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("名称*") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(value = category, onValueChange = { category = it }, label = { Text("分类（物品标签）") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(value = brand, onValueChange = { brand = it }, label = { Text("品牌") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("型号") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        }
        JzCard(Modifier.fillMaxWidth()) {
            Text("购入记录", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(value = purchaseDate, onValueChange = { purchaseDate = it }, label = { Text("购入日期（YYYY-MM-DD）") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = priceText, onValueChange = { priceText = it }, label = { Text("购入价（元，可空）") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Text("关联账单（可选）", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            LedgerLinkPicker(api, 0, purchaseLink.takeIf { it.isNotBlank() }?.let { setOf(it) } ?: emptySet(), { purchaseLink = it.firstOrNull().orEmpty() })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (s in listOf("active", "idle")) {
                    FilterChip(
                        selected = itemStatus == s,
                        onClick = { itemStatus = s },
                        label = { Text(ITEM_STATUS_LABEL[s].orEmpty()) },
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
        }
        JzCard(Modifier.fillMaxWidth()) {
            Text("补充说明", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("备注") }, modifier = Modifier.fillMaxWidth())
        }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(8.dp))
        Button(
            enabled = !saving,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
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
                            "purchaseDate" to parseDateInput(purchaseDate),
                            "status" to itemStatus,
                            "purchaseTransactionId" to purchaseLink.ifBlank { null },
                        )
                        body["category"] = category
                        body["brand"] = brand
                        body["model"] = model
                        body["note"] = note
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
        OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("取消") }
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
    var image by remember { mutableStateOf<Bitmap?>(null) }
    var previews by remember { mutableStateOf(mapOf<String, Bitmap>()) }
    var photoBytes by remember { mutableStateOf<ByteArray?>(null) }
    var busy by remember { mutableStateOf(false) }
    var closeAction by remember { mutableStateOf<String?>(null) }
    var salePrice by remember { mutableStateOf("") }
    var closeDate by remember { mutableStateOf(dateInput()) }
    var saleLink by remember { mutableStateOf("") }
    var confirmRemovePhoto by remember { mutableStateOf(false) }

    suspend fun reload() {
        try {
            item = repo.get(itemId)
            baseUrl = api.getBaseUrl().orEmpty()
            if (item?.isNull("photoUrl") == false) {
                photoBytes = withContext(Dispatchers.IO) { api.download("/api/v1/items/$itemId/photo") }
                image = withContext(Dispatchers.IO) { decodeItemPhoto(photoBytes!!) }
            } else { image = null; photoBytes = null }
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        }
    }

    LaunchedEffect(itemId) {
        reload()
    }

    LaunchedEffect(jobId) {
        val id = jobId ?: return@LaunchedEffect
        try {
            while (true) {
                val job = repo.getCutoutJob(id)
                cutoutState = job.optString("message").ifBlank { job.optString("state") }
                val arr = job.optJSONArray("candidates")
                candidates = List(arr?.length() ?: 0) { arr!!.getJSONObject(it) }
                if (job.optString("state") == "ready") {
                    val loaded = mutableMapOf<String, Bitmap>()
                    for (candidate in candidates) {
                        val candidateId = candidate.getString("id")
                        val bytes = withContext(Dispatchers.IO) { api.download("/api/v1/items/cutouts/$id/candidates/$candidateId/preview") }
                        decodeItemPhoto(bytes)?.let { loaded[candidateId] = it }
                    }
                    previews = loaded
                    break
                }
                if (job.optString("state") in listOf("failed", "cancelled")) break
                delay(1500)
            }
        } catch (e: AuthExpiredException) { onAuthExpired() }
        catch (e: Exception) { error = e.message }
    }

    val photoPicker = rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val bytes = readDocument(context, uri).bytes
                val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                val ok = repo.uploadPhoto(baseUrl, itemId, mime, bytes)
                if (!ok) error = "照片上传失败"
                reload()
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
            Text(error ?: "加载中…")
            if (error != null) OutlinedButton(onClick = { scope.launch { reload() } }) { Text("重试") }
            return@Column
        }
        Text(it.optString("name"), style = MaterialTheme.typography.titleLarge)
        Surface(
            modifier = Modifier.fillMaxWidth().height(220.dp),
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            androidx.compose.foundation.layout.Box(
                Modifier.fillMaxSize().padding(8.dp),
                contentAlignment = androidx.compose.ui.Alignment.Center,
            ) {
                val bitmap = image
                if (bitmap != null) {
                    Image(
                        bitmap.asImageBitmap(),
                        contentDescription = it.optString("name") + "的物品照片",
                        modifier = Modifier.fillMaxSize(),
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                    )
                } else {
                    Text(
                        if (photoBytes != null) "照片已保存，但无法预览" else "尚未上传物品照片",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Text("${ITEM_STATUS_LABEL[it.optString("status")]} · ${dailyLabel(it)}")
        Text("持有 ${it.optInt("heldDays")} 天", style = MaterialTheme.typography.bodySmall)
        Text(
            "照片失败会保留原图；取消轮询会停止等待，抠图候选需逐个预览确认。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = { photoPicker.launch("image/*") },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Text("上传照片")
        }
        OutlinedButton(
            onClick = { confirmRemovePhoto = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            enabled = !busy && photoBytes != null,
        ) { Text("删除照片") }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = {
                scope.launch {
                    try {
                        val source = photoBytes ?: throw IllegalArgumentException("请先上传照片")
                        busy = true
                        val webp = withContext(Dispatchers.IO) {
                            val bitmap = decodeItemPhoto(source)
                                ?: throw IllegalArgumentException("照片无法解码")
                            java.io.ByteArrayOutputStream().use { out ->
                                @Suppress("DEPRECATION")
                                bitmap.compress(Bitmap.CompressFormat.WEBP, 90, out)
                                bitmap.recycle()
                                out.toByteArray()
                            }
                        }
                        val job = repo.createCutoutJob(webp)
                        candidates = emptyList(); previews = emptyMap()
                        jobId = job.getString("jobId")
                        cutoutState = job.optString("state")
                    } catch (e: Exception) {
                        error = e.message
                    } finally { busy = false }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy && photoBytes != null && jobId == null,
        ) { Text("生成抠图候选") }
        if (cutoutState != null) {
            Text(cutoutState!!, style = MaterialTheme.typography.bodySmall)
        }
        for (c in candidates) {
            val candidateId = c.getString("id")
            previews[candidateId]?.let { bitmap -> Image(bitmap.asImageBitmap(), contentDescription = "抠图候选", modifier = Modifier.fillMaxWidth().height(180.dp)) }
            OutlinedButton(enabled = !busy, onClick = { scope.launch {
                busy = true
                try {
                    val bytes = repo.cutoutCandidateBytes(jobId!!, candidateId)
                    val saved = repo.uploadPhoto(baseUrl, itemId, "image/png", bytes)
                    require(saved) { "候选照片保存失败，原照片仍保留" }
                    reload()
                    val activeJob = jobId
                    if (activeJob != null) {
                        repo.cancelCutoutJob(activeJob)
                        jobId = null
                    }
                    candidates = emptyList()
                    previews = emptyMap()
                    cutoutState = "候选照片已保存"
                } catch (e: Exception) { error = e.message } finally { busy = false }
            } }) { Text("使用此候选") }
        }
        if (jobId != null) OutlinedButton(onClick = { scope.launch {
            try { repo.cancelCutoutJob(jobId!!); jobId = null; candidates = emptyList(); previews = emptyMap(); cutoutState = "已取消" }
            catch (e: Exception) { error = e.message }
        } }) { Text("取消抠图") }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onEdit, modifier = Modifier.fillMaxWidth()) { Text("编辑") }
        OutlinedButton(
            onClick = { closeAction = "retire" },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("结束持有") }
        OutlinedButton(onClick = { closeAction = "sell" }, modifier = Modifier.fillMaxWidth()) { Text("售出物品") }
        OutlinedButton(
            onClick = { closeAction = "delete" },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("删除物品") }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        @Suppress("UNUSED_EXPRESSION")
        jobId.let { }
    }
    closeAction?.let { action -> AlertDialog(
        onDismissRequest = { closeAction = null },
        title = { Text(when(action) { "sell" -> "售出物品"; "retire" -> "结束持有"; else -> "确认删除物品？" }) },
            text = { Column(Modifier.height(360.dp).verticalScroll(rememberScrollState())) {
            if (action != "delete") OutlinedTextField(value = closeDate, onValueChange = { closeDate = it }, label = { Text("结束日期（YYYY-MM-DD）") })
            if (action == "sell") {
                OutlinedTextField(value = salePrice, onValueChange = { salePrice = it }, label = { Text("卖出价（元）") })
                LedgerLinkPicker(api, 1, saleLink.takeIf { it.isNotBlank() }?.let { setOf(it) } ?: emptySet(), { saleLink = it.firstOrNull().orEmpty() })
            }
        } },
        confirmButton = { Button(onClick = { scope.launch {
            try {
                when(action) {
                    "sell" -> {
                        val cents = salePrice.toBigDecimalOrNull()?.movePointRight(2)?.longValueExact()
                        require(cents != null && cents >= 0) { "卖出价格须为非负金额" }
                        repo.sell(itemId, mapOf("closedDate" to parseDateInput(closeDate), "salePriceCents" to cents, "saleTransactionId" to saleLink.ifBlank { null }))
                    }
                    "retire" -> repo.retire(itemId, parseDateInput(closeDate))
                    else -> repo.remove(itemId)
                }
                closeAction = null; onClose()
            } catch (e: Exception) { error = e.message; closeAction = null }
        } }) { Text("确认") } },
        dismissButton = { OutlinedButton(onClick = { closeAction = null }) { Text("取消") } },
    ) }
    if (confirmRemovePhoto) {
        AlertDialog(
            onDismissRequest = { if (!busy) confirmRemovePhoto = false },
            title = { Text("删除物品照片？") },
            text = { Text("物品资料会保留，当前照片将从服务器移除。") },
            confirmButton = {
                Button(
                    enabled = !busy,
                    onClick = {
                        scope.launch {
                            busy = true
                            try {
                                repo.removePhoto(itemId)
                                confirmRemovePhoto = false
                                reload()
                            } catch (e: AuthExpiredException) {
                                onAuthExpired()
                            } catch (e: Exception) {
                                error = e.message
                            } finally {
                                busy = false
                            }
                        }
                    },
                ) { Text(if (busy) "正在删除…" else "删除照片") }
            },
            dismissButton = {
                OutlinedButton(
                    onClick = { confirmRemovePhoto = false },
                    enabled = !busy,
                ) { Text("取消") }
            },
        )
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
    val dark = when (theme) {
        ThemePreference.System -> isSystemInDarkTheme()
        ThemePreference.Light -> false
        ThemePreference.Dark -> true
    }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("显示模式", style = MaterialTheme.typography.labelLarge)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (t in ThemePreference.entries) {
                FilterChip(
                    selected = t == theme,
                    onClick = { onTheme(t) },
                    modifier = Modifier.weight(1f),
                    label = { Text(t.label, maxLines = 1) },
                )
            }
        }
        Text("配色预览", style = MaterialTheme.typography.labelLarge)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (a in AccentPreset.entries) {
                val preview = webTokens(a, dark)
                Card(
                    modifier = Modifier.weight(1f).selectable(
                        selected = a == accent,
                        role = Role.RadioButton,
                        onClick = { onAccent(a) },
                    ),
                    shape = MaterialTheme.shapes.small,
                    colors = CardDefaults.cardColors(containerColor = preview.surface),
                    border = BorderStroke(1.dp, if (a == accent) preview.accent else preview.border),
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(a.label, style = MaterialTheme.typography.labelMedium, color = preview.fg, maxLines = 1)
                        Surface(color = preview.hero, shape = MaterialTheme.shapes.small) {
                            Text(
                                "¥1,280.00",
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = preview.onHero,
                                maxLines = 1,
                            )
                        }
                        Text("本月示例", style = MaterialTheme.typography.labelSmall, color = preview.muted, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsSectionCard(
    title: String,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}

/**
 * Settings are grouped by task and keep account secrets as transient Compose
 * state only. Cycle changes are drafts until the server confirms the write.
 */
@Composable
fun SettingsFull(
    api: ApiClient,
    auth: AuthRepository?,
    theme: ThemePreference,
    accent: AccentPreset,
    onTheme: (ThemePreference) -> Unit,
    onAccent: (AccentPreset) -> Unit,
    reduceMotion: Boolean,
    onReduceMotion: (Boolean) -> Unit,
    onLoggedOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val budget = remember(api) { BudgetRepository(api) }
    val assistant = remember(api) { AssistantRepository(api) }

    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordBusy by remember { mutableStateOf(false) }
    var passwordError by remember { mutableStateOf<String?>(null) }

    var cycleLoadAttempt by remember { mutableStateOf(0) }
    var cycleLoading by remember { mutableStateOf(true) }
    var cycleLoaded by remember { mutableStateOf(false) }
    var cycleSaving by remember { mutableStateOf(false) }
    var cycleError by remember { mutableStateOf<String?>(null) }
    var cycleSaved by remember { mutableStateOf(false) }
    var currentCycleDay by remember { mutableStateOf<Int?>(null) }
    var selectedCycleDay by remember { mutableStateOf<Int?>(null) }
    var cycleMin by remember { mutableStateOf(1) }
    var cycleMax by remember { mutableStateOf(28) }

    var providerLoadAttempt by remember { mutableStateOf(0) }
    var providerLoading by remember { mutableStateOf(true) }
    var providerConfigured by remember { mutableStateOf<Boolean?>(null) }
    var providerEnabled by remember { mutableStateOf(false) }
    var providerError by remember { mutableStateOf<String?>(null) }
    var logoutBusy by remember { mutableStateOf(false) }
    var logoutError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(api, cycleLoadAttempt) {
        cycleLoading = true
        cycleLoaded = false
        cycleError = null
        cycleSaved = false
        try {
            val settings = budget.getSettings()
            require(settings.has("cycleStartDay")) { "服务端未返回当前周期起算日" }
            val min = settings.getInt("minCycleStartDay")
            val max = settings.getInt("maxCycleStartDay")
            require(min in 1..28 && max in min..28) { "服务端返回的起算日范围无效" }
            val configuredDay = if (settings.isNull("cycleStartDay")) null else settings.getInt("cycleStartDay")
            require(configuredDay == null || configuredDay in min..max) { "当前起算日超出服务端规则" }
            cycleMin = min
            cycleMax = max
            currentCycleDay = configuredDay
            selectedCycleDay = configuredDay
            cycleLoaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            cycleError = "预算周期设置读取失败：${e.message?.takeIf { it.isNotBlank() } ?: "请检查网络后重试"}"
        } finally {
            cycleLoading = false
        }
    }

    LaunchedEffect(api, providerLoadAttempt) {
        providerLoading = true
        providerConfigured = null
        providerError = null
        try {
            val config = assistant.providerConfig()
            // Keep only non-secret status flags; never retain the provider object or secret.
            providerConfigured = config.optBoolean("configured")
            providerEnabled = config.optBoolean("enabled")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            providerError = "AI 配置状态读取失败：${e.message?.takeIf { it.isNotBlank() } ?: "请重试"}"
        } finally {
            providerLoading = false
        }
    }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("设置与账户安全", style = MaterialTheme.typography.headlineSmall)

        SettingsSectionCard(
            title = "外观与动态效果",
            subtitle = "主题即时生效；减少动态会将过渡直接显示为最终状态。关闭此项时跟随系统动画设置。",
        ) {
            AppearanceSection(theme = theme, accent = accent, onTheme = onTheme, onAccent = onAccent)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("减少动态效果", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        if (reduceMotion) "已启用，页面和图表不播放过渡动画。"
                        else "跟随系统设置；系统关闭动画时也会直接显示最终状态。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = reduceMotion, onCheckedChange = onReduceMotion)
            }
        }

        SettingsSectionCard(
            title = "桌面图标",
            subtitle = "六款图标顺序与供图一致。选择后桌面入口会切换；部分桌面可能延迟刷新，重启应用不会丢失选择。",
        ) {
            LauncherIconPicker()
        }

        SettingsSectionCard(
            title = "预算周期",
            subtitle = "选择自然月，或指定每月起算日。起算日按服务端允许范围生效。",
        ) {
            when {
                cycleLoading -> Text("正在读取当前预算周期设置…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                cycleError != null -> {
                    Text(cycleError!!, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = { cycleLoadAttempt += 1 }) { Text("重试读取") }
                }
                cycleLoaded -> {
                    Text(
                        "当前设置：${cycleLabel(currentCycleDay)}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text("周期类型", style = MaterialTheme.typography.labelLarge)
                    FilterChip(
                        selected = selectedCycleDay == null,
                        onClick = {
                            selectedCycleDay = null
                            cycleSaved = false
                            cycleError = null
                        },
                        enabled = !cycleSaving,
                        label = { Text("自然月") },
                    )
                    Text("指定起算日", style = MaterialTheme.typography.labelLarge)
                    for (firstDay in 1..28 step 4) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            for (day in firstDay..minOf(firstDay + 3, 28)) {
                                FilterChip(
                                    selected = selectedCycleDay == day,
                                    onClick = {
                                        selectedCycleDay = day
                                        cycleSaved = false
                                        cycleError = null
                                    },
                                    enabled = day in cycleMin..cycleMax && !cycleSaving,
                                    modifier = Modifier.weight(1f),
                                    label = { Text("$day 日", maxLines = 1) },
                                )
                            }
                        }
                    }
                    Text(
                        "服务端允许每月 $cycleMin–$cycleMax 日。自然月与 1 日是不同设置。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(
                        onClick = {
                            scope.launch {
                                if (cycleSaving) return@launch
                                cycleSaving = true
                                cycleError = null
                                cycleSaved = false
                                try {
                                    val requestedCycleDay = selectedCycleDay
                                    require(requestedCycleDay == null || requestedCycleDay in cycleMin..cycleMax) {
                                        "请选择服务端允许范围内的起算日"
                                    }
                                    val result = budget.setCycleStartDay(requestedCycleDay)
                                    require(result.has("cycleStartDay")) { "服务端未确认新的周期设置" }
                                    val confirmed = if (result.isNull("cycleStartDay")) null else result.getInt("cycleStartDay")
                                    require(confirmed == null || confirmed in cycleMin..cycleMax) {
                                        "服务端返回的起算日超出允许范围"
                                    }
                                    currentCycleDay = confirmed
                                    selectedCycleDay = confirmed
                                    cycleSaved = true
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: Exception) {
                                    cycleError = "预算周期保存失败：${e.message?.takeIf { it.isNotBlank() } ?: "请重试"}"
                                } finally {
                                    cycleSaving = false
                                }
                            }
                        },
                        enabled = !cycleSaving && selectedCycleDay != currentCycleDay,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (cycleSaving) "保存中…" else "保存周期设置")
                    }
                    if (cycleSaved) {
                        Text("周期设置已由服务端确认。", color = MaterialTheme.colorScheme.primary)
                    }
                    if (cycleError != null) {
                        Text(cycleError!!, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }

        SettingsSectionCard(
            title = "修改密码",
            subtitle = "修改成功后当前会话将退出，请使用新密码重新登录。密码只在本次操作期间保存在屏幕内存中。",
        ) {
            OutlinedTextField(
                value = currentPassword,
                onValueChange = { currentPassword = it; passwordError = null },
                label = { Text("当前密码") },
                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = newPassword,
                onValueChange = { newPassword = it; passwordError = null },
                label = { Text("新密码") },
                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it; passwordError = null },
                label = { Text("确认新密码") },
                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = !passwordBusy,
                onClick = {
                    scope.launch {
                        if (passwordBusy) return@launch
                        val authRepository = auth
                        if (authRepository == null) {
                            passwordError = "当前登录状态不可用，请重新登录后再试。"
                            return@launch
                        }
                        passwordError = when {
                            currentPassword.isBlank() -> "请输入当前密码。"
                            newPassword.isEmpty() -> "请输入新密码。"
                            newPassword != confirmPassword -> "两次输入的新密码不一致。"
                            else -> null
                        }
                        if (passwordError != null) return@launch

                        passwordBusy = true
                        try {
                            val result = authRepository.changePassword(currentPassword, newPassword)
                            if (result.isSuccess) {
                                currentPassword = ""
                                newPassword = ""
                                confirmPassword = ""
                                authRepository.logout()
                                onLoggedOut()
                            } else {
                                passwordError = "修改密码失败：${result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "请核对当前密码后重试"}"
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            passwordError = "修改密码失败：${e.message?.takeIf { it.isNotBlank() } ?: "请重试"}"
                        } finally {
                            passwordBusy = false
                        }
                    }
                },
            ) {
                Text(if (passwordBusy) "正在修改…" else "修改并重新登录")
            }
            if (passwordError != null) {
                Text(passwordError!!, color = MaterialTheme.colorScheme.error)
            }
        }

        SettingsSectionCard(
            title = "AI 接口状态",
            subtitle = "密钥仅由服务端保存；此处只显示配置状态。",
        ) {
            when {
                providerLoading -> Text("正在读取 AI 配置状态…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                providerError != null -> {
                    Text(providerError!!, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = { providerLoadAttempt += 1 }) { Text("重试读取") }
                }
                providerConfigured == true -> Text(if (providerEnabled) "AI Provider 已配置并启用" else "AI Provider 已配置，当前停用")
                else -> Text("尚未配置 AI Provider", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        SettingsSectionCard(title = "账户") {
            if (logoutError != null) Text(logoutError!!, color = MaterialTheme.colorScheme.error)
            OutlinedButton(
                modifier = Modifier.fillMaxWidth(),
                enabled = !logoutBusy,
                onClick = {
                    scope.launch {
                        if (logoutBusy) return@launch
                        logoutBusy = true
                        logoutError = null
                        try {
                            auth?.logout()
                            onLoggedOut()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            logoutError = "退出登录失败：${e.message?.takeIf { it.isNotBlank() } ?: "请重试"}"
                        } finally {
                            logoutBusy = false
                        }
                    }
                },
            ) {
                Text(if (logoutBusy) "正在退出…" else "退出登录")
            }
        }
    }
}

private fun cycleLabel(day: Int?): String = day?.let { "每月 $it 日起算" } ?: "自然月"
