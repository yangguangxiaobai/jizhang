package com.yansuu1.jizhang.repo

import org.json.JSONArray
import org.json.JSONObject

/**
 * Normative models for AI streaming generation protocol v1 (protocol-v1.md).
 * Shared across network, repository, reducer, and UI layers.
 */

sealed class GenerationInput {
    abstract val type: String
    abstract fun toJson(): JSONObject

    data class Text(val text: String) : GenerationInput() {
        override val type: String = "text"
        override fun toJson(): JSONObject = JSONObject().put("type", type).put("text", text)
    }

    data class Choice(
        val sourceGenerationId: String,
        val questionId: String,
        val optionId: String,
    ) : GenerationInput() {
        override val type: String = "choice"
        override fun toJson(): JSONObject = JSONObject()
            .put("type", type)
            .put("sourceGenerationId", sourceGenerationId)
            .put("questionId", questionId)
            .put("optionId", optionId)
    }

    data class ChoiceText(
        val sourceGenerationId: String,
        val questionId: String,
        val text: String,
    ) : GenerationInput() {
        override val type: String = "choice-text"
        override fun toJson(): JSONObject = JSONObject()
            .put("type", type)
            .put("sourceGenerationId", sourceGenerationId)
            .put("questionId", questionId)
            .put("text", text)
    }
}

data class PartialMessage(
    val messageId: String,
    val step: Int,
    val text: String,
    val validated: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): PartialMessage {
            if (!json.has("messageId") || json.isNull("messageId")) {
                throw IllegalArgumentException("Missing messageId in partial message")
            }
            val mId = json.getString("messageId")
            require(mId.isNotBlank()) { "Empty messageId in partial message" }
            val step = json.optInt("step", 0)
            require(step in 0..2) { "Invalid step in partial message: $step" }
            val text = json.optString("text")
            require(text.length <= 4000) { "Partial message text exceeded 4000 chars" }
            return PartialMessage(
                messageId = mId,
                step = step,
                text = text,
                validated = json.optBoolean("validated", false),
            )
        }
    }
}

data class GenerationError(
    val code: String,
    val message: String,
) {
    companion object {
        fun fromJson(json: JSONObject?): GenerationError? {
            if (json == null) return null
            val code = json.optString("code")
            val message = json.optString("message")
            return if (code.isNotBlank() || message.isNotBlank()) GenerationError(code, message) else null
        }
    }
}

data class GenerationSnapshot(
    val version: Int,
    val id: String,
    val conversationId: String,
    val userMessageId: String,
    val userMessage: JSONObject?,
    val status: String, // accepted | running | completed | failed | cancelled | interrupted
    val delivery: String, // stream | buffered
    val lastSeq: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val partialMessages: List<PartialMessage>,
    val messageIds: List<String>,
    val messages: List<JSONObject>,
    val outcome: String?, // answer | awaiting-choice | pending-confirmation | null
    val error: GenerationError?,
) {
    companion object {
        fun fromJson(json: JSONObject): GenerationSnapshot {
            if (!json.has("version") || json.isNull("version")) {
                throw IllegalArgumentException("Missing snapshot version")
            }
            val version = json.getInt("version")
            require(version == 1) { "Unsupported snapshot version: $version" }

            if (!json.has("id") || json.isNull("id")) {
                throw IllegalArgumentException("Missing snapshot generation id")
            }
            val id = json.getString("id")
            require(id.isNotBlank()) { "Missing snapshot generation id" }
            require(id.length <= 128) { "Generation id too long: ${id.length}" }

            if (!json.has("conversationId") || json.isNull("conversationId")) {
                throw IllegalArgumentException("Missing snapshot conversationId")
            }
            val convId = json.getString("conversationId")
            require(convId.isNotBlank()) { "Missing snapshot conversationId" }
            require(convId.length <= 128) { "Conversation id too long: ${convId.length}" }

            if (!json.has("status") || json.isNull("status")) {
                throw IllegalArgumentException("Missing snapshot status")
            }
            val status = json.getString("status")
            require(status in listOf("accepted", "running", "completed", "failed", "cancelled", "interrupted")) {
                "Invalid snapshot status: $status"
            }

            if (!json.has("lastSeq") || json.isNull("lastSeq")) {
                throw IllegalArgumentException("Missing snapshot lastSeq")
            }
            val lastSeq = json.getLong("lastSeq")
            require(lastSeq >= 0L) { "Invalid lastSeq: $lastSeq" }

            val rawOutcome = if (json.has("outcome") && !json.isNull("outcome")) json.getString("outcome") else null
            val outcome = rawOutcome?.takeIf { it.isNotBlank() && it != "null" }
            if (outcome != null) {
                require(status == "completed") { "Outcome present on non-completed snapshot status: $status" }
                require(outcome in listOf("answer", "awaiting-choice", "pending-confirmation")) {
                    "Invalid snapshot outcome: $outcome"
                }
            }

            val partials = mutableListOf<PartialMessage>()
            val pArray = json.optJSONArray("partialMessages")
            if (pArray != null) {
                val len = minOf(pArray.length(), 2048)
                for (i in 0 until len) {
                    pArray.optJSONObject(i)?.let { partials.add(PartialMessage.fromJson(it)) }
                }
            }
            val msgIds = mutableListOf<String>()
            val mIdArray = json.optJSONArray("messageIds")
            if (mIdArray != null) {
                val len = minOf(mIdArray.length(), 2048)
                for (i in 0 until len) {
                    val mId = mIdArray.optString(i)
                    if (mId.isNotBlank()) msgIds.add(mId)
                }
            }
            val msgs = mutableListOf<JSONObject>()
            val mArray = json.optJSONArray("messages")
            if (mArray != null) {
                val len = minOf(mArray.length(), 2048)
                for (i in 0 until len) {
                    val mObj = mArray.optJSONObject(i)
                    if (mObj != null && mObj.optString("id").isNotBlank()) {
                        msgs.add(mObj)
                    }
                }
            }
            return GenerationSnapshot(
                version = version,
                id = id,
                conversationId = convId,
                userMessageId = json.optString("userMessageId"),
                userMessage = json.optJSONObject("userMessage"),
                status = status,
                delivery = json.optString("delivery", "stream"),
                lastSeq = lastSeq,
                createdAt = json.optLong("createdAt", 0L),
                updatedAt = json.optLong("updatedAt", 0L),
                partialMessages = partials,
                messageIds = msgIds,
                messages = msgs,
                outcome = outcome,
                error = GenerationError.fromJson(json.optJSONObject("error")),
            )
        }
    }
}

data class GenerationCreateResult(
    val created: Boolean,
    val generation: GenerationSnapshot,
) {
    companion object {
        fun fromJson(json: JSONObject): GenerationCreateResult {
            val created = json.optBoolean("created", true)
            val genObj = json.optJSONObject("generation") ?: json
            return GenerationCreateResult(
                created = created,
                generation = GenerationSnapshot.fromJson(genObj),
            )
        }
    }
}

sealed class AssistantGenerationEvent {
    abstract val version: Int
    abstract val generationId: String
    abstract val seq: Long
    abstract val type: String

    data class State(
        override val version: Int,
        override val generationId: String,
        override val seq: Long,
        val status: String,
    ) : AssistantGenerationEvent() {
        override val type: String = "state"
    }

    data class TextDelta(
        override val version: Int,
        override val generationId: String,
        override val seq: Long,
        val messageId: String,
        val step: Int,
        val offset: Int,
        val text: String,
    ) : AssistantGenerationEvent() {
        override val type: String = "text-delta"
    }

    data class Message(
        override val version: Int,
        override val generationId: String,
        override val seq: Long,
        val message: JSONObject,
    ) : AssistantGenerationEvent() {
        override val type: String = "message"
    }

    data class Terminal(
        override val version: Int,
        override val generationId: String,
        override val seq: Long,
        val status: String,
        val outcome: String?,
        val messageIds: List<String>,
        val error: GenerationError?,
    ) : AssistantGenerationEvent() {
        override val type: String = "terminal"
    }

    companion object {
        fun fromJson(json: JSONObject): AssistantGenerationEvent {
            if (!json.has("version") || json.isNull("version")) {
                throw IllegalArgumentException("Missing event version")
            }
            val version = json.getInt("version")
            require(version == 1) { "Unsupported generation event version: $version" }

            if (!json.has("generationId") || json.isNull("generationId")) {
                throw IllegalArgumentException("Missing generationId in event")
            }
            val generationId = json.getString("generationId")
            require(generationId.isNotBlank()) { "Missing generationId in event" }
            require(generationId.length <= 128) { "generationId too long in event: ${generationId.length}" }

            if (!json.has("seq") || json.isNull("seq")) {
                throw IllegalArgumentException("Missing seq in event")
            }
            val seq = json.getLong("seq")
            require(seq >= 1L) { "Invalid seq in event (must be positive): $seq" }

            if (!json.has("type") || json.isNull("type")) {
                throw IllegalArgumentException("Missing type in event")
            }
            return when (val type = json.getString("type")) {
                "state" -> {
                    if (!json.has("status") || json.isNull("status")) {
                        throw IllegalArgumentException("Missing status in state event")
                    }
                    val status = json.getString("status")
                    require(status in listOf("accepted", "running")) { "Invalid state status: $status" }
                    State(
                        version = version,
                        generationId = generationId,
                        seq = seq,
                        status = status,
                    )
                }
                "text-delta" -> {
                    if (!json.has("messageId") || json.isNull("messageId")) {
                        throw IllegalArgumentException("Missing messageId in text-delta")
                    }
                    val messageId = json.getString("messageId")
                    require(messageId.isNotBlank()) { "Missing messageId in text-delta" }

                    if (!json.has("step") || json.isNull("step")) {
                        throw IllegalArgumentException("Missing step in text-delta")
                    }
                    val step = json.getInt("step")
                    require(step in 0..2) { "Invalid step in text-delta: $step" }

                    if (!json.has("offset") || json.isNull("offset")) {
                        throw IllegalArgumentException("Missing offset in text-delta")
                    }
                    val offset = json.getInt("offset")
                    require(offset >= 0) { "Invalid offset in text-delta: $offset" }

                    val text = json.optString("text")
                    require(text.length <= 4000) { "text-delta exceeded 4000 chars" }
                    TextDelta(
                        version = version,
                        generationId = generationId,
                        seq = seq,
                        messageId = messageId,
                        step = step,
                        offset = offset,
                        text = text,
                    )
                }
                "message" -> {
                    val msgObj = json.optJSONObject("message")
                        ?: throw IllegalArgumentException("Missing message object in event")
                    if (!msgObj.has("id") || msgObj.isNull("id")) {
                        throw IllegalArgumentException("Missing id in message object")
                    }
                    val msgId = msgObj.getString("id")
                    require(msgId.isNotBlank()) { "Missing id in message event" }
                    Message(
                        version = version,
                        generationId = generationId,
                        seq = seq,
                        message = msgObj,
                    )
                }
                "terminal" -> {
                    if (!json.has("status") || json.isNull("status")) {
                        throw IllegalArgumentException("Missing status in terminal event")
                    }
                    val status = json.getString("status")
                    require(status in listOf("completed", "failed", "cancelled", "interrupted")) {
                        "Invalid terminal status: $status"
                    }
                    val rawOutcome = if (json.has("outcome") && !json.isNull("outcome")) json.getString("outcome") else null
                    val outcome = rawOutcome?.takeIf { it.isNotBlank() && it != "null" }
                    if (outcome != null) {
                        require(status == "completed") { "Outcome present on non-completed terminal status: $status" }
                        require(outcome in listOf("answer", "awaiting-choice", "pending-confirmation")) {
                            "Invalid terminal outcome: $outcome"
                        }
                    }
                    val mIds = mutableListOf<String>()
                    val arr = json.optJSONArray("messageIds")
                    if (arr != null) {
                        val len = minOf(arr.length(), 2048)
                        for (i in 0 until len) {
                            val id = arr.optString(i)
                            if (id.isNotBlank()) mIds.add(id)
                        }
                    }
                    Terminal(
                        version = version,
                        generationId = generationId,
                        seq = seq,
                        status = status,
                        outcome = outcome,
                        messageIds = mIds,
                        error = GenerationError.fromJson(json.optJSONObject("error")),
                    )
                }
                else -> throw IllegalArgumentException("Unknown generation event type: $type")
            }
        }
    }
}

data class ClarificationOption(
    val id: String,
    val label: String,
)

data class Clarification(
    val id: String,
    val selection: String, // single
    val question: String,
    val options: List<ClarificationOption>,
    val allowFreeText: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject?): Clarification? {
            if (json == null) return null
            val id = json.optString("id")
            val question = json.optString("question")
            val optionsArray = json.optJSONArray("options")
            val options = mutableListOf<ClarificationOption>()
            if (optionsArray != null) {
                for (i in 0 until optionsArray.length()) {
                    val optObj = optionsArray.optJSONObject(i) ?: continue
                    val optId = optObj.optString("id")
                    val optLabel = optObj.optString("label")
                    if (optId.isNotBlank() && optLabel.isNotBlank()) {
                        options.add(ClarificationOption(optId, optLabel))
                    }
                }
            }
            if (id.isBlank() && question.isBlank() && options.isEmpty()) return null
            return Clarification(
                id = id,
                selection = json.optString("selection", "single"),
                question = question,
                options = options,
                allowFreeText = json.optBoolean("allowFreeText", true),
            )
        }
    }
}

fun extractClarification(message: JSONObject): Clarification? {
    val content = message.optJSONObject("content") ?: return null
    return Clarification.fromJson(content.optJSONObject("clarification"))
}
