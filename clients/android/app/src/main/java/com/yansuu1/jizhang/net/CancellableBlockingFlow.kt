package com.yansuu1.jizhang.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch

/**
 * The owner waits cancellably while a child performs blocking network reads. Cancelling
 * the owner calls cancelTransport before waiting for that child to finish. A completion
 * handler on the blocked child's Job would be too late to interrupt its read.
 */
internal fun <T> cancellableBlockingFlow(
    cancelTransport: () -> Unit,
    read: suspend (suspend (T) -> Unit) -> Unit,
): Flow<T> = channelFlow {
    val reader = launch(Dispatchers.IO) { read { send(it) } }
    try {
        reader.join()
    } finally {
        cancelTransport()
        reader.cancel()
    }
}
