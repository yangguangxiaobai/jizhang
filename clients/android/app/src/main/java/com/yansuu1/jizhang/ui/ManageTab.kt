package com.yansuu1.jizhang.ui

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
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AdminRepository
import com.yansuu1.jizhang.repo.MetaRepository
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 分类与账户 (A7). Mirrors web `ManageView.vue` (categories/accounts/tags tabs):
 * builtin = 内建 (renamable, not deletable); delete confirm shows usage count.
 * Balances shown beside accounts are server figures; `—` while unloaded, never ¥0.00.
 */
@Composable
fun ManageTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val admin = remember(api) { AdminRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var tab by remember { mutableStateOf("categories") }
    var categories by remember { mutableStateOf(listOf<JSONObject>()) }
    var accounts by remember { mutableStateOf(listOf<JSONObject>()) }
    var balances by remember { mutableStateOf(mapOf<String, Long>()) }
    var tags by remember { mutableStateOf(listOf<JSONObject>()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var catDraft by remember { mutableStateOf<JSONObject?>(null) }
    var catName by remember { mutableStateOf("") }
    var accDraft by remember { mutableStateOf<JSONObject?>(null) }
    var accName by remember { mutableStateOf("") }
    var deleteConfirm by remember { mutableStateOf<Triple<String, String, Int>?>(null) }
    var renameTagFrom by remember { mutableStateOf<String?>(null) }
    var renameTagTo by remember { mutableStateOf("") }

    suspend fun reload() {
        loading = true
        try {
            val cats = admin.categories().optJSONArray("items")
            val cl = mutableListOf<JSONObject>()
            for (i in 0 until (cats?.length() ?: 0)) cl.add(cats!!.optJSONObject(i))
            categories = cl
            val accs = admin.accounts().optJSONArray("items")
            val al = mutableListOf<JSONObject>()
            for (i in 0 until (accs?.length() ?: 0)) al.add(accs!!.optJSONObject(i))
            accounts = al
            try {
                val b = meta.balances()
                val barr = b.optJSONArray("items")
                val bm = mutableMapOf<String, Long>()
                for (i in 0 until (barr?.length() ?: 0)) {
                    val row = barr!!.optJSONObject(i)
                    bm[row.optString("accountId")] = row.optLong("balanceCents")
                }
                balances = bm
            } catch (_: Exception) {
            }
            val tg = meta.tags().optJSONArray("items")
            val tl = mutableListOf<JSONObject>()
            for (i in 0 until (tg?.length() ?: 0)) tl.add(tg!!.optJSONObject(i))
            tags = tl
            error = null
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        reload()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("分类与账户", style = MaterialTheme.typography.titleLarge)
        Row {
            for ((k, label) in listOf("categories" to "分类", "accounts" to "账户", "tags" to "标签")) {
                OutlinedButton(onClick = { tab = k }) {
                    Text(if (tab == k) "● $label" else label)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
            return@Column
        }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { scope.launch { reload() } }) { Text("重试") }
            return@Column
        }
        when (tab) {
            "categories" -> {
                val exp = categories.filter { it.optInt("type") == 0 }
                val inc = categories.filter { it.optInt("type") == 1 }
                LazyColumn(Modifier.weight(1f)) {
                    item {
                        Text("支出", style = MaterialTheme.typography.titleSmall)
                    }
                    items(exp, key = { it.optString("id") }) { c ->
                        ManageRow(
                            title = c.optString("name") + if (c.optBoolean("isBuiltin")) "（内建）" else "",
                            onRename = {
                                catDraft = c
                                catName = c.optString("name")
                            },
                            onDelete = if (c.optBoolean("isBuiltin")) null else ({
                                scope.launch {
                                    try {
                                        val u = admin.categoryUsage(c.optString("id"))
                                        deleteConfirm = Triple(
                                            "category",
                                            c.optString("id"),
                                            u.optInt("transactions", 0),
                                        )
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }),
                        )
                    }
                    item {
                        Text("收入", style = MaterialTheme.typography.titleSmall)
                    }
                    items(inc, key = { it.optString("id") }) { c ->
                        ManageRow(
                            title = c.optString("name") + if (c.optBoolean("isBuiltin")) "（内建）" else "",
                            onRename = {
                                catDraft = c
                                catName = c.optString("name")
                            },
                            onDelete = if (c.optBoolean("isBuiltin")) null else ({
                                scope.launch {
                                    try {
                                        val u = admin.categoryUsage(c.optString("id"))
                                        deleteConfirm = Triple(
                                            "category",
                                            c.optString("id"),
                                            u.optInt("transactions", 0),
                                        )
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }),
                        )
                    }
                }
            }
            "accounts" -> {
                LazyColumn(Modifier.weight(1f)) {
                    items(accounts, key = { it.optString("id") }) { a ->
                        val bal = balances[a.optString("id")]
                        ManageRow(
                            title = a.optString("name") +
                                if (a.optBoolean("isBuiltin")) "（内建）" else "" +
                                " · " + if (bal == null) "—" else formatYuan(bal),
                            onRename = {
                                accDraft = a
                                accName = a.optString("name")
                            },
                            onDelete = if (a.optBoolean("isBuiltin")) null else ({
                                scope.launch {
                                    try {
                                        val u = admin.accountUsage(a.optString("id"))
                                        deleteConfirm = Triple(
                                            "account",
                                            a.optString("id"),
                                            u.optInt("transactions", 0),
                                        )
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }),
                        )
                    }
                }
                OutlinedButton(onClick = {
                    accDraft = JSONObject()
                    accName = ""
                }) { Text("新建账户") }
            }
            "tags" -> {
                LazyColumn(Modifier.weight(1f)) {
                    items(tags, key = { it.optString("name") }) { t ->
                        ManageRow(
                            title = "${t.optString("name")}（${t.optInt("count")}）",
                            onRename = {
                                renameTagFrom = t.optString("name")
                                renameTagTo = t.optString("name")
                            },
                            onDelete = ({
                                scope.launch {
                                    try {
                                        admin.removeTag(t.optString("name"))
                                        reload()
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }),
                        )
                    }
                }
            }
        }
    }

    if (catDraft != null) {
        AlertDialog(
            onDismissRequest = { catDraft = null },
            title = { Text(if (catDraft!!.has("id")) "重命名分类" else "新建分类") },
            text = {
                OutlinedTextField(
                    value = catName,
                    onValueChange = { catName = it },
                    label = { Text("名称") },
                    singleLine = true,
                )
            },
            confirmButton = {
                Button(onClick = {
                    val d = catDraft!!
                    catDraft = null
                    scope.launch {
                        try {
                            if (d.has("id")) admin.updateCategory(d.optString("id"), mapOf("name" to catName))
                            else admin.createCategory(mapOf("name" to catName, "type" to 0))
                            reload()
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("保存") }
            },
            dismissButton = {
                OutlinedButton(onClick = { catDraft = null }) { Text("取消") }
            },
        )
    }
    if (accDraft != null) {
        AlertDialog(
            onDismissRequest = { accDraft = null },
            title = { Text(if (accDraft!!.has("id")) "重命名账户" else "新建账户") },
            text = {
                OutlinedTextField(
                    value = accName,
                    onValueChange = { accName = it },
                    label = { Text("名称") },
                    singleLine = true,
                )
            },
            confirmButton = {
                Button(onClick = {
                    val d = accDraft!!
                    accDraft = null
                    scope.launch {
                        try {
                            if (d.has("id")) admin.updateAccount(d.optString("id"), mapOf("name" to accName))
                            else admin.createAccount(accName, 0)
                            reload()
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("保存") }
            },
            dismissButton = {
                OutlinedButton(onClick = { accDraft = null }) { Text("取消") }
            },
        )
    }
    if (renameTagFrom != null) {
        AlertDialog(
            onDismissRequest = { renameTagFrom = null },
            title = { Text("重命名标签") },
            text = {
                OutlinedTextField(
                    value = renameTagTo,
                    onValueChange = { renameTagTo = it },
                    label = { Text("新名称") },
                    singleLine = true,
                )
            },
            confirmButton = {
                Button(onClick = {
                    val from = renameTagFrom!!
                    renameTagFrom = null
                    scope.launch {
                        try {
                            admin.renameTag(from, renameTagTo)
                            reload()
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("保存") }
            },
            dismissButton = {
                OutlinedButton(onClick = { renameTagFrom = null }) { Text("取消") }
            },
        )
    }
    if (deleteConfirm != null) {
        val (kind, id, count) = deleteConfirm!!
        AlertDialog(
            onDismissRequest = { deleteConfirm = null },
            title = { Text("确认删除？") },
            text = { Text("有 $count 笔账单引用它，删除后历史账单仍显示原名。") },
            confirmButton = {
                Button(onClick = {
                    deleteConfirm = null
                    scope.launch {
                        try {
                            if (kind == "category") admin.removeCategory(id)
                            else admin.removeAccount(id)
                            reload()
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("删除") }
            },
            dismissButton = {
                OutlinedButton(onClick = { deleteConfirm = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun ManageRow(
    title: String,
    onRename: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(title, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = onRename) { Text("改名") }
        if (onDelete != null) {
            OutlinedButton(onClick = onDelete) { Text("删除") }
        }
    }
}

/**
 * 分配模板 (A7). Ratios must sum to 100% (server validates); default template
 * used for salary auto-allocation.
 */
@Composable
fun TemplatesTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { com.yansuu1.jizhang.repo.BudgetRepository(api) }
    var templates by remember { mutableStateOf(listOf<JSONObject>()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        loading = true
        try {
            val res = repo.templates()
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            templates = list
            error = null
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        reload()
    }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text("分配模板", style = MaterialTheme.typography.titleLarge)
        Text(
            "比例和必须为 100%，默认模板用于工资自动分配",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        } else {
            for (t in templates) {
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        Text(
                            t.optString("name") + if (t.optBoolean("isDefault")) "（默认）" else "",
                            modifier = Modifier.weight(1f),
                        )
                        if (!t.optBoolean("isDefault")) {
                            OutlinedButton(onClick = {
                                scope.launch {
                                    try {
                                        repo.setDefaultTemplate(t.optString("id"))
                                        reload()
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }) { Text("设为默认") }
                        }
                    }
                    val mods = t.optJSONArray("modules")
                    for (i in 0 until (mods?.length() ?: 0)) {
                        val m = mods!!.optJSONObject(i)
                        Text(
                            "· ${m.optString("categoryName")} ${m.optDouble("ratio")}%",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Row {
                        OutlinedButton(onClick = {
                            scope.launch {
                                try {
                                    repo.applyTemplateToCurrent(t.optString("id"))
                                } catch (e: Exception) {
                                    error = e.message
                                }
                            }
                        }) { Text("应用到当前周期") }
                        OutlinedButton(onClick = {
                            scope.launch {
                                try {
                                    repo.removeTemplate(t.optString("id"))
                                    reload()
                                } catch (e: Exception) {
                                    error = e.message
                                }
                            }
                        }) { Text("删除") }
                    }
                }
            }
        }
    }
}
