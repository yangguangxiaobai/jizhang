package com.yansuu1.jizhang.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.key
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.repo.AuthRepository
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import com.yansuu1.jizhang.ui.theme.ThemePreference

/**
 * Authenticated shell: 4 primary destinations + center record action (4+1):
 * 首页 / 账单 / ＋(记一笔) / 计划 / 我的.
 * 预算与统计作为首页二级页；AI 助手从“我的 → 更多工具”进入，是带来源页的二级页。
 */
enum class Tab(val label: String, val icon: ImageVector) {
    Dashboard("首页", Icons.Filled.Home),
    Transactions("账单", Icons.Filled.Receipt),
    Plan("计划", Icons.Filled.AccountBalanceWallet),
    Settings("我的", Icons.Filled.Person),
}

@Composable
fun MainShell(
    api: ApiClient,
    auth: AuthRepository? = null,
    theme: ThemePreference = ThemePreference.System,
    accent: AccentPreset = AccentPreset.Titanium,
    onTheme: (ThemePreference) -> Unit = {},
    onAccent: (AccentPreset) -> Unit = {},
    reduceMotion: Boolean = false,
    onReduceMotion: (Boolean) -> Unit = {},
    onLogout: () -> Unit,
    onAuthExpired: () -> Unit = onLogout,
) {
    var tab by remember { mutableStateOf(Tab.Dashboard) }
    // 计划是底部一级页面，但用独立开关记录“计划页是否打开”，这样离开计划页时能回到
    // 打开它之前的那一页（默认首页），也不会留下一个空白的计划壳。
    var showingFinancialHost by remember { mutableStateOf(false) }
    var initialFinancialHostTab by remember { mutableStateOf(FinancialHostTab.EXECUTION) }
    var editingTx by remember { mutableStateOf<String?>(null) }
    var viewingTx by remember { mutableStateOf<String?>(null) }
    var detailSource by remember { mutableStateOf(Tab.Dashboard) }
    // If edit/refund starts inside a detail overlay, return to that same detail after close.
    var editorReturnToDetailId by remember { mutableStateOf<String?>(null) }
    var creatingTx by remember { mutableStateOf(false) }
    var refundOriginalId by remember { mutableStateOf<String?>(null) }
    var ledgerRefreshToken by remember { mutableStateOf(0L) }
    var creatingSalary by remember { mutableStateOf(false) }
    // From the income editor, open SalarySheet as a top Dialog and keep that income draft composed.
    var showingSalaryFromEditor by remember { mutableStateOf(false) }
    var showingTemplateRepairFromSalary by remember { mutableStateOf(false) }
    var salaryTemplateRefreshToken by remember { mutableStateOf(0) }
    var showingPending by remember { mutableStateOf(false) }
    var showingStats by remember { mutableStateOf(false) }
    // AI 助手二级页：记录来源页（来源路由），返回时回到来源页；底栏由 hideBottomBar 隐藏。
    var showingAssistant by remember { mutableStateOf(false) }
    var assistantSource by remember { mutableStateOf(Tab.Settings) }
    var showingAssistantSubpage by remember { mutableStateOf(false) }
    var showingMySubpage by remember { mutableStateOf(false) }
    var openMySection by remember { mutableStateOf<String?>(null) }

    // 计划页与 tab 是互斥的：计划打开时不改动 tab，返回即恢复来源页。
    val destination: Tab = if (showingFinancialHost) Tab.Plan else tab
    val leaveCoordinator = remember { NavigationLeaveCoordinator() }

    fun selectTab(next: Tab) {
        if (destination == next) return
        leaveCoordinator.requestLeave {
            showingPending = false
            showingStats = false
            openMySection = null
            showingMySubpage = false
            if (next == Tab.Plan) {
                showingFinancialHost = true
            } else {
                showingFinancialHost = false
                tab = next
            }
        }
    }

    fun openRecord(from: Tab) {
        tab = from
        creatingTx = true
        editingTx = null
        refundOriginalId = null
        editorReturnToDetailId = null
        viewingTx = null
    }
    fun openDetail(from: Tab, id: String) {
        detailSource = from
        viewingTx = id
    }
    fun openEdit(from: Tab, id: String) {
        editorReturnToDetailId = id.takeIf { viewingTx == it }
        tab = from
        editingTx = id
        viewingTx = null
        creatingTx = false
        refundOriginalId = null
    }
    fun closeEditor(saved: Boolean) {
        val returnToDetailId = editorReturnToDetailId
        editorReturnToDetailId = null
        creatingTx = false
        editingTx = null
        refundOriginalId = null
        if (saved) ledgerRefreshToken++
        viewingTx = returnToDetailId
    }
    fun openAssistant(source: Tab) {
        assistantSource = source
        showingAssistant = true
        showingAssistantSubpage = false
    }
    fun closeAssistant() {
        showingAssistant = false
        showingAssistantSubpage = false
        showingFinancialHost = false
        tab = assistantSource
    }

    // 返回优先级：AI 助手二级页 → 计划页 → 工资/待确认/统计/我的二级页 → 非首页回首页。
    // AI 助手自己的二级页（会话管理、整理工作区等）由 AssistantTab 内部 BackHandler 处理，
    // 因此这里在它打开期间让出返回键，避免外层先关掉整个助手页。
    val backHandled = showingTemplateRepairFromSalary || showingSalaryFromEditor || showingAssistant || showingFinancialHost || creatingSalary ||
        showingPending || showingStats || showingMySubpage || tab != Tab.Dashboard
    BackHandler(enabled = backHandled && !(showingAssistant && showingAssistantSubpage)) {
        leaveCoordinator.requestBack {
            when {
                showingTemplateRepairFromSalary -> {
                    showingTemplateRepairFromSalary = false
                    salaryTemplateRefreshToken++
                }
                showingSalaryFromEditor -> showingSalaryFromEditor = false
                creatingSalary -> creatingSalary = false
                showingAssistant -> closeAssistant()
                showingFinancialHost -> showingFinancialHost = false
                showingPending -> showingPending = false
                showingStats -> showingStats = false
                tab != Tab.Dashboard -> tab = Tab.Dashboard
            }
        }
    }

    // Overlays must not change the source viewport or dispose its remembered state.
    // 计划页是底部一级页面，底栏保持可见；只有覆盖页和二级页隐藏底栏。
    val hideBottomBar = creatingSalary || showingSalaryFromEditor || showingPending || showingStats ||
        showingMySubpage || showingAssistant
    Scaffold(
        containerColor = LocalWebTokens.current.bg,
        bottomBar = {
            if (!hideBottomBar) {
                Surface(
                    color = Color.White,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column {
                        HorizontalDivider(
                            color = Color(0xFFE7E4DC),
                            thickness = 1.dp,
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(56.dp)
                                .padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // 1. 首页
                            NavigationBarTabItem(
                                selected = destination == Tab.Dashboard,
                                label = Tab.Dashboard.label,
                                icon = Tab.Dashboard.icon,
                                modifier = Modifier.weight(1f),
                                onClick = { selectTab(Tab.Dashboard) },
                            )

                            // 2. 账单
                            NavigationBarTabItem(
                                selected = destination == Tab.Transactions,
                                label = Tab.Transactions.label,
                                icon = Tab.Transactions.icon,
                                modifier = Modifier.weight(1f),
                                onClick = { selectTab(Tab.Transactions) },
                            )

                            // 3. 中间突出的加号「记一笔」按钮 (非持久Tab)
                            Box(
                                modifier = Modifier.weight(1f),
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(46.dp)
                                        .clip(CircleShape)
                                        .background(LocalWebTokens.current.accent)
                                        .clickable { openRecord(tab) },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        imageVector = Icons.Filled.Add,
                                        contentDescription = "记一笔",
                                        tint = Color.White,
                                        modifier = Modifier.size(24.dp),
                                    )
                                }
                            }

                            // 4. 计划（四用途执行 / 预算 / 测算宿主）
                            NavigationBarTabItem(
                                selected = destination == Tab.Plan,
                                label = Tab.Plan.label,
                                icon = Tab.Plan.icon,
                                modifier = Modifier.weight(1f),
                                onClick = { selectTab(Tab.Plan) },
                            )

                            // 5. 我的
                            NavigationBarTabItem(
                                selected = destination == Tab.Settings,
                                label = Tab.Settings.label,
                                icon = Tab.Settings.icon,
                                modifier = Modifier.weight(1f),
                                onClick = { selectTab(Tab.Settings) },
                            )
                        }
                    }
                }
            }
        },
    ) { inner ->
        Column(
            modifier = Modifier.fillMaxSize().padding(inner),
        ) {
            if (showingAssistant) {
                AssistantDestination(
                    api = api,
                    onAuthExpired = onAuthExpired,
                    onDataChanged = { ledgerRefreshToken++ },
                    sourceLabel = assistantSource.label,
                    onBack = { closeAssistant() },
                    onSecondaryScreen = { showingAssistantSubpage = it },
                    onProviderSettings = {
                        closeAssistant()
                        openMySection = "provider"
                    },
                    onRegisterNavigation = { handlers -> leaveCoordinator.register("assistant_tab", handlers) },
                )
            } else {
                when (destination) {
                    Tab.Dashboard -> when {
                        showingPending -> PendingTab(
                            api = api,
                            onAuthExpired = onAuthExpired,
                            showPageHeader = true,
                            onBack = { showingPending = false },
                        )
                        showingStats -> StatsTab(
                            api = api,
                            onAuthExpired = onAuthExpired,
                            onBack = { showingStats = false },
                            refreshToken = ledgerRefreshToken,
                        )
                        else -> DashboardTab(
                            api = api,
                            onAuthExpired = onAuthExpired,
                            onSeeAllTransactions = { selectTab(Tab.Transactions) },
                            onOpenTransaction = { openDetail(Tab.Dashboard, it) },
                            onPending = { showingPending = true },
                            onOpenPlan = {
                                // 兼容旧的 EXECUTION initialTab，但 C2 宿主会映射到月计划摘要默认页。
                                initialFinancialHostTab = FinancialHostTab.EXECUTION
                                selectTab(Tab.Plan)
                            },
                            onOpenStats = { showingStats = true },
                            refreshToken = ledgerRefreshToken,
                        )
                    }
                    Tab.Transactions -> TransactionsTab(
                        api = api,
                        onAuthExpired = onAuthExpired,
                        onNew = { openRecord(Tab.Transactions) },
                        onEdit = { openEdit(Tab.Transactions, it) },
                        onOpen = { openDetail(Tab.Transactions, it) },
                        refreshToken = ledgerRefreshToken,
                    )
                    Tab.Plan -> if (creatingSalary) {
                        SalarySheet(
                            api = api,
                            onAuthExpired = onAuthExpired,
                            onSaved = { ledgerRefreshToken++ },
                            onPlanConfirmed = { ledgerRefreshToken++ },
                            onClose = { creatingSalary = false },
                            onRepairTemplates = { showingTemplateRepairFromSalary = true },
                            templateRefreshToken = salaryTemplateRefreshToken,
                            backEnabled = !showingTemplateRepairFromSalary,
                        )
                    } else {
                        FinancialHostScreen(
                            api = api,
                            onAuthExpired = onAuthExpired,
                            initialTab = initialFinancialHostTab,
                            onNewSalary = { creatingSalary = true },
                            onTemplates = {
                                openMySection = "templates"
                                showingFinancialHost = false
                                tab = Tab.Settings
                            },
                            onBack = { showingFinancialHost = false },
                            refreshToken = ledgerRefreshToken,
                            onDataChanged = { ledgerRefreshToken++ },
                            onRegisterNavigation = { handlers -> leaveCoordinator.register("financial_host", handlers) },
                        )
                    }
                    Tab.Settings -> MyTab(
                        api = api,
                        auth = auth,
                        theme = theme,
                        accent = accent,
                        onTheme = onTheme,
                        onAccent = onAccent,
                        reduceMotion = reduceMotion,
                        onReduceMotion = onReduceMotion,
                        onAuthExpired = onAuthExpired,
                        onLoggedOut = onLogout,
                        initialSection = openMySection,
                        onOpenAssistant = { openAssistant(Tab.Settings) },
                        onSubpageChange = {
                            showingMySubpage = it
                            if (!it) openMySection = null
                        },
                        refreshToken = ledgerRefreshToken,
                        onDataChanged = { ledgerRefreshToken++ },
                        onRegisterNavigation = { handlers -> leaveCoordinator.register("my_tab", handlers) },
                    )
                }
            }
        }
    }

    viewingTx?.let { id ->
        key(id) {
            TransactionDetailScreen(
                api = api,
                transactionId = id,
                onAuthExpired = onAuthExpired,
                onBack = { viewingTx = null },
                onEdit = { openEdit(detailSource, id) },
                onRefund = {
                    refundOriginalId = id
                    editorReturnToDetailId = id
                    editingTx = null
                    viewingTx = null
                    creatingTx = true
                },
                onDeleted = {
                    viewingTx = null
                    ledgerRefreshToken++
                },
            )
        }
    }
    if (creatingTx || editingTx != null) {
        // A separate full-window dialog retains the source composition and routes
        // system back through the editor's own unsaved-draft confirmation.
        Dialog(
            onDismissRequest = {},
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
            ),
        ) {
            Surface(modifier = Modifier.fillMaxSize(), color = LocalWebTokens.current.bg) {
                key(editingTx, refundOriginalId) {
                    TransactionEditSheet(
                        api = api,
                        editId = editingTx,
                        refundOriginalId = refundOriginalId,
                        onAuthExpired = onAuthExpired,
                        onSaved = { closeEditor(saved = true) },
                        onClose = { closeEditor(saved = false) },
                        onOpenSalary = { showingSalaryFromEditor = true },
                        backEnabled = !showingSalaryFromEditor,
                    )
                }
            }
        }
    }
    if (showingSalaryFromEditor) {
        // Render after the editor Dialog so the existing income draft stays composed underneath.
        Dialog(
            onDismissRequest = {},
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
            ),
        ) {
            Surface(modifier = Modifier.fillMaxSize(), color = LocalWebTokens.current.bg) {
                SalarySheet(
                    api = api,
                    onAuthExpired = onAuthExpired,
                    onSaved = { ledgerRefreshToken++ },
                    onPlanConfirmed = { ledgerRefreshToken++ },
                    onClose = { showingSalaryFromEditor = false },
                    onRepairTemplates = { showingTemplateRepairFromSalary = true },
                    templateRefreshToken = salaryTemplateRefreshToken,
                    backEnabled = !showingTemplateRepairFromSalary,
                )
            }
        }
    }
    if (showingTemplateRepairFromSalary) {
        fun closeTemplateRepair() {
            showingTemplateRepairFromSalary = false
            salaryTemplateRefreshToken++
        }
        Dialog(
            onDismissRequest = { closeTemplateRepair() },
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
            ),
        ) {
            Surface(modifier = Modifier.fillMaxSize(), color = LocalWebTokens.current.bg) {
                Column(Modifier.fillMaxSize()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        IconButton(onClick = { closeTemplateRepair() }, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回工资表单")
                        }
                        Text("修复分配模板", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                    HorizontalDivider(color = Color(0xFFE7E4DC), thickness = 1.dp)
                    TemplatesTab(api = api, onAuthExpired = onAuthExpired)
                }
            }
        }
    }
}

/**
 * AI 助手二级页：自带返回入口（返回记录的来源页），二级子页由 AssistantTab 自己处理返回。
 * 聊天内容、附件与未发送草稿仍由 AssistantTab 持有，这里只负责壳层导航。
 */
@Composable
private fun AssistantDestination(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onDataChanged: () -> Unit,
    sourceLabel: String,
    onBack: () -> Unit,
    onSecondaryScreen: (Boolean) -> Unit,
    onProviderSettings: () -> Unit,
    onRegisterNavigation: ((ActiveNavigationHandlers?) -> Unit)? = null,
) {
    Column(Modifier.fillMaxSize().background(LocalWebTokens.current.bg)) {
        Row(
            modifier = Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "返回$sourceLabel",
                    tint = LocalWebTokens.current.fg,
                    modifier = Modifier.size(20.dp),
                )
            }
            Text(
                text = "返回$sourceLabel",
                fontSize = 13.sp,
                color = LocalWebTokens.current.muted,
            )
        }
        HorizontalDivider(color = Color(0xFFE7E4DC), thickness = 1.dp)
        Box(Modifier.fillMaxSize()) {
            AssistantTab(
                api = api,
                onAuthExpired = onAuthExpired,
                onDataChanged = onDataChanged,
                onSecondaryScreen = onSecondaryScreen,
                onProviderSettings = onProviderSettings,
                onRegisterNavigation = onRegisterNavigation,
            )
        }
    }
}

@Composable
private fun NavigationBarTabItem(
    selected: Boolean,
    label: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(width = 40.dp, height = 26.dp)
                .background(
                    if (selected) Color(0xFFE7F0F4) else Color.Transparent,
                    RoundedCornerShape(10.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = if (selected) Color(0xFF2F6F8F) else Color(0xFF88939A),
                modifier = Modifier.size(19.dp),
            )
        }
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            fontSize = 10.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            color = if (selected) Color(0xFF2F6F8F) else Color(0xFF88939A),
        )
    }
}
