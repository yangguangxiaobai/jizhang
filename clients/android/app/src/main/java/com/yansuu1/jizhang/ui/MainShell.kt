package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.repo.AuthRepository
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import com.yansuu1.jizhang.ui.theme.ThemePreference

/**
 * Authenticated shell (A2). Mirrors web `AppShell.vue` bottom tabs + `router/index.ts`:
 * six tabs in order 首页 / 账单 / 预算 / AI 助理 / 统计 / 我的.
 *
 * NOTE: Web's 4th tab is the record-entry action ("记一笔"); the Android shell keeps
 * the six-tab order with AI 助理 fourth (matching AppShell navItems) and exposes
 * record-entry as the primary action inside 首页/账单. The tab ORDER contract that
 * matters — dashboard first, settings last — is preserved.
 */
enum class Tab(val label: String, val icon: ImageVector) {
    Dashboard("首页", Icons.Filled.Home),
    Transactions("账单", Icons.Filled.Receipt),
    Budget("预算", Icons.Filled.Add),
    Assistant("AI 助理", Icons.Filled.SmartToy),
    Stats("统计", Icons.Filled.BarChart),
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
    onLogout: () -> Unit,
    onAuthExpired: () -> Unit = onLogout,
) {
    var tab by remember { mutableStateOf(Tab.Dashboard) }
    var editingTx by remember { mutableStateOf<String?>(null) }
    var creatingTx by remember { mutableStateOf(false) }
    var creatingSalary by remember { mutableStateOf(false) }
    var showingPending by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = LocalWebTokens.current.bg,
        bottomBar = {
            NavigationBar(
                containerColor = LocalWebTokens.current.surface,
            ) {
                for (t in Tab.entries) {
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = { tab = t },
                        icon = { Icon(t.icon, contentDescription = t.label) },
                        label = { Text(t.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = LocalWebTokens.current.accent,
                            selectedTextColor = LocalWebTokens.current.accent,
                            indicatorColor = LocalWebTokens.current.accentSubtle,
                        ),
                    )
                }
            }
        },
    ) { inner ->
        Column(
            modifier = Modifier.fillMaxSize().padding(inner),
        ) {
            when (tab) {
                Tab.Dashboard -> if (showingPending) {
                    PendingTab(api = api, onAuthExpired = onAuthExpired)
                } else {
                    DashboardTab(
                        api = api,
                        onAuthExpired = onAuthExpired,
                        onSeeAllTransactions = { tab = Tab.Transactions },
                        onNewTransaction = { creatingTx = true; tab = Tab.Transactions },
                        onPending = { showingPending = true },
                    )
                }
                Tab.Transactions -> if (creatingTx || editingTx != null) {
                    TransactionEditSheet(
                        api = api,
                        editId = editingTx,
                        onAuthExpired = onAuthExpired,
                        onSaved = {
                            creatingTx = false
                            editingTx = null
                            tab = Tab.Transactions
                        },
                        onClose = {
                            creatingTx = false
                            editingTx = null
                        },
                    )
                } else {
                    TransactionsTab(
                        api = api,
                        onAuthExpired = onAuthExpired,
                        onNew = { creatingTx = true },
                        onEdit = { editingTx = it },
                    )
                }
                Tab.Budget -> if (creatingSalary) {
                    SalarySheet(
                        api = api,
                        onAuthExpired = onAuthExpired,
                        onSaved = { creatingSalary = false },
                        onClose = { creatingSalary = false },
                    )
                } else {
                    BudgetTab(
                        api = api,
                        onAuthExpired = onAuthExpired,
                        onNewSalary = { creatingSalary = true },
                    )
                }
                Tab.Assistant -> AssistantTab(api = api, onAuthExpired = onAuthExpired)
                Tab.Stats -> StatsTab(api = api, onAuthExpired = onAuthExpired)
                Tab.Settings -> MyTab(
                    api = api,
                    auth = auth,
                    theme = theme,
                    accent = accent,
                    onTheme = onTheme,
                    onAccent = onAccent,
                    onAuthExpired = onAuthExpired,
                    onLoggedOut = onLogout,
                )
            }
        }
    }
}

@Composable
private fun PlaceholderPage(text: String) {
    Column(modifier = Modifier.fillMaxSize().padding()) {
        Text(text)
    }
}
