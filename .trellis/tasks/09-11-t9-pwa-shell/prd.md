# T9 PWA 外壳与移动端体验

> 父任务:`.trellis/tasks/09-11-web-pwa`
> 依赖:**T4**(需要有页面可缓存)。可与 T7/T8 并行。

## Goal

把 Web 应用包装成可"添加到主屏幕"的 PWA,做移动优先的布局与触摸体验,并实现断网可查看。

用户价值:用户主要在 iPhone 上用。没有这一步,它只是个网页;有了这一步,它像 App。

## Background

- **离线策略由父任务 D4 决定**:PWA 缓存外壳 + 离线可**查看**;**写入需联网**,不做离线写入队列
- 这是与参考项目最大的架构差异:参考项目是 local-first(SQLite + push/pull 同步);
  本项目不做同步队列,因此**没有 LWW 冲突解决**
- 图表与通知等能力差异见 `../09-11-web-pwa/research/reference-project-rules.md` §8

## Requirements

### R1 PWA manifest

- `name` / `short_name`(中文名,short_name ≤ 12 字符以完整显示)
- `start_url: '/'`、`display: 'standalone'`、`scope: '/'`
- `theme_color` 与 `background_color` 与 App 主题一致
- 图标:至少 192×192 与 512×512 PNG;**必须含 `apple-touch-icon` 180×180**
  (iOS 不使用 manifest 的 `icons`,只认 `<link rel="apple-touch-icon">`)
- `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style` 等 iOS meta 标签

### R2 Service Worker

- 用 `vite-plugin-pwa`(Workbox)
- **静态资源(带 hash 的 JS/CSS/图标/字体)**:Precache,`CacheFirst`
- **HTML 导航请求**:`NetworkFirst`,失败回落缓存的 `index.html`
- **API GET 请求**:`NetworkFirst`,失败回落缓存,并在 UI 给出"离线,数据可能不是最新"提示
- **API 写请求(非 GET)**:离线时**不发请求**,直接提示"需要联网才能记账"(D4)
- 更新策略:`autoUpdate`,新版本就绪时提示或自动刷新,避免用户长期停留在旧版本
- ⚠️ API 响应缓存必须与认证绑定:登出后不得命中上一个用户的缓存响应

### R3 移动优先布局

- 底部 tab 导航:首页概览 / 账单 / 预算 / 统计 / 我的(具体分组在实现时定稿)
- 安全区适配:`env(safe-area-inset-bottom)` 用于底部导航,`env(safe-area-inset-top)` 用于顶部;
  底部导航不被 iPhone home indicator 遮挡
- 所有可点元素触摸目标 **≥44×44 px**(父任务 R6)
- 视口:`viewport-fit=cover` + `user-scalable=no` 需谨慎(无障碍上不鼓励禁用缩放,
  但 PWA 场景下防双击缩放是常见做法;**需定案并在实现里说明理由**)
- 输入框字号 ≥16px,避免 iOS Safari 聚焦时自动放大页面
- 表单:金额输入使用 `inputmode="decimal"` 唤起数字键盘;日期使用原生日期控件

### R4 网络状态反馈

- 在线/离线状态可见(顶部条或图标)
- 离线时对写操作按钮给出禁用态与说明,而不是让用户点了才失败
- 请求失败时给出可重试的提示,不静默失败

### R5 首次启动与登录态

- 未登录访问任何页面 → 跳登录页
- 登录态持久(Cookie 有效期 30 天),重开 PWA 不需要重新登录
- "添加到主屏幕"的引导提示(仅在 iOS Safari 且未安装时显示)

### R6 测试

- Workbox 配置的单元/构建验证:构建产物含 `sw.js` 与 `manifest.webmanifest`
- 离线场景:模拟 network offline 后首页可渲染(可用集成测试或人工核对清单)
- 触摸目标尺寸检查(可通过 lint 规则或人工核对清单)

## Acceptance Criteria

- [ ] AC1 `pnpm --filter web run build` 产出 `sw.js` 与 `manifest.webmanifest`
- [ ] AC2 Lighthouse 的 PWA 检查项通过(可安装、有 manifest、有 SW、有图标)
- [ ] AC3 iPhone Safari 打开域名后可"添加到主屏幕",启动后**无地址栏**(standalone)
- [ ] AC4 主屏图标正确显示(iOS 上用的是 `apple-touch-icon`,不是白屏或截图)
- [ ] AC5 **断网后重新打开 PWA,首页与账单列表可渲染**(父任务 AC7)
- [ ] AC6 断网时点"记一笔"得到"需要联网"的明确提示,**不产生半提交数据**
- [ ] AC7 底部导航在 iPhone 上不被 home indicator 遮挡(安全区生效)
- [ ] AC8 所有主要可点元素 ≥44×44 px(逐项核对记录)
- [ ] AC9 聚焦金额输入框时页面**不**被 iOS 自动放大
- [ ] AC10 发新版本后,用户刷新能拿到新版本(不长期停留在旧缓存)
- [ ] AC11 登出后,离线缓存不返回上一个登录态的数据

## Out of Scope

- 离线**写入**与后台同步队列 → 父任务 D4 明确不做
- 本地通知/提醒 → 父任务 Out of Scope
- 离线本地数据库(IndexedDB 业务数据)→ 不做
- 原生 App 打包(Capacitor 等)→ 不做,用户要的是 PWA

## Technical Notes

- **iOS PWA 的限制需在实现时实测**:iOS 对 Service Worker 缓存与后台行为有额外约束;
  若发现某类资源无法缓存,记录下来写进 spec,不要假装支持
- API 缓存与认证绑定:Workbox 的 `NetworkFirst` 策略应配置为不缓存带 `Set-Cookie` 的响应,
  或按 `Cache-Control: no-store` 处理认证相关接口。**建议:认证接口与含敏感数据的接口
  一律不缓存,只缓存静态外壳 + 显式允许的只读列表接口**
- 参考项目有 `lib/features/app_lock/` 与 `notifications/`,Web 端**不移植**(能力不对应)
- 参考项目的 `core/app_theme.dart`(12.9KB)有完整主题定义,可作为配色参考,
  但 Flutter 与 CSS 的适配方式不同,不要逐行照搬
