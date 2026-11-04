package com.yansuu1.jizhang.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.ui.theme.LocalWebTokens

enum class FinancialHostTab(val label: String) {
    PLAN("本月计划"),
    EXECUTION("四用途执行"),
    BUDGET("分类信封预算"),
    SCENARIO("测算预估"),
}

/** Existing callers passed EXECUTION to open the old host; keep that source compatible. */
private fun FinancialHostTab.asInitialDestination(): FinancialHostTab = when (this) {
    FinancialHostTab.EXECUTION -> FinancialHostTab.PLAN
    else -> this
}

@Composable
fun FinancialHostScreen(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
    initialTab: FinancialHostTab = FinancialHostTab.EXECUTION,
    onNewSalary: () -> Unit = {},
    onTemplates: () -> Unit = {},
    refreshToken: Long = 0L,
    onDataChanged: () -> Unit = {},
    onRegisterNavigation: ((ActiveNavigationHandlers?) -> Unit)? = null,
) {
    var currentTab by rememberSaveable { mutableStateOf(initialTab.asInitialDestination()) }
    val tokens = LocalWebTokens.current

    // 子页面离开守卫注册表：每个 Tab 页面可注册自己的退出前检查函数 ((onAllowLeave: () -> Unit) -> Unit)
    var scenarioGuard by remember { mutableStateOf<(((() -> Unit) -> Unit))?>(null) }
    var executionGuard by remember { mutableStateOf<(((() -> Unit) -> Unit))?>(null) }
    var planGuard by remember { mutableStateOf<(((() -> Unit) -> Unit))?>(null) }

    fun checkCanLeaveCurrentTab(onAllowLeave: () -> Unit) {
        when (currentTab) {
            FinancialHostTab.SCENARIO -> {
                val guard = scenarioGuard
                if (guard != null) guard(onAllowLeave) else onAllowLeave()
            }
            FinancialHostTab.EXECUTION -> {
                val guard = executionGuard
                if (guard != null) guard(onAllowLeave) else onAllowLeave()
            }
            FinancialHostTab.PLAN -> {
                val guard = planGuard
                if (guard != null) guard(onAllowLeave) else onAllowLeave()
            }
            FinancialHostTab.BUDGET -> onAllowLeave()
        }
    }

    // 向外层导航注册当前活动守卫与返回处理器
    DisposableEffect(currentTab, scenarioGuard, executionGuard, planGuard) {
        onRegisterNavigation?.invoke(
            ActiveNavigationHandlers(
                requestBack = {
                    checkCanLeaveCurrentTab {
                        if (currentTab == FinancialHostTab.PLAN) onBack() else currentTab = FinancialHostTab.PLAN
                    }
                },
                requestLeave = { onAllow -> checkCanLeaveCurrentTab(onAllow) },
            )
        )
        onDispose { onRegisterNavigation?.invoke(null) }
    }

    // 从明细工具先回本月计划；仅在默认页退出宿主。执行/测算仍由各自脏草稿守卫保护。
    fun handleRequestBack() {
        checkCanLeaveCurrentTab {
            if (currentTab == FinancialHostTab.PLAN) onBack() else currentTab = FinancialHostTab.PLAN
        }
    }

    // 拦截系统返回键
    BackHandler(enabled = true) {
        handleRequestBack()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(tokens.bg),
    ) {
        // 统一顶部导航栏
        Surface(
            color = tokens.surface,
            modifier = Modifier.fillMaxWidth(),
            shadowElevation = 1.dp,
        ) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    IconButton(
                        onClick = { handleRequestBack() },
                        modifier = Modifier.height(48.dp),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = tokens.fg,
                        )
                    }
                    Text(
                        text = currentTab.label,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = tokens.fg,
                    )
                }

            }
        }

        // Retain stable compositions/drafts, but only place the active page. Invisible
        // full-size siblings still receive pointer hits; alpha is not input isolation.
        RetainedFinancialTabs(currentTab, Modifier.weight(1f)) {
            Box(Modifier.fillMaxSize()) {
                MonthlyPlanWorkspace(
                    api = api,
                    onAuthExpired = onAuthExpired,
                    onNewSalary = onNewSalary,
                    onOpenExecution = {
                        checkCanLeaveCurrentTab { currentTab = FinancialHostTab.EXECUTION }
                    },
                    onOpenBudget = {
                        checkCanLeaveCurrentTab { currentTab = FinancialHostTab.BUDGET }
                    },
                    onOpenScenario = {
                        checkCanLeaveCurrentTab { currentTab = FinancialHostTab.SCENARIO }
                    },
                    onDataChanged = onDataChanged,
                    refreshToken = refreshToken,
                    onRegisterGuard = { guard -> planGuard = guard },
                )
            }
            Box(Modifier.fillMaxSize()) {
                FinancialExecutionWorkspace(
                    api = api,
                    onAuthExpired = onAuthExpired,
                    onRegisterGuard = { guard -> executionGuard = guard },
                    onDataChanged = onDataChanged,
                )
            }
            Box(Modifier.fillMaxSize()) {
                BudgetTab(
                    api = api,
                    onAuthExpired = onAuthExpired,
                    onNewSalary = onNewSalary,
                    onOpenFinancialPlan = {
                        checkCanLeaveCurrentTab { currentTab = FinancialHostTab.SCENARIO }
                    },
                    onTemplates = onTemplates,
                    onBack = { handleRequestBack() },
                    showHeader = false,
                )
            }
            Box(Modifier.fillMaxSize()) {
                FinancialPlanScreen(
                    api = api,
                    onAuthExpired = onAuthExpired,
                    onBack = { handleRequestBack() },
                    showHeader = false,
                    active = currentTab == FinancialHostTab.SCENARIO,
                    onRegisterGuard = { guard -> scenarioGuard = guard },
                )
            }
        }
    }
}

/** Composition order is fixed to FinancialHostTab.entries; hidden pages are not placed. */
internal fun financialTabPlacementIndex(tab: FinancialHostTab, childCount: Int): Int {
    require(childCount == FinancialHostTab.entries.size) { "Each financial tab needs one stable content slot" }
    return tab.ordinal
}

@Composable
private fun RetainedFinancialTabs(
    activeTab: FinancialHostTab,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Layout(content = content, modifier = modifier.fillMaxSize()) { measurables, constraints ->
        val activeIndex = financialTabPlacementIndex(activeTab, measurables.size)
        val placeables = measurables.map { it.measure(constraints) }
        layout(constraints.maxWidth, constraints.maxHeight) {
            // Unplaced children stay composed but are excluded from pointer hit testing,
            // drawing, and the accessibility tree. No event-consuming overlay is needed.
            placeables[activeIndex].placeRelative(0, 0)
        }
    }
}
