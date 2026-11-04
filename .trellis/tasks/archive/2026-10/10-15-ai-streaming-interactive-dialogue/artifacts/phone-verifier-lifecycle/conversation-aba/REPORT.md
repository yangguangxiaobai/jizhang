# 手机功能验收结果（真正会话跨会话切换 A->B->A 专项）

## 总体结论
**有限达标（部分特性未验证，模型代次失败）** — 在真机（HUAWEI JER-AN20 / Android 12）与在线生产环境上，通过“会话管理”（非底部 Tab 切换）准备了两个真实的独立会话 Conversation A（`d76d9014-a6c8-4e61-a83c-5286d30e63e1`）与 Conversation B（`5d65dbf9-6626-4b82-8d07-665761efe093`）；在会话 A 中发送 1 条只读 150 词预算建议请求；尝试在生成进行中切换到会话 B 并返回会话 A。  
核验结果与关键纠正：
1. **会话 A 代次实际为 `failed`（INVALID_ENVELOPE / 219 字符）**：代次 `3da7ef99-f728-40cd-ac6d-cb8824bf7d2b` 产出 10 条 text-delta（累计 219 字符）后，因 `INVALID_ENVELOPE`（错误码 `ASSISTANT_STREAM_BOUNDS`，非 4000 字符长度超限，详见 `research/aba-provider-failure.md`）进入 `failed` 终态，未产出最终消息；
2. **服务端 Terminal 早于切入会话 B，离开不中断特性未在该时序下得到充分验证**：服务端代次 terminal 发生于 +6.344s，早于客户端切入会话 B 的时间点（+7.533s）；因此“离开会话 A 期间服务端 generation 是否继续执行不中断”在该轮次未被严格验证；
3. **会话 B 完全隔离，零污染**：在会话 B 界面及服务端数据库中，未出现任何会话 A 的用户 prompt、流式正文、卡片或代次（B 消息数=0，代次数=0）；
4. **返回会话 A 未创建第二代次，单代次对齐**：切回 A 时客户端对齐同一代次，数据库全局总代次数由基线 28 增至 29（增量严格为 1，无任何二次 POST `/generations`）；
5. **会话 A 历史与 Partial 零重复、无双泡**：切回 A 后，用户提问仅显示 1 次，无重复气泡；
6. **财务账本计数保持**：`transactions` 保持 59、`transfers` 保持 2、`assistant_pending_actions` 保持 11。  
统计：达标 4 项（B 隔离、单代次不新建、无双泡、账本计数不变）；不达标 1 项（模型代次 `failed`）；未验证 2 项（离开不中断因 terminal 早于切 B 未充分验证、账本计数不变未能证明全量 hash 不变）。

## 验收明细

| 编号 | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 前置环境与已安装版本校验 | 设备在线且前台可操作；已安装 APK 保持为 `d2a37b55`；后端运行含 `31bb967e` 镜像 | 设备 `TNL0220A15028072` (JER-AN20 / Android 12) 在线并在前台；已装 APK SHA-256 为 `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`；后端镜像 SHA-256 为 `sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b` — 证据：`01-device-identity.txt`、`02-installed-apk-sha256.txt`、`03-server-identity.txt`、`04-ledger-baseline.json` | 达标 |
| 2 | 会话管理建立独立会话 A 与 B（区分 Tab 与真实 ConversationId） | 必须经由“会话管理”页面新建两个独立会话，记录服务端权威 UUID，严禁用底部 Tab 切换替代 | 通过会话管理创建并记录两个真实 UUID：<br>• 会话 A：`d76d9014-a6c8-4e61-a83c-5286d30e63e1`<br>• 会话 B：`5d65dbf9-6626-4b82-8d07-665761efe093`<br>两会话均通过服务端 `/api/v1/assistant/conversations` 持久化，非底部 Tab 视图切换 — 证据：`01-create-conv-B.png`、`02-conv-list-after-B.png`、`03-create-conv-A.png`、`03-create-conv-A.xml`、`04-conversation-ids.json` | 达标 |
| 3 | 会话 A 发送只读预算请求并挂载流式气泡 | 会话 A 中发送 1 条只读约 150 词预算建议请求，首字等待与生成阶段正确渲染 Provisional 气泡 | 输入内容：`UI TEST: Please provide 3 practical budgeting tips for young professionals in 150 words. Reading advice only, do not book transactions.`；发送后 +1.0s 捕获画面渲染 `StreamProvisionalBubble`（含 `● 流式生成中 · 结构化草案`、`正在生成回答...`、`停止生成` 按钮） — 证据：`05-A-typed-ready.png`、`05-A-typed-ready.xml`、`06-A-generating.png`、`06-A-generating.xml` | 达标 |
| 4 | 生成进行中经“会话管理”切到 B 且 B 零污染 | 生成进行中点击顶部“会话”切至列表并打开 B；B 中绝不出现 A 的用户 prompt 或流式正文 | 发送后 +3.976s 点击“会话”打开列表；+7.533s 点击会话 B 进入；在会话 B 中停留并解析 UI XML：`UI TEST`、`budgeting` 等 A 侧文字出现次数严格为 0；会话 B messages=0，generations=0，完全纯净零污染。<br>注意：服务端 generation 在 +6.344s 已 terminal failed，早于进入会话 B（+7.533s），因此离开 A 期间服务端 generation 是否继续执行未获本轮时序有效覆盖 — 证据：`07-conv-list-during-gen.png`、`08-in-conv-B.png`、`12-server-evidence.json` | 有限达标（B 隔离达标，离开不中断未验证） |
| 5 | 返回 A 并对齐同 generation（不创建第二 generation） | 经会话列表切回 A，客户端利用 latest/events 快照对齐同一 generation，不自动新建第二代次 | 在会话 B 停留后，于 +13.359s 打开会话列表，+16.938s 点击切回会话 A；客户端调用 `getLatestGeneration` 获取同一代次 `3da7ef99-f728-40cd-ac6d-cb8824bf7d2b` 并对齐；服务端全局代次数由基线 28 增至 29，无第二 generation 创建。<br>纠正：该代次状态为 `failed`（`ASSISTANT_STREAM_BOUNDS` / `INVALID_ENVELOPE` / 219 字符，非 4000 字符超限，详见 `research/aba-provider-failure.md`），无 message 落库 — 证据：`09-conv-list-before-return-A.png`、`10-back-to-conv-A.png`、`12-server-evidence.json` | 有限达标（单代次对齐达标，模型生成失败） |
| 6 | 会话 A 历史与 Partial 去重无双泡 | 切回 A 后，用户 Prompt 与 Assistant 内容不出现双份复制，气泡原子对齐 | UI 树解析确认：全屏仅包含 1 条用户 Prompt 气泡（非双份），包含 1 条 Assistant 消息容器（呈现已生成的 partial 正文与状态标签），未出现双泡重叠或消息裂开现象 — 证据：`10-back-to-conv-A.xml`、`11-conv-A-terminal-quiescent-3s.xml` | 达标 |
| 7 | 终态后 3.5s 静默期与财务账本计数未变 | 终态达到后等待 3.5 秒无迟到卡片或待确认事项注入；账本记录数未变 | 终态后等待 3.5s 捕获静默态，UI 树节点稳定无新卡片注入；只读查询服务端账本：`transactions` 保持 59，`transfers` 保持 2，`assistant_pending_actions` 保持 11。注意：仅能证明表行数计数未变，未能证明数据行 hash 完全不变 — 证据：`11-conv-A-terminal-quiescent-3s.png`、`11-conv-A-terminal-quiescent-3s.xml`、`13-ledger-counts-final.json` | 有限达标（计数未变，hash 未核） |

## 不达标原因
1. **模型生成代次 `failed`**：代次 `3da7ef99-f728-40cd-ac6d-cb8824bf7d2b` 产出 10 条 text-delta（累计 219 字符）后抛出 `ASSISTANT_STREAM_BOUNDS`（`INVALID_ENVELOPE`），未能成功产出最终 completed 答复。此为 LLM provider envelope 解析失败，非 4000 字符长度限制（详见 `research/aba-provider-failure.md`）。

## 未验证与阻塞项
1. **离开会话 A 期间服务端 generation 持续执行不中断**：由于旧脚本在中间执行了耗时约 2.5~3s 的 uiautomator dump，导致切入会话 B 的时间点（+7.533s）迟于服务端 generation 的 terminal 发生时间（+6.344s），因此旧测试未能有效验证离开会话时服务端是否在生成中继续执行；
2. **账本全量哈希不变性**：当前仅核实了表记录计数（59/2/11）未发生变化，表计数不能等同于全量记录 hash 不变。

## 执行环境与验证记录
- **设备/系统/应用版本**：
  - 设备型号：HUAWEI JER-AN20（序列号 `TNL0220A15028072`）
  - 系统版本：Android 12 (API 31)，屏幕分辨率 1080x2340 @ 480dpi
  - 应用包名：`com.yansuu1.jizhang` v0.1.0(3)
  - 已安装 APK SHA-256：`d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`（基线未重装）
- **服务端运行版本**：
  - 容器镜像：`jizhang:api-chained-choice-20261016T083118Z`
  - 镜像 SHA-256：`sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b`
- **实际执行命令与记录**：
  1. `adb devices -l` 验证设备在线并在前台。
  2. `adb shell sha256sum` 确认已安装 APK SHA-256 为 `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`。
  3. SSH (`~/.ssh/jizhang_deploy` -> `ubuntu@jz.yansuu1.xyz`) 只读查询服务端镜像、基线代次总数（28）与账本基线（59/2/11）。
  4. 手机 UI 真实会话准备：
     - 点击会话管理“新建对话” -> 创建会话 B (`5d65dbf9-6626-4b82-8d07-665761efe093`)；
     - 点击“会话”返回会话列表；
     - 再次点击“新建对话” -> 创建会话 A (`d76d9014-a6c8-4e61-a83c-5286d30e63e1`)。
  5. 手机 UI 测试请求输入与发送：
     - 在会话 A 中输入 150 词只读预算规划 prompt，收起键盘，点击发送；
     - 发送后 +1.0s 捕获会话 A 流式生成态；
     - 在流式进行中（+3.976s）点击顶部“会话”按钮打开会话列表；
     - +7.533s 点击进入会话 B，捕获会话 B 界面并核验零污染；
     - 在会话 B 停留 2.0s，于 +13.359s 再次打开会话列表；
     - +16.938s 点击切回会话 A，捕获切回瞬间 UI；
     - 等待 3.5s 静默期后抓取静默态 UI 与 XML。
  6. SSH 只读查询该代次 `3da7ef99-f728-40cd-ac6d-cb8824bf7d2b` 的完整 events 流水（13 条）、会话 B 消息/代次（均为 0）与账本终态计数（59/2/11）。
- **证据存储位置**：
  `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/conversation-aba/`
  - `00-baseline.png` / `00-baseline.xml`
  - `01-create-conv-B.png`
  - `01-device-identity.txt`
  - `02-conv-list-after-B.png`
  - `02-installed-apk-sha256.txt`
  - `03-create-conv-A.png` / `03-create-conv-A.xml`
  - `03-server-identity.txt`
  - `04-conversation-ids.json`
  - `04-ledger-baseline.json`
  - `05-A-typed-ready.png` / `05-A-typed-ready.xml`
  - `06-A-generating.png` / `06-A-generating.xml`
  - `07-conv-list-during-gen.png` / `07-conv-list-during-gen.xml`
  - `08-in-conv-B.png` / `08-in-conv-B.xml`
  - `09-conv-list-before-return-A.png` / `09-conv-list-before-return-A.xml`
  - `10-back-to-conv-A.png` / `10-back-to-conv-A.xml`
  - `11-conv-A-terminal-quiescent-3s.png` / `11-conv-A-terminal-quiescent-3s.xml`
  - `12-server-evidence.json`
  - `13-ledger-counts-final.json`
  - `progress.log`
  - `cap.sh`
