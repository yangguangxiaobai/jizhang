package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.net.JsonNumberReaders
import org.json.JSONArray
import org.json.JSONObject

// ── Strict Helpers ─────────────────────────────────────────────────────────────

internal fun JSONObject.optNullableString(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key)

internal fun JSONObject.optCleanString(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

private fun parseStrictLong(key: String, raw: Any): Long =
    JsonNumberReaders.requireExactLong(raw, key)

private fun parseStrictInt(key: String, raw: Any): Int =
    JsonNumberReaders.requireExactInt(raw, key)

internal fun JSONObject.requireLongFact(key: String): Long {
    if (!has(key) || isNull(key)) throw IllegalArgumentException("Missing required long fact '$key'")
    return parseStrictLong(key, get(key))
}

internal fun JSONObject.optLongFact(key: String, default: Long = 0L): Long {
    if (!has(key) || isNull(key)) return default
    return parseStrictLong(key, get(key))
}

internal fun JSONObject.optNullableLongFact(key: String): Long? {
    if (!has(key) || isNull(key)) return null
    return parseStrictLong(key, get(key))
}

internal fun JSONObject.requireIntFact(key: String): Int {
    if (!has(key) || isNull(key)) throw IllegalArgumentException("Missing required int fact '$key'")
    return parseStrictInt(key, get(key))
}

internal fun JSONObject.optIntFact(key: String, default: Int = 0): Int {
    if (!has(key) || isNull(key)) return default
    return parseStrictInt(key, get(key))
}

internal fun JSONObject.optNullableIntFact(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    return parseStrictInt(key, get(key))
}

// ── Models ─────────────────────────────────────────────────────────────────────

data class ImportBatchFile(
    val fileIndex: Int,
    val fileName: String,
    val source: String,
    val sizeBytes: Long,
    val sha256: String,
    val parseStatus: String, // "ok" | "failed"
    val rawRowCount: Int?,
    val collectedRowCount: Int?,
    val error: String?,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportBatchFile {
            val fileName = obj.optCleanString("fileName")
                ?: throw IllegalArgumentException("ImportBatchFile requires non-empty fileName")
            val statusRaw = obj.optCleanString("parseStatus") ?: "failed"
            val parseStatus = if (statusRaw == "ok") "ok" else "failed"

            return ImportBatchFile(
                fileIndex = obj.requireIntFact("fileIndex"),
                fileName = fileName,
                source = obj.optString("source", "auto"),
                sizeBytes = obj.optLongFact("sizeBytes"),
                sha256 = obj.optString("sha256", ""),
                parseStatus = parseStatus,
                rawRowCount = obj.optNullableIntFact("rawRowCount"),
                collectedRowCount = obj.optNullableIntFact("collectedRowCount"),
                error = obj.optCleanString("error"),
            )
        }
    }
}

data class ImportBatchNotice(
    val code: String,
    val itemId: String?,
    val detail: String,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportBatchNotice = ImportBatchNotice(
            code = obj.optString("code", ""),
            itemId = obj.optCleanString("itemId"),
            detail = obj.optString("detail", ""),
        )
    }
}

data class ImportBatchSummary(
    val totalItems: Int,
    val importable: Int,
    val existing: Int,
    val ignored: Int,
    val mergedGroups: Int,
    val conflictGroups: Int,
    val weakDuplicateGroups: Int,
    val expenseCents: Long,
    val incomeCents: Long,
    val dateFrom: String?,
    val dateTo: String?,
    val legacyLedgerMatches: Int,
    val unparsedFiles: Int,
    val notices: List<ImportBatchNotice>,
) {
    companion object {
        fun fromJson(obj: JSONObject?): ImportBatchSummary {
            if (obj == null) {
                return ImportBatchSummary(0, 0, 0, 0, 0, 0, 0, 0L, 0L, null, null, 0, 0, emptyList())
            }
            val noticesArr = obj.optJSONArray("notices")
            val notices = if (noticesArr != null) {
                (0 until noticesArr.length()).mapNotNull { i ->
                    noticesArr.optJSONObject(i)?.let { ImportBatchNotice.fromJson(it) }
                }
            } else emptyList()

            return ImportBatchSummary(
                totalItems = obj.optIntFact("totalItems"),
                importable = obj.optIntFact("importable"),
                existing = obj.optIntFact("existing"),
                ignored = obj.optIntFact("ignored"),
                mergedGroups = obj.optIntFact("mergedGroups"),
                conflictGroups = obj.optIntFact("conflictGroups"),
                weakDuplicateGroups = obj.optIntFact("weakDuplicateGroups"),
                expenseCents = obj.optLongFact("expenseCents"),
                incomeCents = obj.optLongFact("incomeCents"),
                dateFrom = obj.optCleanString("dateFrom"),
                dateTo = obj.optCleanString("dateTo"),
                legacyLedgerMatches = obj.optIntFact("legacyLedgerMatches"),
                unparsedFiles = obj.optIntFact("unparsedFiles"),
                notices = notices,
            )
        }
    }
}

data class ImportBatchAnalysis(
    val state: String, // "idle" | "running" | "complete" | "failed"
    val analysisRevision: Long,
    val analysed: Int,
    val providerCalls: Int,
    val suggestedNewCategories: Int,
    val message: String?,
) {
    companion object {
        fun fromJson(obj: JSONObject?): ImportBatchAnalysis {
            if (obj == null) return ImportBatchAnalysis("idle", 0L, 0, 0, 0, null)
            val rawState = obj.optCleanString("state") ?: "idle"
            val state = if (rawState in setOf("idle", "running", "complete", "failed")) rawState else "failed"
            return ImportBatchAnalysis(
                state = state,
                analysisRevision = obj.optLongFact("analysisRevision", 0L),
                analysed = obj.optIntFact("analysed"),
                providerCalls = obj.optIntFact("providerCalls"),
                suggestedNewCategories = obj.optIntFact("suggestedNewCategories"),
                message = obj.optCleanString("message"),
            )
        }
    }
}

data class ImportBatchResult(
    val inserted: Int,
    val selected: Int,
    val excluded: Int,
    val preexisting: Int,
    val expenseCents: Long,
    val incomeCents: Long,
    val accountsCreated: Int,
    val categoriesCreated: Int,
    val categoriesReused: Int,
    val categoriesSkippedUnused: Int,
    val warnings: List<String>,
) {
    companion object {
        fun fromJson(obj: JSONObject?): ImportBatchResult? {
            if (obj == null) return null
            val warningsArr = obj.optJSONArray("warnings")
            val warnings = if (warningsArr != null) {
                (0 until warningsArr.length()).mapNotNull { warningsArr.optString(it) }
            } else emptyList()

            return ImportBatchResult(
                inserted = obj.optIntFact("inserted"),
                selected = obj.optIntFact("selected"),
                excluded = obj.optIntFact("excluded"),
                preexisting = obj.optIntFact("preexisting"),
                expenseCents = obj.optLongFact("expenseCents"),
                incomeCents = obj.optLongFact("incomeCents"),
                accountsCreated = obj.optIntFact("accountsCreated"),
                categoriesCreated = obj.optIntFact("categoriesCreated"),
                categoriesReused = obj.optIntFact("categoriesReused"),
                categoriesSkippedUnused = obj.optIntFact("categoriesSkippedUnused"),
                warnings = warnings,
            )
        }
    }
}

data class ImportBatch(
    val batchId: String,
    val conversationId: String,
    val version: Long,
    val status: String, // "prepared" | "reviewed" | "confirmed" | "cancelled" | "expired" | "failed"
    val viewRevision: String,
    val files: List<ImportBatchFile>,
    val summary: ImportBatchSummary,
    val analysis: ImportBatchAnalysis,
    val result: ImportBatchResult?,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportBatch {
            val root = obj.optJSONObject("batch") ?: obj
            val batchId = root.optCleanString("batchId")
                ?: throw IllegalArgumentException("ImportBatch requires non-empty batchId")
            val version = root.requireLongFact("version")
            val rawStatus = root.optCleanString("status") ?: "failed"
            val status = if (rawStatus in setOf("prepared", "reviewed", "confirmed", "cancelled", "expired", "failed", "draft", "analysing", "ready", "confirming")) {
                rawStatus
            } else "failed"

            val filesArr = root.optJSONArray("files")
            val files = if (filesArr != null) {
                (0 until filesArr.length()).mapNotNull { i ->
                    filesArr.optJSONObject(i)?.let { ImportBatchFile.fromJson(it) }
                }
            } else emptyList()

            return ImportBatch(
                batchId = batchId,
                conversationId = root.optString("conversationId", ""),
                version = version,
                status = status,
                viewRevision = root.optCleanString("viewRevision")
                    ?: throw IllegalArgumentException("ImportBatch requires non-empty viewRevision"),
                files = files,
                summary = ImportBatchSummary.fromJson(root.optJSONObject("summary")),
                analysis = ImportBatchAnalysis.fromJson(root.optJSONObject("analysis")),
                result = ImportBatchResult.fromJson(root.optJSONObject("result")),
            )
        }
    }
}

data class ImportRowSource(
    val fileName: String,
    val fileIndex: Int,
    val sourceRow: Int,
    val note: String,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportRowSource = ImportRowSource(
            fileName = obj.optString("fileName", ""),
            fileIndex = obj.optIntFact("fileIndex"),
            sourceRow = obj.optIntFact("sourceRow"),
            note = obj.optString("note", ""),
        )
    }
}

data class ImportRowNoteAlternative(
    val fileName: String,
    val note: String,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportRowNoteAlternative = ImportRowNoteAlternative(
            fileName = obj.optString("fileName", ""),
            note = obj.optString("note", ""),
        )
    }
}

data class ImportRowFallback(
    val effectiveExistingId: String?,
    val categoryName: String?,
    val source: String?,
    val newOtherSuggestionId: String?,
) {
    companion object {
        fun fromJson(obj: JSONObject?): ImportRowFallback? {
            if (obj == null) return null
            return ImportRowFallback(
                effectiveExistingId = obj.optCleanString("effectiveExistingId"),
                categoryName = obj.optCleanString("categoryName"),
                source = obj.optCleanString("source"),
                newOtherSuggestionId = obj.optCleanString("newOtherSuggestionId"),
            )
        }
    }
}

data class ImportRowAi(
    val status: String,
    val include: Boolean?,
    val reason: String,
    val categoryId: String?,
    val newSuggestionId: String?,
) {
    companion object {
        fun fromJson(obj: JSONObject?): ImportRowAi? {
            if (obj == null) return null
            val include = if (obj.has("include") && !obj.isNull("include")) {
                val raw = obj.get("include")
                if (raw is Boolean) raw else throw IllegalArgumentException("ai.include must be boolean or null")
            } else null

            return ImportRowAi(
                status = obj.optCleanString("status") ?: "idle",
                include = include,
                reason = obj.optCleanString("reason") ?: "",
                categoryId = obj.optCleanString("categoryId"),
                newSuggestionId = obj.optCleanString("newSuggestionId"),
            )
        }
    }
}

data class ImportBatchRow(
    val itemId: String,
    val identityKind: String,
    val ordinal: Int,
    val conflictGroup: String?,
    val conflictKind: String?,
    val dateLabel: String,
    val sourceTimestamp: String?,
    val type: Int, // 0 = expense, 1 = income
    val amountCents: Long,
    val note: String,
    val noteAlternatives: List<ImportRowNoteAlternative>,
    val isRefund: Boolean,
    val refundWarning: String?,
    val rawStatus: String?,
    val ignored: Boolean,
    val ignoreReason: String?,
    val existing: Boolean,
    val possibleDuplicate: Boolean,
    val duplicateOfNote: String?,
    val weakDuplicateGroup: String?,
    val legacyLedgerMatch: Boolean,
    val comparisonAccountId: String?,
    val sources: List<ImportRowSource>,
    val fallback: ImportRowFallback?,
    val ai: ImportRowAi?,
) {
    val isHardBlocked: Boolean
        get() = amountCents <= 0 || conflictKind == "ledger_collision" || conflictKind == "weak_collision"

    val isEligible: Boolean
        get() = !existing && amountCents > 0 && conflictKind != "ledger_collision" && conflictKind != "weak_collision"

    companion object {
        fun fromJson(obj: JSONObject): ImportBatchRow {
            val itemId = obj.optCleanString("itemId")
                ?: throw IllegalArgumentException("ImportBatchRow requires non-empty itemId")
            val identityKind = obj.optCleanString("identityKind") ?: "occurrence"
            if (identityKind != "platform_order" && identityKind != "occurrence") {
                throw IllegalArgumentException("Unknown identityKind: $identityKind")
            }
            val type = obj.requireIntFact("type")
            if (type != 0 && type != 1) {
                throw IllegalArgumentException("Invalid transaction type: $type")
            }
            val amountCents = obj.requireLongFact("amountCents")

            val noteAltArr = obj.optJSONArray("noteAlternatives")
            val noteAlternatives = if (noteAltArr != null) {
                (0 until noteAltArr.length()).mapNotNull { i ->
                    noteAltArr.optJSONObject(i)?.let { ImportRowNoteAlternative.fromJson(it) }
                }
            } else emptyList()

            val sourcesArr = obj.optJSONArray("sources")
            val sources = if (sourcesArr != null) {
                (0 until sourcesArr.length()).mapNotNull { i ->
                    sourcesArr.optJSONObject(i)?.let { ImportRowSource.fromJson(it) }
                }
            } else emptyList()

            return ImportBatchRow(
                itemId = itemId,
                identityKind = identityKind,
                ordinal = obj.requireIntFact("ordinal"),
                conflictGroup = obj.optCleanString("conflictGroup"),
                conflictKind = obj.optCleanString("conflictKind"),
                dateLabel = obj.optString("dateLabel", ""),
                sourceTimestamp = obj.optCleanString("sourceTimestamp"),
                type = type,
                amountCents = amountCents,
                note = obj.optString("note", ""),
                noteAlternatives = noteAlternatives,
                isRefund = obj.optBoolean("isRefund", false),
                refundWarning = obj.optCleanString("refundWarning"),
                rawStatus = obj.optCleanString("rawStatus"),
                ignored = obj.optBoolean("ignored", false),
                ignoreReason = obj.optCleanString("ignoreReason"),
                existing = obj.optBoolean("existing", false),
                possibleDuplicate = obj.optBoolean("possibleDuplicate", false),
                duplicateOfNote = obj.optCleanString("duplicateOfNote"),
                weakDuplicateGroup = obj.optCleanString("weakDuplicateGroup"),
                legacyLedgerMatch = obj.optBoolean("legacyLedgerMatch", false),
                comparisonAccountId = obj.optCleanString("comparisonAccountId"),
                sources = sources,
                fallback = ImportRowFallback.fromJson(obj.optJSONObject("fallback")),
                ai = ImportRowAi.fromJson(obj.optJSONObject("ai")),
            )
        }
    }
}

data class ImportBatchRowsPage(
    val batchId: String,
    val version: Long,
    val analysisRevision: Long,
    val viewRevision: String,
    val total: Int,
    val items: List<ImportBatchRow>,
    val nextCursor: String?,
    val readAt: Long,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportBatchRowsPage {
            val batchId = obj.optCleanString("batchId")
                ?: throw IllegalArgumentException("ImportBatchRowsPage requires non-empty batchId")
            val itemsArr = obj.optJSONArray("items")
            val items = if (itemsArr != null) {
                (0 until itemsArr.length()).mapNotNull { i ->
                    itemsArr.optJSONObject(i)?.let { ImportBatchRow.fromJson(it) }
                }
            } else emptyList()

            return ImportBatchRowsPage(
                batchId = batchId,
                version = obj.requireLongFact("version"),
                analysisRevision = obj.optLongFact("analysisRevision", 0L),
                viewRevision = obj.optCleanString("viewRevision")
                    ?: throw IllegalArgumentException("ImportBatchRowsPage requires non-empty viewRevision"),
                total = obj.requireIntFact("total"),
                items = items,
                nextCursor = obj.optCleanString("nextCursor"),
                readAt = obj.requireLongFact("readAt"),
            )
        }
    }
}

data class CategorySuggestionCandidate(
    val categoryId: String,
    val name: String,
    val type: Int,
    val parentId: String?,
    val isLeaf: Boolean,
) {
    companion object {
        fun fromJson(obj: JSONObject): CategorySuggestionCandidate {
            val catId = obj.optCleanString("categoryId")
                ?: throw IllegalArgumentException("CategorySuggestionCandidate requires categoryId")
            return CategorySuggestionCandidate(
                categoryId = catId,
                name = obj.optString("name", ""),
                type = obj.requireIntFact("type"),
                parentId = obj.optCleanString("parentId"),
                isLeaf = obj.optBoolean("isLeaf", true),
            )
        }
    }
}

data class CategorySuggestion(
    val suggestionId: String,
    val origin: String, // "ai" | "server-fallback"
    val name: String,
    val type: Int,
    val parentId: String?,
    val relatedItemCount: Int,
    val relatedItemIds: List<String>,
    val candidates: List<CategorySuggestionCandidate>,
) {
    companion object {
        fun fromJson(obj: JSONObject): CategorySuggestion {
            val sugId = obj.optCleanString("suggestionId")
                ?: throw IllegalArgumentException("CategorySuggestion requires suggestionId")
            val type = obj.requireIntFact("type")
            if (type != 0 && type != 1) {
                throw IllegalArgumentException("Invalid category suggestion type: $type")
            }

            val relatedArr = obj.optJSONArray("relatedItemIds")
            val relatedIds = if (relatedArr != null) {
                (0 until relatedArr.length()).mapNotNull { relatedArr.optString(it) }
            } else emptyList()

            val candidatesArr = obj.optJSONArray("candidates")
            val candidates = if (candidatesArr != null) {
                (0 until candidatesArr.length()).mapNotNull { i ->
                    candidatesArr.optJSONObject(i)?.let { CategorySuggestionCandidate.fromJson(it) }
                }
            } else emptyList()

            return CategorySuggestion(
                suggestionId = sugId,
                origin = obj.optString("origin", "ai"),
                name = obj.optString("name", ""),
                type = type,
                parentId = obj.optCleanString("parentId"),
                relatedItemCount = obj.optIntFact("relatedItemCount", relatedIds.size),
                relatedItemIds = relatedIds,
                candidates = candidates,
            )
        }
    }
}

data class ImportActiveCategory(
    val id: String,
    val name: String,
    val type: Int,
    val parentId: String?,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportActiveCategory {
            val id = obj.optCleanString("id")
                ?: throw IllegalArgumentException("ImportActiveCategory requires id")
            return ImportActiveCategory(
                id = id,
                name = obj.optString("name", ""),
                type = obj.requireIntFact("type"),
                parentId = obj.optCleanString("parentId"),
            )
        }
    }
}

data class ImportBatchCategoriesResponse(
    val batchId: String,
    val version: Long,
    val analysisRevision: Long,
    val viewRevision: String,
    val categories: List<ImportActiveCategory>,
    val items: List<CategorySuggestion>,
    val notice: String?,
) {
    companion object {
        fun fromJson(obj: JSONObject): ImportBatchCategoriesResponse {
            val batchId = obj.optCleanString("batchId")
                ?: throw IllegalArgumentException("ImportBatchCategoriesResponse requires batchId")

            val catsArr = obj.optJSONArray("categories")
            val categories = if (catsArr != null) {
                (0 until catsArr.length()).mapNotNull { i ->
                    catsArr.optJSONObject(i)?.let { ImportActiveCategory.fromJson(it) }
                }
            } else emptyList()

            val itemsArr = obj.optJSONArray("items")
            val items = if (itemsArr != null) {
                (0 until itemsArr.length()).mapNotNull { i ->
                    itemsArr.optJSONObject(i)?.let { CategorySuggestion.fromJson(it) }
                }
            } else emptyList()

            return ImportBatchCategoriesResponse(
                batchId = batchId,
                version = obj.requireLongFact("version"),
                analysisRevision = obj.optLongFact("analysisRevision", 0L),
                viewRevision = obj.optCleanString("viewRevision")
                    ?: throw IllegalArgumentException("ImportBatchCategoriesResponse requires non-empty viewRevision"),
                categories = categories,
                items = items,
                notice = obj.optCleanString("notice"),
            )
        }
    }
}

sealed interface CategoryAssignment {
    data class Existing(val categoryId: String) : CategoryAssignment
    data class Suggestion(val suggestionId: String) : CategoryAssignment

    fun toJson(): JSONObject = when (this) {
        is Existing -> JSONObject().put("kind", "existing").put("categoryId", categoryId)
        is Suggestion -> JSONObject().put("kind", "suggestion").put("suggestionId", suggestionId)
    }

    companion object {
        fun fromJson(obj: JSONObject): CategoryAssignment? {
            return when (obj.optString("kind")) {
                "existing" -> {
                    val id = obj.optCleanString("categoryId") ?: return null
                    Existing(id)
                }
                "suggestion" -> {
                    val id = obj.optCleanString("suggestionId") ?: return null
                    Suggestion(id)
                }
                else -> null
            }
        }
    }
}

data class ApprovedCategory(
    val suggestionId: String,
    val resolution: String = "create", // Server normative protocol: resolution is always "create"
    val reuseCategoryId: String?,
    val name: String,
    val type: Int,
    val parentId: String?,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("suggestionId", suggestionId)
        .put("resolution", "create")
        .put("reuseCategoryId", reuseCategoryId ?: JSONObject.NULL)
        .put("name", name)
        .put("type", type)
        .put("parentId", parentId ?: JSONObject.NULL)

    companion object {
        fun fromJson(obj: JSONObject): ApprovedCategory = ApprovedCategory(
            suggestionId = obj.optString("suggestionId", ""),
            resolution = obj.optString("resolution", "create"),
            reuseCategoryId = obj.optCleanString("reuseCategoryId"),
            name = obj.optString("name", ""),
            type = obj.optIntFact("type", 0),
            parentId = obj.optCleanString("parentId"),
        )
    }
}

data class ConflictDecision(
    val conflictGroup: String,
    val chosenItemId: String?, // null = exclude all in this group
) {
    fun toJson(): JSONObject = JSONObject()
        .put("conflictGroup", conflictGroup)
        .put("chosenItemId", chosenItemId ?: JSONObject.NULL)

    companion object {
        fun fromJson(obj: JSONObject): ConflictDecision = ConflictDecision(
            conflictGroup = obj.optString("conflictGroup", ""),
            chosenItemId = obj.optCleanString("chosenItemId"),
        )
    }
}

data class ReviewCategoryPlan(
    val name: String,
    val type: Int,
    val selectedRows: Int,
) {
    companion object {
        fun fromJson(obj: JSONObject): ReviewCategoryPlan = ReviewCategoryPlan(
            name = obj.optString("name", ""),
            type = obj.optIntFact("type", 0),
            selectedRows = obj.optIntFact("selectedRows", 0),
        )
    }
}

data class ReviewReusePlan(
    val categoryId: String,
    val name: String,
    val selectedRows: Int,
) {
    companion object {
        fun fromJson(obj: JSONObject): ReviewReusePlan = ReviewReusePlan(
            categoryId = obj.optString("categoryId", ""),
            name = obj.optString("name", ""),
            selectedRows = obj.optIntFact("selectedRows", 0),
        )
    }
}

data class ReviewSelectedRow(
    val itemId: String,
    val type: Int,
    val amountCents: Long,
    val categoryId: String?,
    val suggestionId: String?,
    val note: String?,
    val categoryName: String? = null,
    val categoryType: Int? = null,
    val approvedNewCategoryName: String? = null,
    val resolvedNote: String? = null,
    val dateLabel: String? = null,
) {
    companion object {
        fun fromJson(obj: JSONObject): ReviewSelectedRow = ReviewSelectedRow(
            itemId = obj.optCleanString("itemId") ?: throw IllegalArgumentException("selectedRow requires itemId"),
            type = obj.requireIntFact("type"),
            amountCents = obj.requireLongFact("amountCents"),
            categoryId = obj.optCleanString("categoryId"),
            suggestionId = obj.optCleanString("suggestionId"),
            note = obj.optNullableString("note"),
            categoryName = obj.optCleanString("categoryName"),
            categoryType = obj.optNullableIntFact("categoryType"),
            approvedNewCategoryName = obj.optCleanString("approvedNewCategoryName"),
            resolvedNote = obj.optNullableString("resolvedNote"),
            dateLabel = obj.optCleanString("dateLabel"),
        )
    }
}

data class ReviewFilePlan(
    val fileName: String,
    val selectedRows: Int,
) {
    companion object {
        fun fromJson(obj: JSONObject): ReviewFilePlan = ReviewFilePlan(
            fileName = obj.optString("fileName", ""),
            selectedRows = obj.optIntFact("selectedRows", 0),
        )
    }
}

data class ReviewSummaryCounts(
    val total: Int,
    val selected: Int,
    val notSelected: Int,
    val preexisting: Int,
    val ruleIgnored: Int,
    val conflictRows: Int,
    val userExcluded: Int? = null,
) {
    companion object {
        fun fromJson(obj: JSONObject): ReviewSummaryCounts = ReviewSummaryCounts(
            total = obj.requireIntFact("total"),
            selected = obj.requireIntFact("selected"),
            notSelected = obj.requireIntFact("notSelected"),
            preexisting = obj.requireIntFact("preexisting"),
            ruleIgnored = obj.requireIntFact("ruleIgnored"),
            conflictRows = obj.requireIntFact("conflictRows"),
            userExcluded = obj.optNullableIntFact("userExcluded"),
        )
    }
}

data class ReviewSummary(
    val selected: Int,
    val amountCents: Long,
    val expenseCents: Long,
    val incomeCents: Long,
    val refundIncomeCents: Long,
    val categoriesToCreate: List<ReviewCategoryPlan>,
    val categoriesToReuse: List<ReviewReusePlan>,
    val selectedRows: List<ReviewSelectedRow>,
    val files: List<ReviewFilePlan>,
    val excluded: Int,
    val existing: Int,
    val conflicts: Int,
    val counts: ReviewSummaryCounts? = null,
) {
    val categoriesToCreateCount: Int get() = categoriesToCreate.size
    val categoriesToReuseCount: Int get() = categoriesToReuse.size

    companion object {
        fun fromJson(obj: JSONObject?): ReviewSummary {
            if (obj == null) {
                return ReviewSummary(0, 0L, 0L, 0L, 0L, emptyList(), emptyList(), emptyList(), emptyList(), 0, 0, 0, null)
            }

            val toCreateList = mutableListOf<ReviewCategoryPlan>()
            val toCreateArr = obj.optJSONArray("categoriesToCreate")
            if (toCreateArr != null) {
                for (i in 0 until toCreateArr.length()) {
                    toCreateArr.optJSONObject(i)?.let { toCreateList.add(ReviewCategoryPlan.fromJson(it)) }
                }
            } else {
                val num = obj.optIntFact("categoriesToCreate", 0)
                if (num > 0) toCreateList.add(ReviewCategoryPlan("新建分类", 0, num))
            }

            val toReuseList = mutableListOf<ReviewReusePlan>()
            val toReuseArr = obj.optJSONArray("categoriesToReuse")
            if (toReuseArr != null) {
                for (i in 0 until toReuseArr.length()) {
                    toReuseArr.optJSONObject(i)?.let { toReuseList.add(ReviewReusePlan.fromJson(it)) }
                }
            } else {
                val num = obj.optIntFact("categoriesToReuse", 0)
                if (num > 0) toReuseList.add(ReviewReusePlan("cat-reuse", "复用分类", num))
            }

            val selectedRowsList = mutableListOf<ReviewSelectedRow>()
            val selectedRowsArr = obj.optJSONArray("selectedRows")
            if (selectedRowsArr != null) {
                for (i in 0 until selectedRowsArr.length()) {
                    selectedRowsArr.optJSONObject(i)?.let { selectedRowsList.add(ReviewSelectedRow.fromJson(it)) }
                }
            }

            val filesList = mutableListOf<ReviewFilePlan>()
            val filesArr = obj.optJSONArray("files")
            if (filesArr != null) {
                for (i in 0 until filesArr.length()) {
                    filesArr.optJSONObject(i)?.let { filesList.add(ReviewFilePlan.fromJson(it)) }
                }
            }

            val counts = obj.optJSONObject("counts")?.let { ReviewSummaryCounts.fromJson(it) }

            return ReviewSummary(
                selected = obj.requireIntFact("selected"),
                amountCents = obj.requireLongFact("amountCents"),
                expenseCents = obj.requireLongFact("expenseCents"),
                incomeCents = obj.requireLongFact("incomeCents"),
                refundIncomeCents = obj.optLongFact("refundIncomeCents", 0L),
                categoriesToCreate = toCreateList,
                categoriesToReuse = toReuseList,
                selectedRows = selectedRowsList,
                files = filesList,
                excluded = obj.optIntFact("excluded", 0),
                existing = obj.optIntFact("existing", 0),
                conflicts = obj.optIntFact("conflicts", 0),
                counts = counts,
            )
        }
    }
}

data class ReviewResponse(
    val reviewToken: String,
    val version: Long,
    val analysisRevision: Long,
    val viewRevision: String,
    val expiresInSec: Long,
    val summary: ReviewSummary,
) {
    companion object {
        fun fromJson(obj: JSONObject): ReviewResponse = ReviewResponse(
            reviewToken = obj.optCleanString("reviewToken") ?: throw IllegalArgumentException("ReviewResponse requires reviewToken"),
            version = obj.requireLongFact("version"),
            analysisRevision = obj.optLongFact("analysisRevision", 0L),
            viewRevision = obj.optCleanString("viewRevision")
                ?: throw IllegalArgumentException("ReviewResponse requires non-empty viewRevision"),
            expiresInSec = obj.requireLongFact("expiresInSec"),
            summary = ReviewSummary.fromJson(obj.optJSONObject("summary")),
        )
    }
}

data class MutationResult(
    val batch: ImportBatch,
    val idRemap: Map<String, String>,
    val droppedDraftItemIds: List<String>,
    val identityUnchangedItemIds: List<String>,
    val replacedWithIdenticalDigest: Boolean,
    val notices: List<ImportBatchNotice>,
) {
    companion object {
        fun fromJson(obj: JSONObject): MutationResult {
            val remapObj = obj.optJSONObject("idRemap")
            val idRemap = mutableMapOf<String, String>()
            if (remapObj != null) {
                val keys = remapObj.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    idRemap[k] = remapObj.optString(k, "")
                }
            }

            val droppedArr = obj.optJSONArray("droppedDraftItemIds")
            val droppedDraftItemIds = if (droppedArr != null) {
                (0 until droppedArr.length()).mapNotNull { droppedArr.optString(it) }
            } else emptyList()

            val unchangedArr = obj.optJSONArray("identityUnchangedItemIds")
            val identityUnchangedItemIds = if (unchangedArr != null) {
                (0 until unchangedArr.length()).mapNotNull { unchangedArr.optString(it) }
            } else emptyList()

            val noticesArr = obj.optJSONArray("notices")
            val notices = if (noticesArr != null) {
                (0 until noticesArr.length()).mapNotNull { i ->
                    noticesArr.optJSONObject(i)?.let { ImportBatchNotice.fromJson(it) }
                }
            } else emptyList()

            return MutationResult(
                batch = ImportBatch.fromJson(obj.optJSONObject("batch") ?: obj),
                idRemap = idRemap,
                droppedDraftItemIds = droppedDraftItemIds,
                identityUnchangedItemIds = identityUnchangedItemIds,
                replacedWithIdenticalDigest = obj.optBoolean("replacedWithIdenticalDigest", false),
                notices = notices,
            )
        }
    }
}

// ── Batch Row Duplicate Comparison DTO ─────────────────────────────────────────

data class BatchRowDuplicateItem(
    val id: String,
    val type: Int,
    val amountCents: Long,
    val categoryId: String,
    val accountId: String,
    val date: Long,
    val note: String,
    val isRefund: Boolean,
    val accountName: String?,
    val categoryName: String?,
) {
    companion object {
        fun fromJson(obj: JSONObject): BatchRowDuplicateItem = BatchRowDuplicateItem(
            id = obj.optString("id", ""),
            type = obj.optIntFact("type", 0),
            amountCents = obj.optLongFact("amountCents", 0L),
            categoryId = obj.optString("categoryId", ""),
            accountId = obj.optString("accountId", ""),
            date = obj.optLongFact("date", 0L),
            note = obj.optString("note", ""),
            isRefund = obj.optBoolean("isRefund", false),
            accountName = obj.optCleanString("accountName"),
            categoryName = obj.optCleanString("categoryName"),
        )
    }
}

data class BatchRowDuplicatePage(
    val sourceItemId: String,
    val total: Int,
    val items: List<BatchRowDuplicateItem>,
    val nextCursor: String?,
    val readAt: Long,
    val rationale: String,
) {
    companion object {
        fun fromJson(obj: JSONObject): BatchRowDuplicatePage {
            val source = obj.optJSONObject("source")
            val itemsArr = obj.optJSONArray("items")
            val items = if (itemsArr != null) {
                (0 until itemsArr.length()).mapNotNull { i ->
                    itemsArr.optJSONObject(i)?.let { BatchRowDuplicateItem.fromJson(it) }
                }
            } else emptyList()

            return BatchRowDuplicatePage(
                sourceItemId = source?.optString("itemId", "") ?: "",
                total = obj.optIntFact("total", 0),
                items = items,
                nextCursor = obj.optCleanString("nextCursor"),
                readAt = obj.optLongFact("readAt", 0L),
                rationale = obj.optString("rationale", ""),
            )
        }
    }
}

// ── Bounded Pagination Reducer & Pure Checker ─────────────────────────────────

data class BatchPagesValidationResult(
    val isValid: Boolean,
    val errorMessage: String? = null,
    val loadedRows: List<ImportBatchRow> = emptyList(),
)

internal fun validateAndReduceBatchPages(
    declaredTotal: Int,
    expectedVersion: Long,
    expectedAnalysisRevision: Long,
    expectedViewRevision: String,
    pages: List<ImportBatchRowsPage>,
    maxPages: Int = 5,
): BatchPagesValidationResult {
    if (expectedViewRevision.isBlank()) {
        return BatchPagesValidationResult(false, "viewRevision 不能为空")
    }
    if (pages.size > maxPages) {
        return BatchPagesValidationResult(false, "超过最大允许分页数 ($maxPages 页)")
    }
    val seenCursors = mutableSetOf<String>()
    val loadedRows = mutableListOf<ImportBatchRow>()
    val seenItemIds = mutableSetOf<String>()

    for ((index, page) in pages.withIndex()) {
        if (page.version != expectedVersion) {
            return BatchPagesValidationResult(false, "第 ${index + 1} 页 version (${page.version}) 与批次 ($expectedVersion) 不一致")
        }
        if (page.analysisRevision != expectedAnalysisRevision) {
            return BatchPagesValidationResult(false, "第 ${index + 1} 页 analysisRevision (${page.analysisRevision}) 与批次 ($expectedAnalysisRevision) 不一致")
        }
        if (page.viewRevision.isBlank() || page.viewRevision != expectedViewRevision) {
            return BatchPagesValidationResult(false, "第 ${index + 1} 页 viewRevision ('${page.viewRevision}') 与批次 ('$expectedViewRevision') 不一致或为空")
        }
        if (page.total != declaredTotal) {
            return BatchPagesValidationResult(false, "第 ${index + 1} 页 total (${page.total}) 与批次声明总数 ($declaredTotal) 不一致")
        }

        // Duplicate cursor check
        val nextCursor = page.nextCursor
        if (!nextCursor.isNullOrBlank()) {
            if (!seenCursors.add(nextCursor)) {
                return BatchPagesValidationResult(false, "检测到重复游标: $nextCursor")
            }
        }

        // Abnormal empty page check
        if (page.items.isEmpty()) {
            if (declaredTotal > 0 && loadedRows.size < declaredTotal) {
                return BatchPagesValidationResult(false, "第 ${index + 1} 页返回空行，但已加载行数 (${loadedRows.size}) 未达到总数 ($declaredTotal)")
            }
            if (!nextCursor.isNullOrBlank()) {
                return BatchPagesValidationResult(false, "第 ${index + 1} 页返回空行但包含后续游标")
            }
        }

        for (item in page.items) {
            if (!seenItemIds.add(item.itemId)) {
                return BatchPagesValidationResult(false, "检测到重复账单项 ID: ${item.itemId}")
            }
            loadedRows.add(item)
        }
    }

    // Cursor must be exhausted
    val lastPage = pages.lastOrNull()
    if (lastPage != null && !lastPage.nextCursor.isNullOrBlank() && loadedRows.size < declaredTotal) {
        return BatchPagesValidationResult(false, "分页游标未耗尽 (仍有后续游标: ${lastPage.nextCursor})，已加载 ${loadedRows.size} / $declaredTotal")
    }
    if (lastPage != null && !lastPage.nextCursor.isNullOrBlank()) {
        return BatchPagesValidationResult(false, "分页游标未耗尽，达到最大页数后仍有游标")
    }

    // Total must strictly match loaded unique rows
    if (seenItemIds.size != declaredTotal) {
        return BatchPagesValidationResult(
            false,
            "批次总数校验失败: 实际唯一行数 (${seenItemIds.size}) 与批次声明总数 ($declaredTotal) 不一致"
        )
    }

    return BatchPagesValidationResult(
        isValid = true,
        errorMessage = null,
        loadedRows = loadedRows,
    )
}

