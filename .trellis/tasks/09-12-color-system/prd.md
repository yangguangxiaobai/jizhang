# UI 色彩系统 — 需求

> 父任务 `09-11-roadmap-2`。第二阶段之后的体验层工作，与 `09-11-motion-system` 同一层。
> 规范落在 `.trellis/spec/frontend/color-guidelines.md`。

## Goal

把颜色从"一组变量"变成一个**可验证的系统**：

1. **补全语义功能色阶梯** — 现在只有 `--accent / --ok / --danger` 三个实色，且只有 accent 有 `--on-accent`。
   缺 `warning` 这一档（"接近上限"无处可表达，离线横幅用的是 danger），也没有任何 `subtle`（淡底）
   一档，所以每个提示块都只能"白底 + 彩色边框 + 彩色字"。
2. **主色风格预设** — 钛蓝（默认）/ 森林绿 / 极简黑白，可切换、可持久化、首屏不闪。
3. **升级分类图表色板** — 参考项目沿用下来的 12 个分类色全部是低饱和的中灰棕（餐饮 `#b8786f`、
   交通 `#8a7764`、住房 `#b0835e`、购物 `#aa7e82`、娱乐 `#8d7890`、其他 `#847d74`），在环形图里
   几乎分不开；且没有深色变体。
4. **信封预算预警色** — 进度条只有"accent / 超支变红"两态，80%–100% 这一段没有任何提示。
5. **对比度与自动化测试全绿** — 所有文本对 ≥ 4.5:1（AA），非文本 ≥ 3:1；由构建期静态审计 +
   真实浏览器实测共同���证。

## Background

### 仓库现状（已核对）

| 事实 | 位置 |
|---|---|
| 令牌只有 `--bg/--surface/--border/--text/--fg/--muted/--accent/--on-accent/--danger/--ok`，且 `--text` 定义了但无人引用 | `styles/main.css` |
| 浅色/深色各写了两遍（`:root` + `[data-theme]`），靠人肉保持同步 | 同上 |
| `--accent: #2563eb`，但图标、manifest、`theme-color` 三处都是 `#2f6f8f`（"钛蓝"）——CSS 漂移了 | `generate-icons.mjs:27`、`vite.config.ts:53-54`、`index.html:15` |
| manifest `background_color: #f7f5f1` 与 `--bg: #f6f7f9` 不一致，注释却写着 "must match" | `vite.config.ts:52` |
| 多处 `var(--ok, #3f9e6a)` 字面量回退，令牌已存在后成了死代码 | `BarChart.vue`、`OfflineBanner.vue`、`SettingsView.vue`、`SalaryEntryView.vue`、`TransactionsView.vue` |
| 离线横幅用 `--on-accent` 压在 `--danger` 上——碰巧能读，因为四个色相的明暗极性相同 | `OfflineBanner.vue:49-50` |
| 分类颜色以 ARGB 整数存库；重新播种 `ON CONFLICT DO NOTHING`，老库不会自动换色 | `seed-data.ts`、`server/src/db/seed.ts` |
| 环形图用 `:fill="arc.color"` 属性——SVG 表现属性不支持 `var()`，改用令牌必须走 `style` | `DonutChart.vue:114` |
| `render-theme.mjs` 实测对比度但阈值是 3:1 | `scripts/render-theme.mjs:290` |

### 必须遵守的既有硬约定

- 客户端只渲染不计算；金额整数分；所有可点元素 ≥ 44px；输入 ≥ 16px。
- 组件里不写死颜色；分类颜色来自数据库是唯一例外。
- 每个令牌都必须有使用者（与动效令牌同一标准，`check-motion.mjs` 已对动效强制）。
- 不能只靠颜色传达状态。
- 不给主题切换加过渡（`motion-guidelines.md` R6）。

## Requirements

### R1 语义色阶梯

- 四个色相 `accent / ok / warning / danger`，每个有 **实色** `--X` 与 **淡底** `--X-subtle`；
  文字压在实色上的地方另有 `--on-X`（`accent`、`ok`、`warning` 有使用者；`danger` 没有——
  破坏性按钮按既有设计是描边而非实底，所以**不定义** `--on-danger`，需要时与其使用者一起加）。
- 中性色 `--bg / --surface / --border / --fg / --muted`；删除无人引用的 `--text`。
- 所有实色作为**文字**压在 `--surface` 与 `--bg` 上 ≥ 4.5:1；`--X` 压在 `--X-subtle` 上 ≥ 4.5:1；
  `--on-X` 压在 `--X` 上 ≥ 4.5:1；进度条填充对轨道 ≥ 3:1。
- 提示块统一为全局 `.notice` + `.notice-{accent|ok|warning|danger}`：淡底 + 4px 左边线 + 同色文字。
  使用者：预算页历史周期提示（accent）、数据页导入结果（ok）、预算页与首页"接近上限"（warning）、
  预算页与首页"超支"（danger）。
- 离线横幅改用 `warning`（组件自己的注释说"离线是常态而非错误"）；恢复连接用 `ok` + `--on-ok`。

### R2 主色预设

- `data-accent` 属性：缺省 = 钛蓝（`#2f6f8f`，与图标一致）；`forest` = 森林绿；`mono` = 极简黑白。
- 预设只覆盖 accent 这一档三个令牌（浅色/深色各一套）；中性色与 ok/warning/danger 不随预设变。
- 持久化在 `localStorage['jizhang.accent']`；`theme-init.js` 在首屏前应用，避免闪烁；
  设置页「外观」下新增三段式「主色」控件。
- 极简黑白：浅色下 accent = `--fg`，深色下 accent = 浅色前景；所有既有 `--accent` 使用者
  （按钮、活动 tab、焦点环、进度条、柱状图、折线）无需改动即成黑白。

### R3 分类图表色板

- 12 个固定色相槽 `--cat-1..12`，浅色/深色各一套值；顺序固定，按 dataviz 方法（OKLCH 明度带、
  彩度下限、相邻对 CVD ΔE、正常视觉 ΔE、对表面对比度）**由脚本验证**，不靠肉眼。
- 数据库仍存 ARGB 整数（浅色值）。渲染时若整数命中调色板某槽，输出 `var(--cat-N)`，深色自动
  换用深色变体；自定义/未知整数原样输出 hex（既有例外保留）。
- **老库不迁移**：参考项目的 12 个旧整数按槽位映射到新槽，旧数据自动升级；重新播种不覆盖用户改色。
- 种子数据改为新调色板的整数；`ManageView` 的取色器从共享模块读取，色块用令牌渲染并给出**颜色名**
  作为 `aria-label`。
- 环形图 `fill` 改走 `style`（表现属性不支持 `var()`）。

### R4 信封预算预警

- 三档：`< 80%` accent、`80%–100%` warning、`> 100%` danger。阈值是**呈现常量**，放在
  `utils/budget-tone.ts`，预算页与首页共用。
- 不能只靠颜色：档位同时以文字出现（"接近上限" / "已超支"），首页的提示句也覆盖"接近上限"。
- store 新增 `nearLimitModules`，与既有 `overBudgetModules` 同一口径来源（都读服务端模块视图，
  不重算金额）。

### R5 与外壳一致

- manifest `background_color` = 浅色 `--bg`；manifest `theme_color` 与 `<meta theme-color>` =
  `--surface`（状态栏紧贴 `.topbar`，而 `.topbar` 是 `--surface`；深色下 accent 是浅蓝，压在深色
  栏上更糟）；`useTheme` 在切换主题/预设后同步 meta。
- 图标的 ACCENT 常量 = 钛蓝浅色 accent（现值 `#2f6f8f` 已一致，无需重新生成）。

### R6 验证

- `scripts/check-color.mjs` 进 `pnpm build`：
  1. 组件 `<style>` 内无颜色字面量；
  2. 每个 `var(--x)` 颜色令牌都有定义、每个定义都有引用；
  3. `:root` 与 `[data-theme='light']`、媒体深色与 `[data-theme='dark']`、预设的两份深色块**逐字相同**；
  4. 每个主题块定义同一组令牌；
  5. 每个 主题 × 预设 组合的对比度矩阵（文字 4.5、非文字 3）；
  6. 分类色板通过 dataviz 六检（每种主题）；
  7. manifest / meta / 图标常量 / `theme-init.js` 的键名与预设名 与 CSS/TS 一致。
- `scripts/render-color.mjs`（复用 `lib/browser.mjs`）：
  通过设置页切换预设、断言属性/持久化/首屏应用；每个 预设 × 主题 在真实页面测文字与按钮对比度
  （4.5:1）；统计页切片的**计算后** fill 等于当前主题的令牌值且明暗不同；预算页 80%–100% 的模块
  填充色 = `--warning` 且出现"接近上限"文字，超支模块 = `--danger`；`theme-color` meta 跟随主题。
- `e2e-pwa.mjs` 的 `theme_color` 断言改为新值。
- lint / typecheck / 单测 / 构建期审计 / 既有浏览器套件全绿。

## Acceptance Criteria

- [x] AC1 `main.css` 定义完整阶梯，`check-color.mjs` 的对比度矩阵在 2 主题 × 3 预设 下全部通过
      — 48 条断言全 PASS；最差对为浅色/钛蓝 `--warning` on `--warning-subtle` **4.61:1**
      （文字线 4.5），深色最差 `--danger` on `--danger-subtle` **5.27:1**
- [x] AC2 设置页可在 钛蓝 / 森林绿 / 极简黑白 间切换；刷新后保持；`data-accent` 在 bundle 运行前已应用
      — `render-color.mjs` 实测：切换后属性变化、`localStorage['jizhang.accent']` 持久化、刷新后 `data-accent` 已存在
- [x] AC3 三个预设在浅色与深色下，真实页面文字与按钮文字对比度均 ≥ 4.5:1（浏览器实测）
- [x] AC4a 分类色板 12 槽在浅色与深色下通过 dataviz 六检（明度带、彩度下限、色盲相邻 ΔE、
      正常视觉相邻 ΔE、对表面对比度、样式表与共享列表逐槽一致）
- [ ] **AC4b 默认 6 个支出分类两两可辨 —— 未达成。** 审计只强制**相邻槽**分离（通过：浅色最差
      `--cat-5↔--cat-6` deutan ΔE 10.29），而 6 个种子支出分类的**两两**最差值为：
      浅色 **交通(橙) ↔ 购物(黄) deutan ΔE 2.09**、深色 **住房(青) ↔ 娱乐(粉) deutan ΔE 1.56**，
      远低于 6 的阈值。审计把它作为 `note` 报告而非失败，所以构建不会拦住它。
      **待决策**：重调色板（会改变用户已熟悉的分类颜色）还是接受"靠图例文字区分"并改写本 AC。
- [x] AC5 老库的参考色整数在不迁移的情况下渲染为新色板；自定义颜色原样保留
      — `LEGACY_CATEGORY_PALETTE` 按槽位映射；单测覆盖；自定义色实测 `#336699` 原样输出
- [x] AC6 预算页与首页对 80%–100% 的模块显示 warning 色与"接近上限"文字；> 100% 显示 danger 与"已超支"
      — `render-color.mjs` 实测填充色等于 `--warning` / `--danger` 且文字同时出现；
      另修掉零预算模块谎报"已用 100%"（现为"未分配预算"）
- [x] AC7 manifest / meta / 图标 / theme-init 与 CSS 令牌一致，由静态审计强制
- [x] AC8 lint、typecheck、单测、构建期四项审计、既有浏览器套件与容器 e2e 全绿
      — 单测 461、容器 e2e 498、浏览器 7 套件 338、静态断言 100

> 交付提交：`9bc5a42`（该提交已单独验证：仅凭它自己的文件集，lint 与四项构建期审计同样通过）。
> 唯一未决项是 **AC4b**，属于产品取舍，需要用户决定。

## Out of Scope

- 用户自定义任意主色（只做三个预设）
- 分类颜色迁移脚本（渲染层映射已覆盖）
- 高对比度模式 / `forced-colors`
- 给主题或预设切换加过渡（motion-guidelines R6 明确拒绝）

## Technical Notes

- 预设选择器用 `:root[data-accent='x']`（0,2,0）盖过 `:root` / `[data-theme='light']`（0,1,0），
  深色预设用 `:root:not([data-theme='light'])[data-accent='x']` 与 `:root[data-theme='dark'][data-accent='x']`
  （0,3,0）盖过两条深色规则（0,2,0 / 0,1,0）；因此**次序无关，特异性决定**。
- 颜色数学（WCAG 亮度、OKLab、Machado 2009 色觉模拟）放在 `scripts/lib/color.mjs`，静态审计与
  浏览器套件共用，不引��依赖。
