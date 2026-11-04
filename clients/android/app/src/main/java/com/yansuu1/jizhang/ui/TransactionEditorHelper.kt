package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.AuthExpiredException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Immutable snapshot of every editable transaction field.
 *
 * One type serves three jobs — the discard-changes baseline, the validation /
 * payload input, and the refund seed hand-off — so a field can never be
 * editable yet silently missing from the save payload or from the dirty check.
 */
data class TransactionEditorDraft(
    val type: Int = TransactionEditorHelper.EXPENSE_TYPE,
    val amountText: String = "",
    val categoryId: String = "",
    val accountId: String = "",
    val dateText: String = "",
    val note: String = "",
    val tagsText: String = "",
    val refundLinks: String = "",
    val isRefund: Boolean = false,
    val financialPurpose: String? = null,
)

/**
 * Production helpers behind the transaction editor. They own the parts that must
 * stay identical for every entry point: category selection, validation, the
 * complete API payload, and the single synchronously gated save path.
 */
object TransactionEditorHelper {
    const val EXPENSE_TYPE = 0
    const val INCOME_TYPE = 1

    /** Same user-facing text as the pre-existing editor; kept stable on purpose. */
    const val AMOUNT_ERROR = "金额须为大于 0 的数字"
    const val TARGET_ERROR = "请选择分类与账户"
    const val PARENT_CATEGORY_ERROR = "父分类不能直接记账，请选择子分类"
    const val SAVE_ERROR = "保存失败"

    /** Refund seed left the receiving account empty because the original one is gone. */
    const val REFUND_ACCOUNT_UNAVAILABLE_ERROR = "原到账账户当前不可用，请选择到账账户"

    /** First category id that is not a parent (the server rejects parent categories). */
    fun firstLeafCategoryId(categories: List<JSONObject>, parentIds: Set<String>): String =
        categories
            .firstOrNull { it.optString("id").isNotBlank() && it.optString("id") !in parentIds }
            ?.optString("id")
            .orEmpty()

    /**
     * Tags and refund links are entered as free text; commas in either width
     * split the list, empty entries are dropped and the server still dedupes tags.
     */
    fun splitMultiValue(text: String): List<String> =
        text.split(',', '，').map { it.trim() }.filter { it.isNotEmpty() }

    /** Toggle a catalogue name without dropping manually entered or legacy tags. */
    fun toggleTag(text: String, name: String): String {
        val tag = name.trim()
        if (tag.isEmpty()) return text
        val current = splitMultiValue(text)
        return (if (tag in current) current.filterNot { it == tag } else current + tag)
            .distinct().joinToString(", ")
    }

    fun tagNames(response: JSONObject): List<String> {
        val items = response.optJSONArray("items") ?: error("标签列表格式无效")
        return (0 until items.length()).mapNotNull { index ->
            items.optJSONObject(index)?.opt("name")?.let { it as? String }?.trim()?.takeIf { it.isNotEmpty() }
        }.distinct()
    }

    /** Draft rebuilt from a server transaction (edit mode). */
    fun draftFromTransaction(item: JSONObject): TransactionEditorDraft {
        val existingTags = item.optJSONArray("tags")
        val links = item.optJSONArray("refundLinkedTxIds")
        val itemType = item.optInt("type")
        val rawPurpose = TransactionEditorStateHelper.purposeFromTransaction(item)
        return TransactionEditorDraft(
            type = itemType,
            // Never optLong(): a missing/oversized value must not become 0.00.
            amountText = TransactionEditorStateHelper.safeAmountText(item),
            categoryId = item.optString("categoryId"),
            accountId = item.optString("accountId"),
            dateText = dateInput(item.optLong("date")),
            note = item.optString("note"),
            tagsText = (0 until (existingTags?.length() ?: 0))
                .joinToString(", ") { existingTags!!.getString(it) },
            refundLinks = (0 until (links?.length() ?: 0))
                .joinToString(",") { links!!.getString(it) },
            isRefund = item.optBoolean("isRefund"),
            financialPurpose = if (itemType == EXPENSE_TYPE) rawPurpose else null,
        )
    }

    /**
     * Validation shared by every save entry point.
     *
     * @param refundAccountUnavailable the refund seed could not reuse the
     *   original account, so an empty account needs an explicit choice instead
     *   of a silent fallback to the first account.
     * @return the message to show on the top error overlay, or null when valid.
     */
    fun validate(
        draft: TransactionEditorDraft,
        parentIds: Set<String>,
        refundAccountUnavailable: Boolean = false,
    ): String? {
        val cents = parseYuanToCents(draft.amountText)
        if (cents == null || cents <= 0) return AMOUNT_ERROR
        if (draft.categoryId.isEmpty()) return TARGET_ERROR
        if (draft.accountId.isEmpty()) {
            return if (refundAccountUnavailable) REFUND_ACCOUNT_UNAVAILABLE_ERROR else TARGET_ERROR
        }
        if (draft.categoryId in parentIds) return PARENT_CATEGORY_ERROR
        val dateFailure = runCatching { parseDateInput(draft.dateText) }.exceptionOrNull()
        if (dateFailure != null) return dateFailure.message ?: "请填写有效日期（YYYY-MM-DD）"
        if (draft.type != EXPENSE_TYPE && draft.financialPurpose != null) {
            return "非支出账单不可指定理财用途"
        }
        if (draft.financialPurpose != null && draft.financialPurpose !in setOf("essentials", "joy")) {
            return "理财用途必须是必要开支或随心消费"
        }
        return null
    }

    /**
     * Complete POST/PATCH payload. Non-refund and expense drafts always send an
     * empty `refundLinkedTxIds`, matching the existing server contract; editing
     * sends every editable field so a PATCH cannot drop values.
     */
    fun buildPayload(draft: TransactionEditorDraft): JSONObject {
        val cents = requireNotNull(parseYuanToCents(draft.amountText)) { AMOUNT_ERROR }
        val keepsLinks = draft.type == INCOME_TYPE && draft.isRefund
        val obj = JSONObject()
            .put("type", draft.type)
            .put("amountCents", cents)
            .put("categoryId", draft.categoryId)
            .put("accountId", draft.accountId)
            .put("date", parseDateInput(draft.dateText))
            .put("note", draft.note)
            .put("isRefund", draft.type == INCOME_TYPE && draft.isRefund)
            .put("tags", JSONArray(splitMultiValue(draft.tagsText)))
            .put(
                "refundLinkedTxIds",
                JSONArray(if (keepsLinks) splitMultiValue(draft.refundLinks) else emptyList<String>()),
            )
        // `financialPurpose` is intentionally omitted here. Sending it on every
        // edit made all PATCHes fail (guards required), and sending it to an old
        // server breaks ordinary ledger edits. An explicit override is added by
        // TransactionEditorStateHelper.buildPayload(draft, plan) only when the
        // user actually changes the purpose on a live expense.
        return obj
    }

    /** `LedgerRepository` takes maps; array values stay arrays so the wire JSON is unchanged. */
    fun buildPayloadMap(draft: TransactionEditorDraft): Map<String, Any?> = jsonObjectToMap(buildPayload(draft))

    private fun jsonObjectToMap(o: JSONObject): Map<String, Any?> {
        val out = mutableMapOf<String, Any?>()
        val keys = o.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            out[k] = o.opt(k)
        }
        return out
    }
}

/**
 * The single save path behind every entry point (top bar and bottom button).
 *
 * [submit] reserves the write *synchronously* — validation, payload build and
 * `saving = true` all happen before the coroutine starts — so a second tap
 * while the first request is in flight cannot create a second transaction.
 * State stays owned by the caller (Compose state), which keeps this class
 * JVM-testable without a UI.
 */
/** One already-persisted mutation that must be replayed byte-for-byte. */
data class TransactionEditorReplayRequest(
    val operationId: String,
    val method: String,
    val path: String,
    val payload: JSONObject,
)

/**
 * A prepared save. Ordinary edits use [payload]; an explicit purpose write is
 * recorded locally (by the sheet's prepare block) and sent through
 * [replay] with the same operationId/payload on every retry.
 */
data class TransactionEditorPreparedWrite(
    val payload: Map<String, Any?>,
    val replay: TransactionEditorReplayRequest? = null,
)

class TransactionEditorSubmitter(
    private val isSaving: () -> Boolean,
    private val setSaving: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
    private val onAuthExpired: () -> Unit,
    private val write: suspend (create: Boolean, payload: Map<String, Any?>) -> Unit,
    private val onSaved: () -> Unit,
    private val prepare: (suspend (create: Boolean, draft: TransactionEditorDraft) -> TransactionEditorPreparedWrite)? = null,
    private val writeReplay: (suspend (request: TransactionEditorReplayRequest) -> Unit)? = null,
) {
    /**
     * @return true when this call owns the save. False means the tap was
     *   rejected: already saving, invalid draft, or an unbuildable payload.
     */
    fun submit(
        scope: CoroutineScope,
        create: Boolean,
        draft: TransactionEditorDraft,
        parentIds: Set<String>,
        refundAccountUnavailable: Boolean = false,
    ): Boolean {
        if (isSaving()) return false
        val message = TransactionEditorHelper.validate(draft, parentIds, refundAccountUnavailable)
        if (message != null) {
            onError(message)
            return false
        }
        setSaving(true)
        scope.launch {
            try {
                val prepared = prepare?.invoke(create, draft)
                    ?: TransactionEditorPreparedWrite(TransactionEditorHelper.buildPayloadMap(draft))
                val replay = prepared.replay
                if (replay != null) {
                    writeReplay?.invoke(replay)
                        ?: error("编辑器未配置幂等重放通道")
                } else {
                    write(create, prepared.payload)
                }
                onSaved()
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                onAuthExpired()
            } catch (e: Exception) {
                onError(e.message ?: TransactionEditorHelper.SAVE_ERROR)
            } finally {
                setSaving(false)
            }
        }
        return true
    }
}
