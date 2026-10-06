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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import com.yansuu1.jizhang.repo.AssistantRepository
import java.util.UUID
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * AI 助理 tab (A9). Mirrors web `AssistantView.vue`:
 * - server-backed conversations; attachment bytes stay in this view's memory only.
 * - confirmation cards: confirm writes go through the card's actionId with
 *   selectedIds/categoryOverrides; cancel discards.
 * - platform-import preview rows inside a card reuse the DataTab selection parity
 *   (already-imported uncheckable, possible duplicates unchecked by default).
 */
@Composable
fun AssistantTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val repo = remember(api) { AssistantRepository(api) }
    var conversations by remember { mutableStateOf(listOf<JSONObject>()) }
    var conversationId by remember { mutableStateOf<String?>(null) }
    var messages by remember { mutableStateOf(listOf<JSONObject>()) }
    var text by remember { mutableStateOf("") }
    var attachName by remember { mutableStateOf<String?>(null) }
    var attachBytes by remember { mutableStateOf<ByteArray?>(null) }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedRows by remember { mutableStateOf(mapOf<String, Set<String>>()) }
    var overrides by remember { mutableStateOf(mapOf<String, Map<String, String>>()) }

    suspend fun reloadConversations() {
        try {
            val res = repo.conversations()
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            conversations = list
            if (conversationId == null && list.isNotEmpty()) {
                conversationId = list[0].optString("id")
            }
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        }
    }

    suspend fun reloadMessages() {
        val id = conversationId ?: return
        try {
            val res = repo.messages(id)
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            messages = list
            // Seed platform-import selections (Web `seedSelections` parity).
            val next = selectedRows.toMutableMap()
            for (m in list) {
                val card = m.optJSONObject("content")?.optJSONObject("card") ?: continue
                if (card.optString("toolName") == "platform-import.prepare" &&
                    !next.containsKey(card.optString("actionId"))
                ) {
                    val rows = cardRows(card)
                    next[card.optString("actionId")] = rows.filter {
                        !it.optBoolean("ignored") && !it.optBoolean("alreadyExists") &&
                            it.optLong("amountCents") > 0 && !it.optBoolean("possibleDuplicate")
                    }.map { it.optString("id") }.toSet()
                }
            }
            selectedRows = next
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        }
    }

    LaunchedEffect(Unit) {
        loading = true
        reloadConversations()
        if (conversationId == null) {
            try {
                val c = repo.createConversation()
                conversationId = c.optString("id")
                reloadConversations()
            } catch (e: Exception) {
                error = e.message
            }
        }
        reloadMessages()
        loading = false
    }

    LaunchedEffect(conversationId) {
        if (conversationId != null && !loading) reloadMessages()
    }

    val attachPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        try {
            context.contentResolver.openInputStream(uri)?.use { ins ->
                val bytes = ins.readBytes()
                if (bytes.size > 5 * 1024 * 1024) {
                    error = "附件超过 5MB"
                    return@rememberLauncherForActivityResult
                }
                attachBytes = bytes
                attachName = uri.lastPathSegment ?: "attachment"
            }
        } catch (e: Exception) {
            error = e.message
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("AI 助理", style = MaterialTheme.typography.titleLarge)
        Row {
            OutlinedButton(onClick = {
                scope.launch {
                    try {
                        val c = repo.createConversation()
                        conversationId = c.optString("id")
                        messages = emptyList()
                        reloadConversations()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            }) { Text("新对话") }
            for (c in conversations.take(5)) {
                OutlinedButton(onClick = {
                    conversationId = c.optString("id")
                    scope.launch { reloadMessages() }
                }) {
                    Text(if (c.optString("id") == conversationId) "● 当前" else c.optString("title").ifEmpty { "对话" })
                }
            }
        }
        if (loading) {
            Text("加载中…")
            return@Column
        }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        LazyColumn(Modifier.weight(1f)) {
            items(messages, key = { it.optString("id") }) { m ->
                MessageCard(
                    message = m,
                    selectedRows = selectedRows,
                    overrides = overrides,
                    onToggleRow = { actionId, rowId, on ->
                        val cur = selectedRows[actionId].orEmpty()
                        selectedRows = selectedRows + (actionId to if (on) cur + rowId else cur - rowId)
                    },
                    onOverride = { actionId, rowId, name ->
                        val cur = overrides[actionId].orEmpty().toMutableMap()
                        if (name.isEmpty()) cur.remove(rowId) else cur[rowId] = name
                        overrides = overrides + (actionId to cur)
                    },
                    onConfirm = { actionId ->
                        scope.launch {
                            try {
                                repo.confirmAction(
                                    actionId,
                                    selectedIds = selectedRows[actionId]?.toList(),
                                    categoryOverrides = overrides[actionId],
                                )
                                reloadMessages()
                            } catch (e: Exception) {
                                error = e.message
                            }
                        }
                    },
                    onCancel = { actionId ->
                        scope.launch {
                            try {
                                repo.cancelAction(actionId)
                                reloadMessages()
                            } catch (e: Exception) {
                                error = e.message
                            }
                        }
                    },
                )
            }
        }
        if (attachName != null) {
            Row {
                Text("附件：$attachName", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = {
                    attachName = null
                    attachBytes = null
                }) { Text("移除") }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = { attachPicker.launch("*/*") }) { Text("附件") }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text("输入消息") },
                modifier = Modifier.weight(1f),
            )
            Button(
                enabled = !busy && (text.trim().isNotEmpty() || attachBytes != null),
                onClick = {
                    val id = conversationId ?: return@Button
                    scope.launch {
                        busy = true
                        try {
                            val res = repo.sendMessage(
                                id,
                                text,
                                UUID.randomUUID().toString(),
                                if (attachBytes != null) Triple(attachName ?: "file", "auto", attachBytes!!) else null,
                            )
                            val arr = res.optJSONArray("items")
                            val list = mutableListOf<JSONObject>()
                            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
                            if (list.isNotEmpty()) messages = messages + list
                            text = ""
                            attachName = null
                            attachBytes = null
                        } catch (e: Exception) {
                            error = e.message
                        } finally {
                            busy = false
                        }
                    }
                },
            ) { Text(if (busy) "…" else "发送") }
        }
    }
}

private fun cardRows(card: JSONObject): List<JSONObject> {
    val preview = card.optJSONObject("preview") ?: return emptyList()
    val arr = preview.optJSONArray("rows") ?: return emptyList()
    return List(arr.length()) { arr.optJSONObject(it) }
}

@Composable
private fun MessageCard(
    message: JSONObject,
    selectedRows: Map<String, Set<String>>,
    overrides: Map<String, Map<String, String>>,
    onToggleRow: (String, String, Boolean) -> Unit,
    onOverride: (String, String, String) -> Unit,
    onConfirm: (String) -> Unit,
    onCancel: (String) -> Unit,
) {
    val role = message.optString("role")
    val content = message.optJSONObject("content")
    val text = content?.optString("text").orEmpty()
    val card = content?.optJSONObject("card")
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(if (role == "user") "我" else "AI", style = MaterialTheme.typography.bodySmall)
            if (text.isNotEmpty()) {
                Text(text)
            }
            if (card != null) {
                val actionId = card.optString("actionId")
                val tool = card.optString("toolName")
                Text("待确认：$tool", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(4.dp))
                if (tool == "platform-import.prepare") {
                    for (r in cardRows(card)) {
                        val id = r.optString("id")
                        val sel = selectedRows[actionId].orEmpty()
                        val locked = r.optBoolean("alreadyExists") || r.optBoolean("ignored")
                        Row(Modifier.fillMaxWidth()) {
                            Checkbox(
                                checked = id in sel,
                                enabled = !locked,
                                onCheckedChange = { onToggleRow(actionId, id, it) },
                            )
                            Column(Modifier.weight(1f)) {
                                Text(r.optString("note").ifEmpty { r.optString("counterparty") })
                                Text(
                                    "${formatYuan(r.optLong("amountCents"))} · " +
                                        (overrides[actionId]?.get(id) ?: r.optString("categoryName")),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
                Row {
                    Button(onClick = { onConfirm(actionId) }) { Text("确认") }
                    OutlinedButton(onClick = { onCancel(actionId) }) { Text("取消") }
                }
            }
        }
    }
}

