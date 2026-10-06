package com.yansuu1.jizhang

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.ui.DonutChart
import com.yansuu1.jizhang.ui.MonthlyBars
import com.yansuu1.jizhang.ui.PoolSparkline
import com.yansuu1.jizhang.ui.barRatio
import com.yansuu1.jizhang.ui.budgetTone
import com.yansuu1.jizhang.ui.formatDay
import com.yansuu1.jizhang.ui.formatYuan
import com.yansuu1.jizhang.ui.theme.AccentPreset
import com.yansuu1.jizhang.ui.theme.JizhangTheme
import com.yansuu1.jizhang.ui.HeroCard
import com.yansuu1.jizhang.ui.JzCard
import com.yansuu1.jizhang.ui.JzGhostButton
import com.yansuu1.jizhang.ui.JzPrimaryButton
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import com.yansuu1.jizhang.ui.usedPercent
import org.json.JSONObject

/**
 * 离线预览入口（无需服务端）。所有数字为写死的演示数据，仅用于看界面排版；
 * 联调时走 MainActivity + 真实 ApiClient，本 Activity 不参与任何业务逻辑。
 * Manifest 中 exported=true，桌面可直启。
 */
class DemoActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 启动参数决定首屏 tab + 预设,方便一次性截图验看:
        // adb shell am start -n .../.DemoActivity --es tab budget --es accent forest
        val startTab = intent.getStringExtra("tab")?.let { name ->
            runCatching { DemoTab.valueOf(name) }.getOrNull()
        } ?: DemoTab.Dashboard
        val startAccent = intent.getStringExtra("accent")?.let { name ->
            runCatching { DemoAccent.valueOf(name) }.getOrNull()
        }?.toPreset() ?: AccentPreset.Titanium
        setContent {
            JizhangTheme(accent = startAccent) {
                DemoShell(startTab)
            }
        }
    }
}

/** Demo-only accent switch (maps to the real preset, no forked values). */
private enum class DemoAccent {
    Titanium,
    Forest,
    Mono,
    ;

    fun toPreset(): AccentPreset = when (this) {
        Titanium -> AccentPreset.Titanium
        Forest -> AccentPreset.Forest
        Mono -> AccentPreset.Mono
    }
}

private enum class DemoTab(val label: String, val icon: ImageVector) {
    Dashboard("首页", Icons.Filled.Home),
    Transactions("账单", Icons.Filled.Receipt),
    Budget("预算", Icons.Filled.Add),
    Assistant("AI 助理", Icons.Filled.SmartToy),
    Stats("统计", Icons.Filled.BarChart),
    Mine("我的", Icons.Filled.Person),
}
@Composable
private fun DemoShell(startTab: DemoTab = DemoTab.Dashboard) {
    var tab by remember(startTab) { mutableStateOf(startTab) }
    Scaffold(
        containerColor = LocalWebTokens.current.bg,
        bottomBar = {
            NavigationBar(
                containerColor = LocalWebTokens.current.surface,
            ) {
                for (t in DemoTab.entries) {
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
        Column(Modifier.fillMaxSize().padding(inner)) {
            when (tab) {
                DemoTab.Dashboard -> DemoDashboard()
                DemoTab.Transactions -> DemoTransactions()
                DemoTab.Budget -> DemoBudget()
                DemoTab.Assistant -> DemoAssistant()
                DemoTab.Stats -> DemoStats()
                DemoTab.Mine -> DemoMine()
            }
        }
    }
}

// ── 演示数据 ──

private fun demoTx(note: String, cat: String, cents: Long, type: Int, day: String): JSONObject =
    JSONObject()
        .put("id", note + cat + cents)
        .put("note", note)
        .put("categoryName", cat)
        .put("amountCents", cents)
        .put("type", type)
        .put("dateLabel", day)

@Composable
private fun DemoDashboard() {
    val recents = remember {
        listOf(
            demoTx("午餐", "餐饮", 3200, 0, "10月5日"),
            demoTx("地铁", "交通", 500, 0, "10月5日"),
            demoTx("退款-多扣", "购物", 20000, 1, "10月4日"),
        )
    }
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        HeroCard(Modifier.fillMaxWidth()) {
            Text("总余额 · 所有账户", color = LocalWebTokens.current.heroMuted)
            Text("12,456.78", style = MaterialTheme.typography.headlineMedium, color = LocalWebTokens.current.onHero)
        }
        Spacer(Modifier.height(8.dp))
        JzCard(Modifier.fillMaxWidth()) {
            Text("2 笔周期账单待确认 →", color = MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(8.dp))
        JzCard(Modifier.fillMaxWidth()) {
                Text("2026年10月概览", style = MaterialTheme.typography.titleMedium)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column {
                        Text("收入", style = MaterialTheme.typography.bodySmall)
                        Text("8,200.00")
                    }
                    Column {
                        Text("净支出", style = MaterialTheme.typography.bodySmall)
                        Text("1,237.00")
                    }
                    Column {
                        Text("结余", style = MaterialTheme.typography.bodySmall)
                        Text("6,963.00")
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text("预算剩余 6,763.00 · 已用 15%")
                Text("有 1 个模块接近上限", color = MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("最近账单", style = MaterialTheme.typography.titleMedium)
            JzGhostButton(text = "查看全部", onClick = { })
        }
        for (tx in recents) {
            val sign = if (tx.optInt("type") == 1) "+" else "-"
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(tx.optString("note"))
                    Text(
                        "${tx.optString("dateLabel")} · ${tx.optString("categoryName")}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Text("$sign${formatYuan(tx.optLong("amountCents"))}")
            }
        }
        Spacer(Modifier.height(8.dp))
        JzPrimaryButton(text = "记一笔", onClick = { })
    }
}

@Composable
private fun DemoTransactions() {
    val items = remember {
        listOf(
            demoTx("午餐", "餐饮", 3200, 0, "10月5日"),
            demoTx("地铁", "交通", 500, 0, "10月5日"),
            demoTx("日用品", "购物", 120000, 0, "10月4日"),
            demoTx("工资", "工资", 800000, 1, "10月1日"),
            demoTx("退款-多扣", "购物", 20000, 1, "10月3日"),
        )
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            OutlinedButton(onClick = {}) { Text("‹") }
            Text("2026年10月", style = MaterialTheme.typography.titleMedium)
            OutlinedButton(onClick = {}) { Text("›") }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {}) { Text("全部") }
            OutlinedButton(onClick = {}) { Text("支出") }
            OutlinedButton(onClick = {}) { Text("收入") }
        }
        Spacer(Modifier.height(8.dp))
        Button(onClick = {}, modifier = Modifier.fillMaxWidth()) { Text("记一笔") }
        Spacer(Modifier.height(8.dp))
        Text("共 5 笔", style = MaterialTheme.typography.bodySmall)
        LazyColumn(Modifier.fillMaxSize()) {
            items(items, key = { it.optString("id") }) { tx ->
                val sign = if (tx.optInt("type") == 1) "+" else "-"
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(tx.optString("note"))
                        Text(
                            "$sign${formatYuan(tx.optLong("amountCents"))}",
                            color = if (sign == "+") MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.error,
                        )
                    }
                    Text(
                        "${tx.optString("categoryName")} · 默认账户 · ${tx.optString("dateLabel")}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun DemoBudget() {
    val modules = remember {
        listOf(
            Triple("餐饮", 320000L, 3700L),
            Triple("交通", 80000L, 68000L),
            Triple("购物", 200000L, 230000L),
            Triple("住房", 200000L, 0L),
        )
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("预算", style = MaterialTheme.typography.titleLarge)
        Text("2 笔周期账单待确认", color = MaterialTheme.colorScheme.primary)
        Text("结余池：1,200.00", style = MaterialTheme.typography.titleMedium)
        Text("总预算 8,000.00 · 已用 1,237.00", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.fillMaxSize()) {
            items(modules, key = { it.first }) { (name, budget, spent) ->
                val remaining = budget - spent
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(name)
                        Text("${formatYuan(spent)} / ${formatYuan(budget)}")
                    }
                    LinearProgressIndicator(
                        progress = { barRatio(spent, budget) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "剩余 ${formatYuan(remaining)} · ${usedPercent(spent, budget)}%${budgetTone(spent, budget)}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun DemoAssistant() {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("AI 助理", style = MaterialTheme.typography.titleLarge)
        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Column(Modifier.padding(12.dp)) {
                Text("我", style = MaterialTheme.typography.bodySmall)
                Text("这个月餐饮花了多少？")
            }
        }
        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Column(Modifier.padding(12.dp)) {
                Text("AI", style = MaterialTheme.typography.bodySmall)
                Text("本月餐饮共支出 32.00 元，其中午餐 32.00 元。")
                Spacer(Modifier.height(4.dp))
                Text("待确认：记一笔 32.00 元到餐饮？", style = MaterialTheme.typography.bodySmall)
                Row {
                    Button(onClick = {}) { Text("确认") }
                    OutlinedButton(onClick = {}) { Text("取消") }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = {}) { Text("附件") }
            OutlinedButton(onClick = {}, modifier = Modifier.weight(1f)) { Text("输入消息…") }
            Button(onClick = {}) { Text("发送") }
        }
    }
}

@Composable
private fun DemoStats() {
    val slices = remember {
        listOf(
            JSONObject().put("categoryName", "餐饮").put("amountCents", 3200),
            JSONObject().put("categoryName", "交通").put("amountCents", 6800),
            JSONObject().put("categoryName", "购物").put("amountCents", 12000),
        )
    }
    val trend = remember {
        listOf("5月", "6月", "7月", "8月", "9月", "10月").mapIndexed { i, m ->
            JSONObject()
                .put("month", m)
                .put("incomeCents", 800000L)
                .put("netExpenseCents", (90000 + i * 8000).toLong())
        }
    }
    val pool = remember {
        listOf(80000L, 95000L, 110000L, 105000L, 120000L, 132000L).map {
            JSONObject().put("poolCents", it)
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Text("统计", style = MaterialTheme.typography.titleLarge)
        Row {
            OutlinedButton(onClick = {}) { Text("● 本月") }
            OutlinedButton(onClick = {}) { Text("近 30 天") }
            OutlinedButton(onClick = {}) { Text("近 3 个月") }
        }
        DonutChart(slices = slices, totalCents = 22000)
        MonthlyBars(points = trend)
        PoolSparkline(points = pool)
    }
}

@Composable
private fun DemoMine() {
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        Text("我的", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        for (label in listOf(
            "设置（外观/密码/周期起点）",
            "物品资产",
            "分类与账户",
            "分配模板",
            "周期账单规则",
            "转账",
            "回收站",
            "数据导出与备份",
        )) {
            OutlinedButton(onClick = {}, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Text(label)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("外观预览", style = MaterialTheme.typography.titleSmall)
        Row {
            OutlinedButton(onClick = {}) { Text("● 跟随系统") }
            OutlinedButton(onClick = {}) { Text("浅色") }
            OutlinedButton(onClick = {}) { Text("深色") }
        }
        Row {
            OutlinedButton(onClick = {}) { Text("● 钛蓝") }
            OutlinedButton(onClick = {}) { Text("森林绿") }
            OutlinedButton(onClick = {}) { Text("极简黑白") }
        }
        Spacer(Modifier.height(8.dp))
        Text("物品资产 · 在册购入总额 3,200.00 · 日均 2.50/天", style = MaterialTheme.typography.bodySmall)
        Text("使用中 3 · 闲置 1 · 退役 0", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(4.dp))
        Text("当前为离线预览，所有数字为演示数据", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = {}, modifier = Modifier.fillMaxWidth()) { Text("退出登录") }
    }
}

private fun formatDayUnused(ms: Long): String = formatDay(ms)
