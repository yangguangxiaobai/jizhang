# 手机端专项验收报告 — 连续追问（chained clarification）补丁上线后真机复验

- 任务：`.trellis/tasks/10-15-ai-streaming-interactive-dialogue`（Phase 3 真机验收，只读/不改产品代码）
- 角色：手机验收专员（本轮唯一设备操作者）
- 采集时间（UTC）：2026-10-16 09:07Z ~ 09:56Z
- 范围：**仅**「连续追问不再卡」（短流程）。10 项长测、全量流式/Stop/ABA 未纳入本轮。

## 1. 环境与版本（实测，非推断）

| 项 | 值 | 证据 |
|---|---|---|
| 设备 | TNL0220A15028072 / JER-AN20 / Android 12 / SDK 31 / 1080x2340 @480dpi | `adb devices -l`, `getprop` |
| 前台 Activity | `com.yansuu1.jizhang/.MainActivity` | `dumpsys window` |
| App | v0.1.0 (versionCode 3)，lastUpdateTime 2026-10-16 15:36:46 | `dumpsys package` |
| 已装 base.apk SHA-256 | `d2a37b550f…56da8`（与本机 debug 构建字节一致） | `adb exec-out cat $(pm path)` + `sha256sum` |
| 安装动作 | **本轮未安装**（哈希已一致，无必要） | 同上 |
| 后端镜像 | `jizhang:api-chained-choice-20261016T083118Z` / `sha256:31bb967e…ef11b` / StartedAt `2026-10-16T08:57:13.935Z` / healthy | `12-server-identity.txt` |
| 后端编译产物 | `dist/services/assistant-generation-service.js` = `60fc43e0…476f6c`（与部署记录期望一致） | `12-server-identity.txt` |
| 安全边界 | 仅 `sudo -n docker inspect` 与只读 `node better-sqlite3 readonly:true`；无凭据输出、无写库、无生产变更 | 各 probe 脚本 |

## 2. 逐项结果

| # | 验收项 | 预期 | 实际与证据 | 结论 |
|---|---|---|---|---|
| 1 | 服务端补丁运行态 | 运行镜像含 NULL-own-answer 修复 | image/tag/id/编译哈希全部匹配部署记录 | 达标 |
| 2 | 新会话首轮 → question A | 出现单选卡（2–6 项） | Session1 四选项账户卡；Session2/3/4 两选项分类卡 | 达标 |
| 3 | 点 A → 生成下一代 B/第二问 | 第二代 `answered_at/answered_option_id` 必须为 NULL（不得「出生即已答」） | Session2 `985cda96`：question B「Which account did you use for the coffee?」，`answered=null/answeredAt=null/bornAnswered=false`；Session3 `503fecd5`、Session4 `1b4a6eeb` 同 | 达标 |
| 4 | 点 B 仍能正常继续（不再 stale） | 第二代选项/文本可被正常消费，会话推进 | Session3/4：点击第二问 Dining → 生成 `1b4a6eeb`（outcome=answer，assistant「Got it—the $15 coffee expense is categorized as Dining. I won’t book anything.」） | 达标 |
| 5 | 另一流程 B 处自由文字发送 | 能成功发送并继续，不得 409 stale | Session2 在 question B 待选时发送自由文本 → 生成 `5a175b78`（outcome=answer，input type=text，B 行保持不变），UI「✓ 回答已结束 · 本轮未执行记账」 | 达标 |
| 6 | 账本零变动 | 全程不产生账务写入、不触 confirm | transactions 59、accounts 4、categories 13、pending_actions 10 前后一致；integrity=ok；无 pending 草稿产生 | 达标 |
| 7 | 旧卡不回修、不应误判回归 | 不点击旧 stuck 卡 | `863a936c`/`ccf489cb` 未被点击，仍为 bornAnswered=SET | 达标（未误判；其 stale 行为未复测，见未验证） |
| 8 | 全量流式正文增长 / Stop / ABA 代次隔离 | — | 本轮明确不扩测 | 未验证（本轮范围外） |

统计：达标 7 项；不达标 0 项；未验证 1 项（本轮范围外）。

## 3. 关键时间线（UTC）

- 09:21:24 新会话1 发送；09:21:24.531 生成 `121e1111`（question A，4 选项）
- 09:24:44 点击「微信」→ 09:23:18.449 A 行记录消费；09:23:18.450 生成 `66297b1f`（outcome=answer，**非出生即已答**）
- 09:41:31 新会话2 发送 → 09:41:31.939 生成 `58bea9ec`（question A）
- 09:44:18 点击「Dining」→ 生成 `985cda96`（question B，answered=null）
- 09:46:07 自由文本发送 → 生成 `5a175b78`（answer）
- 09:48:44 会话2 再发 → 生成 `b25882f4`（question C）
- 09:53:11 点击「Dining」→ 生成 `503fecd5`（B2 问，answered=null）
- 09:54:58 再发 → 生成 `04071cab`（question D）
- 09:55:51 点击「Dining」→ 生成 `1b4a6eeb`（answer）✅ 连续追问链路在两代之后仍可推进

## 4. 不达标原因

无。

## 5. 未验证与阻塞项

- **全量流式正文逐块增长 / Stop 按钮 / 服务端 cancel / 会话 A→B→A 代次隔离**：按本轮指令未扩展。
- 每张截图均为单次 `screencap`，无连续录屏，**不能**证明两帧之间的字符级增长。
- 点击的 HTTP 状态码无法从客户端日志读取，结论依据服务端 generation 行与 UI 渲染；协议指定的 409 错误码**未通过 UI 断言**（本流程服务端语义正常）。
- 「相同请求重放幂等（created:false）」未通过 UI 触发；仅有部署期容器内语义探针 PASS。
- 旧卡 `863a936c`/`ccf489cb` 的 stale 行为本轮未点击复测。

## 6. 复现步骤（Session2 主链）

1. AI 助手 → 会话 → 新建对话
2. 输入 `I spent 15 dollars on coffee, please ask me whether it belongs to Dining or Entertainment with clarification options` → 发送
3. 出现单选卡「Which category should I use? / Dining / Entertainment」→ 点 Dining
4. 观察：出现第二问「Which account did you use for the coffee?」，且该题仍可作答（点选项或发自由文本）
5. 结果：会话正常推进到 `outcome=answer`，顶部徽章「回答已结束」，无 `ASSISTANT_CHOICE_STALE`

## 7. 证据索引

- 截图：`00/01/03/05/07/08/09-*/10/11-*/24-*/25-*/27-*/31-*/32-*/33/36-*/37-*/38-*.png`
- UI 树：`pv_ui_*.xml`
- 服务端：`12-server-identity.txt`、`13/14`(基线)、`19-all-generations.txt`、`26/28/32/39`(各轮 generation)、`30/34`(会话消息)、`29/35/40`(账本)
- 结构化：`evidence.json`；时间戳：`99-timestamps.txt`
