package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialBillPurpose
import com.yansuu1.jizhang.repo.FinancialCapabilitiesResponse
import org.json.JSONObject

/**
 * How much of the bill-purpose contract this server can honour.
 *
 * UNKNOWN is deliberately distinct from LEGACY_UNSUPPORTED: an unrecognised
 * server must never make the editor send a purpose field it may reject, but it
 * also must not tell the user that keeping the existing override is impossible.
 */
enum class FinancialPurposeCapability {
    UNKNOWN,
    SUPPORTED,
    LEGACY_UNSUPPORTED,
    ;

    val canChangePurpose: Boolean get() = this == SUPPORTED

    companion object {
        fun fromCapabilities(capabilities: FinancialCapabilitiesResponse): FinancialPurposeCapability =
            if (capabilities.executionSupported && capabilities.billPurposeOverride) {
                SUPPORTED
            } else {
                LEGACY_UNSUPPORTED
            }
    }
}

/** Server-issued guard for one explicit bill-purpose write. */
data class FinancialPurposeSnapshot(
    val transactionId: String,
    val transactionToken: String,
    val revision: Long,
    val financialPurpose: String?,
) {
    init {
        require(transactionId.isNotBlank()) { "transactionId 不能为空白" }
        require(transactionToken.isNotBlank()) { "transactionToken 不能为空白" }
        require(revision >= 0) { "financialPurposeRevision 不能为负数" }
    }

    companion object {
        fun from(bill: FinancialBillPurpose): FinancialPurposeSnapshot = FinancialPurposeSnapshot(
            transactionId = bill.transactionId,
            transactionToken = bill.transactionToken,
            revision = bill.revision,
            financialPurpose = bill.financialPurpose?.wire,
        )
    }
}

/**
 * The exact purpose-related keys one save must carry.
 *
 * `includePurpose == false` means the key is omitted entirely: an unchanged
 * edit must never send `financialPurpose`, because the server rejects a PATCH
 * that carries purpose guards without an explicit purpose field.
 */
data class TransactionEditorPurposePlan(
    val includePurpose: Boolean,
    val financialPurpose: String?,
    val operationId: String?,
    val expectedFinancialPurposeRevision: Long?,
    val expectedTransactionToken: String?,
) {
    init {
        if (includePurpose) {
            require(financialPurpose == null || financialPurpose == "essentials" || financialPurpose == "joy") {
                "理财用途必须是 essentials 或 joy"
            }
            require(!operationId.isNullOrBlank()) { "显式用途写入必须有 operationId" }
            require(expectedFinancialPurposeRevision == null || expectedFinancialPurposeRevision >= 0) {
                "expectedFinancialPurposeRevision 不能为负数"
            }
            if (expectedFinancialPurposeRevision != null || expectedTransactionToken != null) {
                require(expectedFinancialPurposeRevision != null && !expectedTransactionToken.isNullOrBlank()) {
                    "编辑用途必须同时携带 revision 和 transactionToken"
                }
            }
        } else {
            require(financialPurpose == null && operationId == null &&
                expectedFinancialPurposeRevision == null && expectedTransactionToken == null) {
                "省略用途时不得携带用途、operationId 或 CAS 令牌"
            }
        }
    }

    companion object {
        val OMIT = TransactionEditorPurposePlan(
            includePurpose = false,
            financialPurpose = null,
            operationId = null,
            expectedFinancialPurposeRevision = null,
            expectedTransactionToken = null,
        )
    }
}

/**
 * Pure state rules for the bill editor. Kept out of the Compose sheet so the
 * risky parts — optional-field preservation, safe amount decoding and the
 * explicit-purpose decision — are covered by real JVM state tests.
 */
object TransactionEditorStateHelper {
    const val MAX_SAFE_CENTS = 9_007_199_254_740_991L

    const val PURPOSE_CAPABILITY_UNKNOWN_MESSAGE =
        "暂时无法确认服务器是否支持理财用途；已按普通账单保存，不会发送用途字段。"
    const val PURPOSE_UNSUPPORTED_MESSAGE =
        "当前服务端不支持账单理财用途；已按普通账单保存。"
    const val PURPOSE_RELOAD_MESSAGE =
        "这笔账单的理财用途已在服务器上变化，请重新打开后再修改。"
    const val PURPOSE_UNSUPPORTED_BLOCK_MESSAGE =
        "当前服务端不支持账单理财用途，无法保存这次用途修改；其他账单字段仍可按普通账单保存。"
    const val PURPOSE_CAPABILITY_UNKNOWN_BLOCK_MESSAGE =
        "暂时无法确认服务器是否支持账单理财用途，请稍后重试；其他账单字段可按普通账单保存。"
    const val PURPOSE_SNAPSHOT_MISSING_MESSAGE =
        "未能读取账单用途版本，请重试后再保存。"

    /**
     * Decode cents without `JSONObject.optLong`, which turns a missing or
     * non-integral value into 0 and would let an untouched edit silently erase
     * the real amount. Returns null when the field is absent or unsafe; the UI
     * then requires an explicit amount instead of guessing.
     */
    fun safeAmountCents(value: Any?): Long? {
        val cents = when (value) {
            is Long -> value
            is Int -> value.toLong()
            is Short -> value.toLong()
            is Byte -> value.toLong()
            is Number -> {
                val double = value.toDouble()
                if (!double.isFinite() || double % 1.0 != 0.0) return null
                if (double < 0.0 || double > MAX_SAFE_CENTS.toDouble()) return null
                double.toLong()
            }
            else -> return null
        }
        return cents.takeIf { it in 0L..MAX_SAFE_CENTS }
    }

    /** Empty text is intentional: validation catches it instead of saving 0.00. */
    fun safeAmountText(item: JSONObject): String {
        if (!item.has("amountCents") || item.isNull("amountCents")) return ""
        return safeAmountCents(item.opt("amountCents"))?.let(::formatYuan).orEmpty()
    }

    /** True when the server sent either the new or the legacy optional purpose field. */
    fun hasPurposeField(item: JSONObject): Boolean =
        item.has("financialPurpose") || item.has("purpose")

    /**
     * Decode the optional purpose without inventing an explicit null for an old
     * server that did not send the field. Missing and null both read as null,
     * but [hasPurposeField] preserves the wire distinction for tests/callers.
     */
    fun purposeFromTransaction(item: JSONObject): String? {
        if (item.has("financialPurpose") && !item.isNull("financialPurpose")) {
            return item.optString("financialPurpose").takeIf { it.isNotBlank() }
        }
        if (item.has("purpose") && !item.isNull("purpose")) {
            return item.optString("purpose").takeIf { it.isNotBlank() }
        }
        return null
    }

    fun baselineDraft(item: JSONObject): TransactionEditorDraft =
        TransactionEditorHelper.draftFromTransaction(item)

    fun isDirty(baseline: TransactionEditorDraft, current: TransactionEditorDraft): Boolean =
        baseline != current

    /**
     * Decide whether one save must carry an explicit purpose.
     *
     * - create: send the field only when the user selected a purpose and the
     *   server supports it; the create itself then carries the operationId.
     * - edit unchanged: omit the field and every guard (old PATCHes failed
     *   because the helper always sent the field without guards).
     * - edit to income: omit; the backend clears the override atomically.
     * - legacy/unknown server: omit and keep the ordinary ledger write working.
     * - edit changed on a live expense: require the FP snapshot and all guards.
     */
    fun planPurpose(
        create: Boolean,
        baseline: TransactionEditorDraft,
        current: TransactionEditorDraft,
        capability: FinancialPurposeCapability,
        snapshot: FinancialPurposeSnapshot? = null,
        operationId: String? = null,
    ): TransactionEditorPurposePlan {
        if (!capability.canChangePurpose) return TransactionEditorPurposePlan.OMIT
        if (!create && current.type != TransactionEditorHelper.EXPENSE_TYPE) {
            // expense -> income: the server owns the implicit clear.
            return TransactionEditorPurposePlan.OMIT
        }
        if (!create && current.financialPurpose == baseline.financialPurpose) {
            return TransactionEditorPurposePlan.OMIT
        }
        if (create && current.financialPurpose == null) {
            return TransactionEditorPurposePlan.OMIT
        }
        if (create) {
            return TransactionEditorPurposePlan(
                includePurpose = true,
                financialPurpose = current.financialPurpose,
                operationId = operationId,
                expectedFinancialPurposeRevision = null,
                expectedTransactionToken = null,
            )
        }

        val guard = snapshot ?: throw IllegalStateException(PURPOSE_SNAPSHOT_MISSING_MESSAGE)
        if (guard.financialPurpose != baseline.financialPurpose) {
            throw IllegalStateException(PURPOSE_RELOAD_MESSAGE)
        }
        return TransactionEditorPurposePlan(
            includePurpose = true,
            financialPurpose = current.financialPurpose,
            operationId = operationId,
            expectedFinancialPurposeRevision = guard.revision,
            expectedTransactionToken = guard.transactionToken,
        )
    }

    /**
     * Full combined payload. The ordinary fields are always rebuilt exactly as
     * the existing editor did; purpose keys are added only by an explicit plan.
     */
    fun buildPayload(draft: TransactionEditorDraft, plan: TransactionEditorPurposePlan): JSONObject {
        val payload = TransactionEditorHelper.buildPayload(draft)
        if (plan.includePurpose) {
            payload.put("financialPurpose", plan.financialPurpose ?: JSONObject.NULL)
            payload.put("operationId", plan.operationId!!)
            plan.expectedFinancialPurposeRevision?.let {
                payload.put("expectedFinancialPurposeRevision", it)
            }
            plan.expectedTransactionToken?.let { payload.put("expectedTransactionToken", it) }
        }
        return payload
    }

    fun buildPayloadMap(draft: TransactionEditorDraft, plan: TransactionEditorPurposePlan): Map<String, Any?> =
        jsonObjectToMap(buildPayload(draft, plan))

    internal fun jsonObjectToMap(o: JSONObject): Map<String, Any?> {
        val out = mutableMapOf<String, Any?>()
        val keys = o.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            out[k] = o.opt(k)
        }
        return out
    }
}
