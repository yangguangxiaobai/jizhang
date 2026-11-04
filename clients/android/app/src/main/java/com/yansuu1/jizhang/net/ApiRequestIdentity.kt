package com.yansuu1.jizhang.net

/**
 * Request identity snapshot for network isolation and session lifecycle verification.
 * Does not contain cookies, credentials, or sensitive tokens.
 */
internal data class ApiRequestIdentity(
    val baseUrl: String,
    val generation: Long,
)
