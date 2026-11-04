package com.yansuu1.jizhang.launcher

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeLauncherComponentStore(
    initialAliases: Set<String> = emptySet(),
    private val canBatch: Boolean = false,
    private val failOnAlias: String? = null,
) : LauncherComponentStore {
    val enabledAliases = initialAliases.toMutableSet()
    val operations = mutableListOf<String>()

    override fun launchableAliases(): Set<String> = enabledAliases.toSet()

    override fun setEnabled(aliasName: String, enabled: Boolean) {
        if (aliasName == failOnAlias) {
            throw IllegalStateException("Simulated component store failure on $aliasName")
        }
        operations.add("${if (enabled) "ENABLE" else "DISABLE"}:$aliasName")
        if (enabled) {
            enabledAliases.add(aliasName)
        } else {
            enabledAliases.remove(aliasName)
        }
    }

    override fun setEnabledBatch(settings: List<LauncherComponentSetting>): Boolean {
        if (!canBatch) return false
        for (s in settings) {
            if (s.aliasName == failOnAlias) {
                throw IllegalStateException("Simulated batch failure on ${s.aliasName}")
            }
        }
        for (s in settings) {
            operations.add("BATCH_${if (s.enabled) "ENABLE" else "DISABLE"}:${s.aliasName}")
            if (s.enabled) {
                enabledAliases.add(s.aliasName)
            } else {
                enabledAliases.remove(s.aliasName)
            }
        }
        return true
    }
}

class FakeLauncherIconPreferenceStore(
    var storedId: Int? = null,
) : LauncherIconPreferenceStore {
    override suspend fun readSelectedId(): Int? = storedId

    override suspend fun writeSelectedId(id: Int) {
        storedId = id
    }
}

class LauncherIconControllerTest {
    private val packageName = "com.yansuu1.jizhang"

    @Test
    fun launcherIconsHelperIdentity() {
        assertEquals(6, LauncherIcons.DEFAULT_ID)
        assertTrue(LauncherIcons.isValid(1))
        assertTrue(LauncherIcons.isValid(6))
        assertFalse(LauncherIcons.isValid(0))
        assertFalse(LauncherIcons.isValid(7))
        assertFalse(LauncherIcons.isValid(null))

        assertEquals("LauncherIcon6", LauncherIcons.aliasSimpleName(6))
        assertEquals("com.yansuu1.jizhang.LauncherIcon6", LauncherIcons.aliasName(packageName, 6))

        assertEquals(1, LauncherIcons.idOfAlias(packageName, "com.yansuu1.jizhang.LauncherIcon1"))
        assertEquals(6, LauncherIcons.idOfAlias(packageName, ".LauncherIcon6"))
        assertNull(LauncherIcons.idOfAlias(packageName, "com.yansuu1.jizhang.MainActivity"))
        assertNull(LauncherIcons.idOfAlias(packageName, "com.other.LauncherIcon1"))
    }

    @Test
    fun loadInitialInstallReconcilesToDefault() = runBlocking {
        val initialAlias = LauncherIcons.aliasName(packageName, 6)
        val store = FakeLauncherComponentStore(initialAliases = setOf(initialAlias))
        val pref = FakeLauncherIconPreferenceStore(storedId = null)

        val controller = LauncherIconController(packageName, store, pref, apiLevel = 26)
        val snapshot = controller.load()

        assertEquals(6, snapshot.activeId)
        assertEquals(6, snapshot.selectedId)
        assertEquals(6, snapshot.persistedId)
        assertEquals(6, pref.storedId)
        assertNull(snapshot.error)
    }

    @Test
    fun selectSwitchesTargetBeforeDisablingPrevious() = runBlocking {
        val alias6 = LauncherIcons.aliasName(packageName, 6)
        val alias2 = LauncherIcons.aliasName(packageName, 2)
        val store = FakeLauncherComponentStore(initialAliases = setOf(alias6), canBatch = false)
        val pref = FakeLauncherIconPreferenceStore(storedId = 6)

        val controller = LauncherIconController(packageName, store, pref, apiLevel = 26)
        val snapshot = controller.select(2)

        assertEquals(2, snapshot.activeId)
        assertEquals(2, snapshot.selectedId)
        assertEquals(2, pref.storedId)
        assertEquals(setOf(alias2), store.enabledAliases)

        // Target must be enabled before previous is disabled:
        val enableIdx = store.operations.indexOf("ENABLE:$alias2")
        val disableIdx = store.operations.indexOf("DISABLE:$alias6")
        assertTrue("Target must be enabled before disabling previous", enableIdx != -1 && disableIdx != -1 && enableIdx < disableIdx)
    }

    @Test
    fun selectFailureLeavesLaunchableEntry() = runBlocking {
        val alias6 = LauncherIcons.aliasName(packageName, 6)
        val alias3 = LauncherIcons.aliasName(packageName, 3)
        // Store will fail when trying to enable alias 3
        val store = FakeLauncherComponentStore(initialAliases = setOf(alias6), failOnAlias = alias3)
        val pref = FakeLauncherIconPreferenceStore(storedId = 6)

        val controller = LauncherIconController(packageName, store, pref, apiLevel = 26)
        val snapshot = controller.select(3)

        assertNotNull(snapshot.error)
        assertTrue("Previous alias must remain enabled on failure", store.enabledAliases.contains(alias6))
        assertFalse("Failed target alias must not remain", store.enabledAliases.contains(alias3))
    }

    @Test
    fun selectSameIdIsNoOp() = runBlocking {
        val alias6 = LauncherIcons.aliasName(packageName, 6)
        val store = FakeLauncherComponentStore(initialAliases = setOf(alias6))
        val pref = FakeLauncherIconPreferenceStore(storedId = 6)

        val controller = LauncherIconController(packageName, store, pref, apiLevel = 26)
        val snapshot = controller.select(6)

        assertEquals(6, snapshot.activeId)
        assertEquals(0, store.operations.size)
    }

    @Test
    fun invalidIdRejected() = runBlocking {
        val alias6 = LauncherIcons.aliasName(packageName, 6)
        val store = FakeLauncherComponentStore(initialAliases = setOf(alias6))
        val pref = FakeLauncherIconPreferenceStore(storedId = 6)

        val controller = LauncherIconController(packageName, store, pref, apiLevel = 26)
        val snapshot = controller.select(99)

        assertNotNull(snapshot.error)
        assertEquals(6, snapshot.activeId)
        assertEquals(0, store.operations.size)
    }

    @Test
    fun loadWhenNoEntryRecoversTarget() = runBlocking {
        val store = FakeLauncherComponentStore(initialAliases = emptySet())
        val pref = FakeLauncherIconPreferenceStore(storedId = 4)

        val controller = LauncherIconController(packageName, store, pref, apiLevel = 26)
        val snapshot = controller.load()

        assertEquals(4, snapshot.activeId)
        assertTrue(store.enabledAliases.contains(LauncherIcons.aliasName(packageName, 4)))
    }
}
