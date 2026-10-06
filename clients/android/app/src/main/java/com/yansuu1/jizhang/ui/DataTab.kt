package com.yansuu1.jizhang.ui

import android.content.Context
import android.net.Uri
import android.os.Environment
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
import androidx.compose.material3.Checkbox
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
import com.yansuu1.jizhang.repo.PortabilityRepository
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Web `RESTORE_COMMAND` parity: restore needs the server stopped, CLI only. */
const val RESTORE_COMMAND =
    "docker compose stop jizhang\n" +
        "docker compose run --rm jizhang node /app/packages/server/dist/cli.js restore /data/backups/<文件名>\n" +
        "docker compose start jizhang"

/**
 * 数据导出与备份 (A8). Mirrors web `DataView.vue` four cards:
 * export / app-CSV import / platform bills / backups.
 */
@Composable
fun DataTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val repo = remember(api) { PortabilityRepository(api) }
    var backups by remember { mutableStateOf(listOf<JSONObject>()) }
    var loadingBackups by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var importResult by remember { mutableStateOf<String?>(null) }
    var importMode by remember { mutableStateOf("transactions") }
    var chosenName by remember { mutableStateOf<String?>(null) }
    var chosenText by remember { mutableStateOf<String?>(null) }
    var platformOpen by remember { mutableStateOf(false) }
    var lastPlatform by remember { mutableStateOf<String?>(null) }
    var exportMsg by remember { mutableStateOf<String?>(null) }

    suspend fun reloadBackups() {
        loadingBackups = true
        try {
            val res = repo.listBackups()
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            backups = list
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loadingBackups = false
        }
    }

    LaunchedEffect(Unit) {
        reloadBackups()
    }

    val csvPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) {
            chosenName = null
            chosenText = null
            return@rememberLauncherForActivityResult
        }
        try {
            context.contentResolver.openInputStream(uri)?.use { ins ->
                chosenText = ins.readBytes().toString(Charsets.UTF_8)
            }
            chosenName = uri.lastPathSegment ?: "import.csv"
            importResult = null
        } catch (e: Exception) {
            error = e.message
        }
    }

    if (platformOpen) {
        PlatformImportSheet(
            api = api,
            onAuthExpired = onAuthExpired,
            onFinished = { summary ->
                lastPlatform = summary
                platformOpen = false
            },
            onClose = { platformOpen = false },
        )
        return
    }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text("数据导出与备份", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))

        Text("导出", style = MaterialTheme.typography.titleSmall)
        Text("下载 CSV，可直接用 Excel 打开（中文不会乱码）。", style = MaterialTheme.typography.bodySmall)
        for ((what, label) in listOf(
            "transactions" to "导出账单",
            "salaries" to "导出工资记录",
            "recurring" to "导出周期账单规则",
            "transfers" to "导出转账",
        )) {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        try {
                            val bytes = repo.downloadExport(what)
                            val file = saveToDownloads(context, "$what.csv", bytes)
                            exportMsg = "已保存：${file.absolutePath}"
                        } catch (e: AuthExpiredException) {
                            onAuthExpired()
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(label) }
        }
        if (exportMsg != null) {
            Text(exportMsg!!, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(12.dp))

        Text("导入数据", style = MaterialTheme.typography.titleSmall)
        Row {
            OutlinedButton(onClick = {
                importMode = "transactions"
                chosenName = null
                chosenText = null
                importResult = null
            }) { Text(if (importMode == "transactions") "● 本应用账单" else "本应用账单") }
            OutlinedButton(onClick = {
                importMode = "transfers"
                chosenName = null
                chosenText = null
                importResult = null
            }) { Text(if (importMode == "transfers") "● 转账" else "转账") }
        }
        Text("只支持导入本应用导出的 CSV。相同 id 会跳过。", style = MaterialTheme.typography.bodySmall)
        OutlinedButton(
            onClick = { csvPicker.launch("text/csv") },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("选择 CSV 文件") }
        if (chosenName != null) {
            Text("已选择 $chosenName", style = MaterialTheme.typography.bodySmall)
            Button(
                enabled = !busy,
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            val res = if (importMode == "transfers") {
                                repo.importTransfersCsv(chosenText.orEmpty())
                            } else {
                                repo.importTransactionsCsv(chosenText.orEmpty())
                            }
                            importResult = "导入完成：新增 ${res.optInt("inserted")} 条，" +
                                "跳过 ${res.optInt("skipped")} 条，共读取 ${res.optInt("total")} 条。"
                        } catch (e: Exception) {
                            error = e.message
                        } finally {
                            busy = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "导入中…" else "确认导入") }
        }
        if (importResult != null) {
            Text(importResult!!, color = MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(12.dp))

        Text("微信 / 支付宝账单", style = MaterialTheme.typography.titleSmall)
        Text("上传平台导出文件（微信 .xlsx / 支付宝 GBK CSV）。", style = MaterialTheme.typography.bodySmall)
        Button(
            onClick = { platformOpen = true },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("打开导入面板") }
        if (lastPlatform != null) {
            Text(lastPlatform!!, color = MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(12.dp))

        Text("备份", style = MaterialTheme.typography.titleSmall)
        Text("备份是数据库快照，用于整库恢复；导出文件用于查看与迁移。", style = MaterialTheme.typography.bodySmall)
        Button(
            enabled = !busy,
            onClick = {
                scope.launch {
                    busy = true
                    try {
                        repo.createBackup()
                        reloadBackups()
                    } catch (e: Exception) {
                        error = e.message
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (busy) "处理中…" else "立即备份") }
        if (loadingBackups) {
            Text("加载中…", style = MaterialTheme.typography.bodySmall)
        } else if (backups.isEmpty()) {
            Text("还没有备份。点上面的按钮创建第一个。", style = MaterialTheme.typography.bodySmall)
        } else {
            for (f in backups) {
                Text(
                    "${f.optString("fileName")} · ${sizeLabel(f.optLong("sizeBytes"))} · ${whenLabel(f.optLong("createdAtMs"))}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("如何恢复备份", style = MaterialTheme.typography.titleSmall)
        Text(
            "恢复会替换数据库文件，必须在服务停止时进行，不提供页面内按钮：",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(RESTORE_COMMAND, style = MaterialTheme.typography.bodySmall)
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
    }
}

private fun saveToDownloads(context: Context, name: String, bytes: ByteArray): File {
    val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
    val file = File(dir, name)
    FileOutputStream(file).use { it.write(bytes) }
    return file
}

private fun sizeLabel(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    if (bytes < 1024 * 1024) return "${bytes / 1024} KB"
    return "%.1f MB".format(bytes / (1024.0 * 1024.0))
}

private fun whenLabel(epochMs: Long): String {
    val d = Date(epochMs)
    return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(d)
}

/**
 * 平台账单导入面板 (A8). Mirrors web `PlatformImportModal`:
 * pick file → dry-run preview → check → per-row category override → confirm.
 * Bytes go up verbatim; GBK/xlsx decode + dedupe stay server-side (PRD R5).
 */
@Composable
fun PlatformImportSheet(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onFinished: (String) -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val repo = remember(api) { PortabilityRepository(api) }
    var fileName by remember { mutableStateOf<String?>(null) }
    var fileBytes by remember { mutableStateOf<ByteArray?>(null) }
    var rows by remember { mutableStateOf(listOf<JSONObject>()) }
    var source by remember { mutableStateOf("auto") }
    var checked by remember { mutableStateOf(setOf<String>()) }
    var overrides by remember { mutableStateOf(mapOf<String, String>()) }
    var overrideRow by remember { mutableStateOf<JSONObject?>(null) }
    var overrideText by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var detected by remember { mutableStateOf<String?>(null) }

    suspend fun doPreview() {
        val bytes = fileBytes ?: return
        busy = true
        error = null
        try {
            val res = repo.importPlatformBills(bytes, source, true, fileName)
            detected = res.optString("source")
            val arr = res.optJSONArray("rows")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            rows = list
            checked = list.filter {
                !it.optBoolean("alreadyExists") && !it.optBoolean("ignored") &&
                    !it.optBoolean("possibleDuplicate")
            }.map { it.optString("id") }.toSet()
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            busy = false
        }
    }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        try {
            context.contentResolver.openInputStream(uri)?.use { ins ->
                fileBytes = ins.readBytes()
            }
            fileName = uri.lastPathSegment ?: "platform-bill"
            rows = emptyList()
            checked = emptySet()
            scope.launch { doPreview() }
        } catch (e: Exception) {
            error = e.message
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("微信 / 支付宝导入", style = MaterialTheme.typography.titleLarge)
        Row {
            OutlinedButton(onClick = { picker.launch("*/*") }) { Text("选择文件") }
            OutlinedButton(onClick = onClose) { Text("关闭") }
        }
        if (fileName != null) {
            Text("已选择 $fileName" + if (detected != null) "（识别为$detected）" else "")
        }
        if (busy) {
            Text("处理中…")
        }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        LazyColumn(Modifier.weight(1f)) {
            items(rows, key = { it.optString("id") }) { r ->
                val id = r.optString("id")
                val locked = r.optBoolean("alreadyExists") || r.optBoolean("ignored")
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Checkbox(
                        checked = id in checked,
                        enabled = !locked,
                        onCheckedChange = { on ->
                            checked = if (on) checked + id else checked - id
                        },
                    )
                    Column(Modifier.weight(1f)) {
                        Text(r.optString("note").ifEmpty { r.optString("counterparty") })
                        Text(
                            "${r.optString("dateLabel")} · ${formatYuan(r.optLong("amountCents"))} · " +
                                (overrides[id] ?: r.optString("categoryName")) +
                                if (r.optBoolean("alreadyExists")) " · 已入账" else "" +
                                if (r.optBoolean("possibleDuplicate")) " · 可能重复" else "" +
                                if (r.optBoolean("ignored")) " · ${r.optString("ignoreReason")}" else "",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    OutlinedButton(onClick = {
                        overrideRow = r
                        overrideText = overrides[id] ?: r.optString("categoryName")
                    }) { Text("改分类") }
                }
            }
        }
        if (rows.isNotEmpty()) {
            Button(
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            val res = repo.importPlatformBills(
                                fileBytes!!,
                                source,
                                false,
                                fileName,
                                checked.toList(),
                                overrides,
                            )
                            val srcLabel = if (res.optString("source") == "wechat") "微信" else "支付宝"
                            onFinished(
                                "上次导入：$srcLabel，新增 ${res.optInt("inserted")} 条，" +
                                    "支出 ${formatYuan(res.optLong("expenseCents"))} 元、" +
                                    "收入 ${formatYuan(res.optLong("incomeCents"))} 元。",
                            )
                        } catch (e: Exception) {
                            error = e.message
                        } finally {
                            busy = false
                        }
                    }
                },
            ) { Text("确认导入所选（${checked.size}）") }
        }
    }

    if (overrideRow != null) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { overrideRow = null },
            title = { Text("修改分类") },
            text = {
                OutlinedTextField(
                    value = overrideText,
                    onValueChange = { overrideText = it },
                    label = { Text("分类名") },
                    singleLine = true,
                )
            },
            confirmButton = {
                Button(onClick = {
                    val id = overrideRow!!.optString("id")
                    overrides = overrides + (id to overrideText)
                    overrideRow = null
                }) { Text("确定") }
            },
            dismissButton = {
                OutlinedButton(onClick = { overrideRow = null }) { Text("取消") }
            },
        )
    }
}
