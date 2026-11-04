package com.yansuu1.jizhang.net

/**
 * Thread-safe manager for API request identity and session lifecycle generation.
 * Manages identity transitions and session mutations atomically under a single lock.
 *
 * Generation increases monotonically on logout, base URL change, or starting a new login.
 * A->B->A transitions produce distinct generations so delayed requests from an earlier
 * session never match the current identity.
 */
internal class ApiRequestOwner(initialBaseUrl: String) {
    private val lock = Any()
    private var currentBaseUrl: String = initialBaseUrl.trimEnd('/')
    private var currentGeneration: Long = 1L

    fun capture(): ApiRequestIdentity = synchronized(lock) {
        ApiRequestIdentity(currentBaseUrl, currentGeneration)
    }

    fun advance(baseUrl: String): ApiRequestIdentity = synchronized(lock) {
        currentBaseUrl = baseUrl.trimEnd('/')
        currentGeneration++
        ApiRequestIdentity(currentBaseUrl, currentGeneration)
    }

    fun isCurrent(identity: ApiRequestIdentity): Boolean = synchronized(lock) {
        identity.baseUrl == currentBaseUrl && identity.generation == currentGeneration
    }

    fun ifCurrent(identity: ApiRequestIdentity, action: () -> Unit): Boolean = synchronized(lock) {
        if (identity.baseUrl == currentBaseUrl && identity.generation == currentGeneration) {
            action()
            true
        } else {
            false
        }
    }
}
