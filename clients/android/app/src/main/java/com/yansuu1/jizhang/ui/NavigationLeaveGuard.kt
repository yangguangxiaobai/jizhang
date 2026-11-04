package com.yansuu1.jizhang.ui

typealias LeaveGuard = (onAllowLeave: () -> Unit) -> Unit

data class ActiveNavigationHandlers(
    val requestBack: () -> Unit,
    val requestLeave: LeaveGuard,
)

/**
 * 集中管理外层导航离开与系统返回拦截。
 * 契约：
 * 1. 只有当前活动层（活跃 owner）可以注册 handlers；失活或销毁时仅能注销属于自己的 ownerKey。
 * 2. 同一 owner 的未决离开请求只保留首次目标，杜绝并发弹窗或重复导航。
 * 3. 产生代次变更（如切换 owner）后，旧 owner 延迟触发的 onAllowLeave 必须被严格拒绝，不可导航到陈旧目标。
 */
internal class NavigationLeaveCoordinator {
    private var currentOwnerKey: String? = null
    private var activeHandlers: ActiveNavigationHandlers? = null
    private var pendingNavigationTarget: (() -> Unit)? = null
    private var pendingNavigationGeneration = 0L

    @Synchronized
    fun register(ownerKey: String, handlers: ActiveNavigationHandlers?) {
        if (handlers == null) {
            if (currentOwnerKey == ownerKey) {
                currentOwnerKey = null
                activeHandlers = null
                pendingNavigationTarget = null
                pendingNavigationGeneration++
            }
        } else {
            currentOwnerKey = ownerKey
            activeHandlers = handlers
            pendingNavigationTarget = null
            pendingNavigationGeneration++
        }
    }

    @Synchronized
    fun requestBack(fallback: () -> Unit) {
        val handlers = activeHandlers
        if (handlers != null) {
            handlers.requestBack()
        } else {
            fallback()
        }
    }

    @Synchronized
    fun requestLeave(onAllowLeave: () -> Unit) {
        val handlers = activeHandlers
        val ownerKey = currentOwnerKey
        if (handlers == null || ownerKey == null) {
            onAllowLeave()
            return
        }

        // 如果已有未决的离开目标，保留首次目标，防止重复提交
        if (pendingNavigationTarget != null) {
            return
        }

        val capturedGeneration = ++pendingNavigationGeneration
        pendingNavigationTarget = onAllowLeave

        handlers.requestLeave {
            var actionToRun: (() -> Unit)? = null
            synchronized(this) {
                if (currentOwnerKey == ownerKey && pendingNavigationGeneration == capturedGeneration) {
                    actionToRun = pendingNavigationTarget
                    pendingNavigationTarget = null
                }
            }
            actionToRun?.invoke()
        }
    }

    @Synchronized
    fun isRegistered(ownerKey: String): Boolean =
        currentOwnerKey == ownerKey && activeHandlers != null
}
