package com.yansuu1.jizhang.launcher

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Stable launcher icon identity. Alias names are part of the installed app's
 * public component surface: never rename them, or pinned launcher shortcuts
 * from older installations become dead links.
 */
object LauncherIcons {
    const val DEFAULT_ID = 6

    val IDS: List<Int> = listOf(1, 2, 3, 4, 5, 6)

    private const val ALIAS_PREFIX = "LauncherIcon"

    fun isValid(id: Int?): Boolean = id != null && id in IDS

    fun aliasSimpleName(id: Int): String = "$ALIAS_PREFIX$id"

    fun aliasName(packageName: String, id: Int): String = "$packageName.${aliasSimpleName(id)}"

    /** Accepts both fully-qualified and manifest-relative (".LauncherIcon1") names. */
    fun idOfAlias(packageName: String, alias: String): Int? {
        val fullName = if (alias.startsWith(".")) packageName + alias else alias
        val prefix = "$packageName."
        if (!fullName.startsWith(prefix)) return null
        val simpleName = fullName.removePrefix(prefix)
        if (!simpleName.startsWith(ALIAS_PREFIX)) return null
        return simpleName.removePrefix(ALIAS_PREFIX).toIntOrNull()?.takeIf { isValid(it) }
    }
}

data class LauncherComponentSetting(
    val aliasName: String,
    val enabled: Boolean,
)

/**
 * Thin, testable boundary over PackageManager. The production implementation
 * must only report components that currently answer MAIN/LAUNCHER for this
 * package, so callers never mistake a stale preference or a merely declared
 * alias for an active desktop entry.
 */
interface LauncherComponentStore {
    fun launchableAliases(): Set<String>

    fun setEnabled(aliasName: String, enabled: Boolean)

    /**
     * API 33+ batch component-state update. Return false when the platform or
     * implementation cannot batch; throw when an attempted batch failed.
     */
    fun setEnabledBatch(settings: List<LauncherComponentSetting>): Boolean
}

interface LauncherIconPreferenceStore {
    suspend fun readSelectedId(): Int?

    suspend fun writeSelectedId(id: Int)
}

/**
 * [activeId] is the single launcher entry the system currently reports. It is
 * null when there is no entry or when a failed cleanup left more than one entry;
 * the UI must not mark a preference as selected in either case.
 */
data class LauncherIconSnapshot(
    val activeId: Int?,
    val selectedId: Int,
    val launchableIds: Set<Int>,
    val persistedId: Int?,
    val warning: String? = null,
    val error: String? = null,
)

/**
 * Drives the six stable activity aliases. The target is always enabled and
 * read back before any other entry is disabled, so a failed switch never
 * removes the last launchable entry. The preference is only updated after the
 * component state has been confirmed.
 */
class LauncherIconController(
    private val packageName: String,
    private val componentStore: LauncherComponentStore,
    private val preferenceStore: LauncherIconPreferenceStore,
    private val apiLevel: Int,
) {
    private val mutex = Mutex()

    /** Reconciles the persisted preference with the real component state. */
    suspend fun load(): LauncherIconSnapshot = mutex.withLock {
        val persisted = readPersisted()
        val actualResult = queryLaunchable()
        if (actualResult.isFailure) {
            return@withLock unavailableSnapshot(persisted, actualResult.exceptionOrNull())
        }
        val actual = actualResult.getOrThrow()
        when {
            actual.size == 1 -> {
                val active = actual.single()
                val persistedResult = persist(active, persisted)
                val warning = buildList {
                    if (persisted != null && persisted != active) {
                        add("本地记录为第 $persisted 款，实际桌面入口是第 $active 款；已按实际入口同步。")
                    }
                    persistedResult.warning?.let(::add)
                }.joinToString(" ").ifBlank { null }
                LauncherIconSnapshot(
                    activeId = active,
                    selectedId = active,
                    launchableIds = actual,
                    persistedId = persistedResult.id,
                    warning = warning,
                )
            }
            actual.isEmpty() -> {
                val target = persisted ?: LauncherIcons.DEFAULT_ID
                switchLocked(
                    targetId = target,
                    persisted = persisted,
                    before = actual,
                    prefix = "未检测到可用的桌面入口，正尝试恢复第 $target 款。",
                )
            }
            else -> {
                val target = when {
                    persisted != null && persisted in actual -> persisted
                    LauncherIcons.DEFAULT_ID in actual -> LauncherIcons.DEFAULT_ID
                    else -> actual.min()
                }
                normalizeLocked(target, persisted, actual)
            }
        }
    }

    suspend fun select(id: Int): LauncherIconSnapshot = mutex.withLock {
        val persisted = readPersisted()
        if (!LauncherIcons.isValid(id)) {
            val actual = queryLaunchable().getOrDefault(emptySet())
            return@withLock LauncherIconSnapshot(
                activeId = actual.singleOrNull(),
                selectedId = persisted ?: LauncherIcons.DEFAULT_ID,
                launchableIds = actual,
                persistedId = persisted,
                error = "无效的图标编号。",
            )
        }
        val actualResult = queryLaunchable()
        if (actualResult.isFailure) {
            return@withLock unavailableSnapshot(persisted, actualResult.exceptionOrNull())
        }
        val actual = actualResult.getOrThrow()
        if (actual == setOf(id) && persisted == id) {
            return@withLock LauncherIconSnapshot(
                activeId = id,
                selectedId = id,
                launchableIds = actual,
                persistedId = persisted,
            )
        }
        switchLocked(id, persisted, actual)
    }

    suspend fun restoreDefault(): LauncherIconSnapshot = select(LauncherIcons.DEFAULT_ID)

    private suspend fun switchLocked(
        targetId: Int,
        persisted: Int?,
        before: Set<Int>,
        prefix: String? = null,
    ): LauncherIconSnapshot {
        val targetAlias = LauncherIcons.aliasName(packageName, targetId)
        var actual = before

        if (targetId !in actual) {
            val enableError = enableComponent(targetAlias)
            val afterEnable = queryLaunchable()
            if (enableError != null || afterEnable.isFailure || targetId !in afterEnable.getOrDefault(emptySet())) {
                val known = afterEnable.getOrDefault(actual)
                return failureWithRecovery(
                    targetId = targetId,
                    persisted = persisted,
                    actual = known,
                    message = "${prefix.orEmpty()}第 $targetId 款图标未能启用（${enableError ?: "系统未确认该入口"}）。",
                )
            }
            actual = afterEnable.getOrThrow()
        }

        val disableOutcome = disableOthers(targetId)
        actual = disableOutcome.actual
        if (targetId !in actual) {
            // The old entries are gone; make one more attempt to keep the app launchable.
            val retryError = enableComponent(targetAlias)
            val recheck = queryLaunchable()
            if (retryError != null || recheck.isFailure || targetId !in recheck.getOrDefault(emptySet())) {
                return failureWithRecovery(
                    targetId = targetId,
                    persisted = persisted,
                    actual = recheck.getOrDefault(actual),
                    message = "${prefix.orEmpty()}关闭旧入口后未能确认第 $targetId 款入口。",
                )
            }
            actual = recheck.getOrThrow()
        }

        val persistedResult = persist(targetId, persisted)
        val warnings = buildList {
            if (disableOutcome.remainingExtraIds.isNotEmpty()) {
                add(
                    "新图标已生效，但旧桌面入口未能全部关闭（第 " +
                        disableOutcome.remainingExtraIds.sorted().joinToString("、") +
                        " 款），桌面可能仍显示多个图标。",
                )
            }
            persistedResult.warning?.let(::add)
        }.joinToString(" ").ifBlank { null }
        return LauncherIconSnapshot(
            activeId = actual.singleOrNull(),
            selectedId = if (targetId in actual) targetId else (persisted ?: LauncherIcons.DEFAULT_ID),
            launchableIds = actual,
            persistedId = persistedResult.id,
            warning = warnings,
            error = if (actual.isEmpty()) "切换失败，当前没有可用的桌面入口。" else null,
        )
    }

    private suspend fun normalizeLocked(
        targetId: Int,
        persisted: Int?,
        before: Set<Int>,
    ): LauncherIconSnapshot {
        val outcome = disableOthers(targetId)
        val actual = outcome.actual
        if (targetId !in actual) {
            return failureWithRecovery(
                targetId = targetId,
                persisted = persisted,
                actual = actual,
                message = "检测到多个桌面入口，但无法保留第 $targetId 款。",
            )
        }
        val persistedResult = persist(targetId, persisted)
        val warnings = buildList {
            add("检测到多个桌面入口，已按第 $targetId 款归一。")
            if (outcome.remainingExtraIds.isNotEmpty()) {
                add(
                    "仍有旧入口未能关闭（第 " +
                        outcome.remainingExtraIds.sorted().joinToString("、") +
                        " 款），桌面可能显示多个图标。",
                )
            }
            persistedResult.warning?.let(::add)
        }.joinToString(" ")
        return LauncherIconSnapshot(
            activeId = actual.singleOrNull(),
            selectedId = targetId,
            launchableIds = actual,
            persistedId = persistedResult.id,
            warning = warnings,
        )
    }

    private fun disableOthers(targetId: Int): DisableOutcome {
        val others = LauncherIcons.IDS
            .filter { it != targetId }
            .map { it to LauncherIcons.aliasName(packageName, it) }

        var batchApplied = false
        if (apiLevel >= 33) {
            batchApplied = try {
                componentStore.setEnabledBatch(
                    others.map { (_, alias) -> LauncherComponentSetting(alias, enabled = false) },
                )
            } catch (_: Exception) {
                false
            }
        }
        if (!batchApplied) {
            for ((_, alias) in others) {
                try {
                    componentStore.setEnabled(alias, false)
                } catch (_: Exception) {
                    // Continue with the rest; the final read-back reports what remains.
                }
            }
        } else {
            // Some launchers/OEM PackageManagers may report stale entries after
            // the batch call; retry any remaining old alias individually.
            val remaining = queryLaunchable().getOrDefault(emptySet()).filter { it != targetId }
            for (id in remaining) {
                try {
                    componentStore.setEnabled(LauncherIcons.aliasName(packageName, id), false)
                } catch (_: Exception) {
                    // Reported below by the authoritative read-back.
                }
            }
        }
        val actual = queryLaunchable().getOrDefault(emptySet())
        return DisableOutcome(actual = actual, remainingExtraIds = actual - targetId)
    }

    private suspend fun failureWithRecovery(
        targetId: Int,
        persisted: Int?,
        actual: Set<Int>,
        message: String,
    ): LauncherIconSnapshot {
        if (actual.isNotEmpty()) {
            val current = actual.singleOrNull()
            val selected = current ?: persisted?.takeIf { it in actual } ?: actual.min()
            val suffix = current?.let { " 当前仍使用第 $it 款入口。" }
                ?: " 当前仍有多个桌面入口，请重试归一。"
            return LauncherIconSnapshot(
                activeId = current,
                selectedId = selected,
                launchableIds = actual,
                persistedId = persisted,
                error = message + suffix,
            )
        }

        val defaultId = LauncherIcons.DEFAULT_ID
        if (targetId != defaultId) {
            val enableError = enableComponent(LauncherIcons.aliasName(packageName, defaultId))
            val after = queryLaunchable()
            if (enableError == null && after.isSuccess && defaultId in after.getOrThrow()) {
                val known = after.getOrThrow()
                val persistedResult = persist(defaultId, persisted)
                return LauncherIconSnapshot(
                    activeId = defaultId,
                    selectedId = defaultId,
                    launchableIds = known,
                    persistedId = persistedResult.id,
                    warning = persistedResult.warning,
                    error = "$message 已恢复默认第 $defaultId 款入口。",
                )
            }
        }
        return LauncherIconSnapshot(
            activeId = null,
            selectedId = if (LauncherIcons.isValid(persisted)) persisted!! else targetId,
            launchableIds = emptySet(),
            persistedId = persisted,
            error = "$message 当前没有可用的桌面入口，请重试恢复默认图标或重新安装应用。",
        )
    }

    private fun enableComponent(aliasName: String): String? = try {
        componentStore.setEnabled(aliasName, true)
        null
    } catch (e: Exception) {
        e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName
    }

    private fun queryLaunchable(): Result<Set<Int>> = runCatching {
        componentStore.launchableAliases()
            .mapNotNull { LauncherIcons.idOfAlias(packageName, it) }
            .toSet()
    }

    private suspend fun readPersisted(): Int? = try {
        preferenceStore.readSelectedId()?.takeIf { LauncherIcons.isValid(it) }
    } catch (_: Exception) {
        null
    }

    private suspend fun persist(id: Int, current: Int?): PersistOutcome {
        if (current == id) return PersistOutcome(id, null)
        return try {
            preferenceStore.writeSelectedId(id)
            PersistOutcome(id, null)
        } catch (_: Exception) {
            PersistOutcome(
                id = current,
                warning = "图标已切换，但选择未能保存；下次打开设置会按实际桌面入口重新同步。",
            )
        }
    }

    private fun unavailableSnapshot(persisted: Int?, cause: Throwable?): LauncherIconSnapshot =
        LauncherIconSnapshot(
            activeId = null,
            selectedId = persisted ?: LauncherIcons.DEFAULT_ID,
            launchableIds = emptySet(),
            persistedId = persisted,
            error = "无法读取当前桌面图标状态：${cause?.message?.takeIf { it.isNotBlank() } ?: "请重试"}",
        )

    private data class DisableOutcome(
        val actual: Set<Int>,
        val remainingExtraIds: Set<Int>,
    )

    private data class PersistOutcome(
        val id: Int?,
        val warning: String?,
    )
}
