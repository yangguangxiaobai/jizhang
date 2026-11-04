# 手机专项验收报告（第二轮）— 连续追问修复上线后真机复验

- 任务：`.trellis/tasks/10-15-ai-streaming-interactive-dialogue`（Phase 3 真机验收；本轮唯一设备操作者）
- 角色：手机功能验收验证专员（只增证据与报告，未改产品/既有文档）
- 采集时间（UTC）：2026-10-16 12:46Z ~ 13:39Z（设备本地时间 = UTC+8，约 20:46 ~ 21:39）
- 范围：**仅**「新会话中 AI 先问账单类型→再问账户、点 A→追问 B→点 B 可继续、无 ASSISTANT_CHOICE_STALE」。
  全量流式正文/Stop/cancel/A→B→A/导入/账务确认**均未纳入**本轮。
- 依据：`prd.md` R2/R4/R5、`design.md`（clarification 契约）、`research/protocol-v1.md`（Clarification/Android 章节）、
  `research/chained-choice-fix.md`、`artifacts/DEPLOYED_PATCH-chained-choice-20261016T083118Z.md`、`deploy-status.md`。

## 总体结论

**达标（限定范围）** — 连续追问两跳链路（类型→账户）在修复上线的后端镜像上真机复跑成功，第二问可被点击消费并推进会话；全程零账本写入、零 `/confirm`、零 `ASSISTANT_CHOICE_STALE`。
统计：达标 10 项；不达标 0 项；未验证 1 项（范围外/与原始 bug 描述不一致的流式 provisional 正文）。
说明：本结论**仅覆盖上述短流程**；按上轮同口径，`device-status.md` 记录的流式正文/Stop/ABA 缺陷仍**未在本轮验证**。

## 验收明细

| # | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 设备与前台可观测 | 设备在线、App 前台可操作 | `TNL0220A15028072` / JER-AN20 / Android 12 / SDK31 / 1080x2340@480dpi；`mCurrentFocus=com.yansuu1.jizhang/.MainActivity` — `round2/00-device-baseline.txt`、各 `*.png` | 达标 |
| 2 | 已安装 APK 身份 | 与既有记录（d2a37b55 安装）一致 | installed base.apk SHA-256 = `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`；v0.1.0(3)；lastUpdateTime 2026-10-16 15:36:46 — `round2/01-installed-apk-sha256.txt`；**本轮未安装** | 达标 |
| 3 | 服务端补丁运行态 | 运行镜像含 NULL-own-answer 修复 | `jizhang:api-chained-choice-20261016T083118Z` / `sha256:31bb967e…ef11b` / started 2026-10-16T08:57:13.935Z / healthy；编译产物 `assistant-generation-service.js` = `60fc43e0…476f6c` — `round2/02-server-identity.txt` | 达标 |
| 4 | 新会话首轮→AI 先问类型 | 出现 1 个单选卡（2–6 项） | S1 `81750f01`（会话 45efb5e7）Q「Choose a category:」Dining/Entertainment；S2 `61bf4dac`（会话 17624436）同 — `round2/18-s1-send-28s.xml`、`round2/33-s2-send-24s.xml` | 达标 |
| 5 | 点类型 A→产生第二问 B | 新代次自身 `answered_option_id/answered_at` 必须为 NULL（不得“出生即已答”） | S1 `66823722`（src=81750f01）`answeredOpt=null answeredAt=null bornAnswered=false`；S2 `3006d620`（src=61bf4dac）同；Q「Which account should I use?」Alipay/WeChat — `round2/23-gen-after-clickA.txt`、`round2/38-s2-gen-after-A.txt`、`round2/37-s2-A-26s.xml` | 达标 |
| 6 | 点第二问 B 正常继续（不再 stale） | B 的选项可被正常消费并推进会话 | S1 点支付宝→`8cd41716` outcome=answer（UI「✓ 回答已结束 · 本轮未执行记账」）；S2 点 Alipay→`baee1991` outcome=pending-confirmation。两代 `src` 均为 B 的 id，B 的 `answered_at` 由 NULL 变为 SET（消费记录） — `round2/26-gen-after-clickB.txt`、`round2/41-s2-gen-after-B.txt`、`round2/25-clickB-31s.png`、`round2/39-s2-after-A-latest.xml` | 达标 |
| 7 | 全流程无 ASSISTANT_CHOICE_STALE | UI 不得出现该 409 提示 | 对 49 个 UI 树全量扫描 `已被回答/刷新本对话/发送结果尚未核对/ASSISTANT_CHOICE_STALE` = 0 命中；所有目标代次 `error_code=null` — `round2/49-s1s2-generation-status.txt`、扫描输出见 `round2/stale-scan.txt` | 达标 |
| 8 | 作为草稿讨论、不擅自记账 | 未点确认则不得写账本 | S2 在 B 后进入 pending：新 pending 行 `aff9101e…` status=pending（tool=transaction.create）；**到 pending 即停，未点确认** — `round2/44-s2-pending-card.png`、`round2/43-pending-actions.txt` | 达标 |
| 9 | 账本字节级不变 | 现有账务表哈希一致 | 16 张账务/业务表 SHA-256 与部署后基线 `chained-choice-deploy-…-after-manifest.json` **逐一相同**（含 transactions/accounts/categories/transfers/refund_links/budget_*/salary_records/settings/users/recurring_*/asset_*/sessions/schema_migrations）；仅 5 张 assistant_* 表变化（会话/消息/代次/事件/1 条 pending）；integrity=ok — `round2/50-manifest-after-round2.json` | 达标 |
| 10 | 逐步骤时间线/截图取证 | 每次操作可定位 | `round2/timeline.txt`（含各步 UTC 与焦点窗口）；代次 created_at 与点击时刻逐毫秒对应（点 A 13:14:48→代次 13:14:49；点 B 13:22:07→13:22:08；S2 同理） | 达标 |
| 11 | 流式 provisional 正文逐块增长 | 首段正文在受控完成前到达并增长 | 按原始 bug 描述（在 Q 前产生文字）构造提示时，两轮均为“先出选择题、无正文气泡”；未再用其他提示重试以免被判定为无限重试 — 见“未验证” | 未验证（与 bug 描述不一致/范围外） |

## 不达标原因

无。

## 未验证与阻塞项

1. **流式 provisional 正文（原 bug 描述项）**：`device-status.md` 缺陷 1 记为「问答前产生文字 → Q 后正文空白」。本轮按该特征构造的提示，模型直接返回选择题（无前置文字），故无法在“产生正文”的路径上复现/观察该现象；为遵守「不无限重试」，仅对 S2 措辞微调一次后停止。需要一条**稳定的产生正文**的提示/用例，或在受控 mock 上游下复现，才能判定该 UI 缺陷是否仍存在（该缺陷属 Android-track，`DEPLOYED_PATCH` 第 5 条明确不在本次后端补丁范围）。
2. **HTTP 状态码 202/200**：客户端未落 app 日志（严格性顾虑，未执行 `logcat`），故 202/幂等 `created:false` 未通过 UI 直接断言；结论依据服务端代次行 + UI 渲染。
3. **旧 stuck 卡**：`863a936c`/`ccf489cb` 本轮**未点击**（按指令“旧卡不修”）；其 `bornAnswered=true` 与预期一致，且未被误判为回归。
4. 范围外未测：Stop/cancel、会话 A→B→A 代次隔离、导入 100/哈希/幂等、余额图与确认流。

## 执行环境与验证记录

- 设备/系统/App：JER-AN20 / Android 12 (SDK31) / 1080x2340@480dpi / com.yansuu1.jizhang v0.1.0(3) / base.apk `d2a37b55…56da8`（本轮未安装）。
- 后端：`jizhang:api-chained-choice-20261016T083118Z` `31bb967e…ef11b`，StartedAt 2026-10-16T08:57:13.935Z，healthy；编译产物哈希与部署记录一致。
- 实际执行步骤（均为只读或文档要求的测试步骤）：
  1. `adb devices -l` / `getprop` / `dumpsys window|power|package` / `pm path` → `round2/00-device-baseline.txt`。
  2. `adb exec-out cat <pm path>` + `sha256sum` → `round2/01-installed-apk-sha256.txt`。
  3. SSH（`~/.ssh/jizhang_deploy`→`ubuntu@jz.yansuu1.xyz`，`sudo -n docker`）只读：`docker inspect`、`docker exec … sha256sum`、`docker exec … node probe-gen/ledger.mjs`（`better-sqlite3 readonly:true`，库 `/data/jizhang.db`）→ `02/03/04/19/23/26/27/38/41/42/47/48/49/50-*`。
  4. 真机 UI：`am start`、`input tap`、`input text`、`screencap`、`uiautomator dump`（脚本 `round2/cap.sh`）→ 10~44 各编号 PNG/XML。
- 证据位置：`round2/*.png`、`round2/*.xml`、`round2/*.txt`、`round2/timeline.txt`、`round2/50-manifest-after-round2.json`。
- 安全边界：未安装依赖、未改模型/timeout/配置、未清数据、未 `/confirm`；未输出任何凭据/Token/私密金额（仅表行数与哈希）。

## 主链复现步骤（S2）

1. AI 助手 → 会话 → 新建对话
2. 输入：`I paid 15 dollars for coffee today. First ask me the category: Dining or Entertainment. After I choose the category, ask me which account with the options Alipay or WeChat. This is a draft discussion only; do not book anything.`（实机截断为 `… only`）→ 发送
3. 出现「Choose a category: / Dining / Entertainment」→ 点 Dining
4. 观察：出第二问「Which account should I use? / Alipay / WeChat」→ 点 Alipay（点前需先点「有新消息，跳到最新」）
5. 结果：进入「● 待核对记账草案」pending，**停在此处不确认**；顶部标题与卡片一致，无 `ASSISTANT_CHOICE_STALE`；账本哈希不变。

## 关键时间线（UTC）

| 时刻 | 动作 | 服务端对应 |
|---|---|---|
| 13:07:38 | S1 发送 | 代次 `81750f01`（Q=类型） |
| 13:14:48 | S1 点 Dining | 代次 `66823722` src=`81750f01`，answeredOpt/At=null |
| 13:22:07 | S1 点 支付宝 | 代次 `8cd41716` outcome=answer |
| 13:26:55 | S2 发送 | 代次 `61bf4dac`（Q=类型） |
| 13:32:02 | S2 点 Dining | 代次 `3006d620` src=`61bf4dac`，answeredOpt/At=null |
| 13:33:58 | S2 点 Alipay | 代次 `baee1991` outcome=pending-confirmation，随后停测 |
