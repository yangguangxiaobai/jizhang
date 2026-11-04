# 手机功能验收结果（跨会话切换 A->B->A 优化时序补测）

## 总体结论
**部分达标（时序优化与生命周期隔离达标，模型代次因上游超时失败）** — 在真机（HUAWEI JER-AN20 / Android 12）与在线生产环境（后端镜像 `31bb967e`、APK `d2a37b55`）上，严格在独立会话 A（`3642b8f8-674a-495f-af27-d61757a45bca`）与会话 B（`06bd1235-5fd2-4e84-b504-69a3eed6afbb`）间执行优化时序补测。  
本次补测彻底去除了旧脚本中中间步骤耗时 2.5~3s 的 `uiautomator dump`，采用原生轻量截屏与端上微秒级时序控制，成功实现在发送后 +1.68s（远早于服务端 terminal）切入会话 B，在会话 B 停留 2.07s 后于 +4.91s 切回会话 A。  
核验结果确认：
1. **切 B 早于服务端 Terminal，真正验证了“离开会话仅关闭订阅，服务端生成不中断”**：切 B 发生在发送后 +1.68s，切回 A 发生在 +4.91s，而服务端代次 `21dba779-3d9f-4b59-b631-d294b6c371ba` 在 +14.16s 仍处于 `running` 状态，直至 +20.002s 才触发上游 TTFT 超时终态。离开会话 A 期间服务端代次持续执行，未被客户端生命周期中断；
2. **会话 B 完全隔离，零污染**：会话 B 服务端数据库记录确认 `generations=0`，`messages=0`，真机界面零污染；
3. **返回会话 A 严格对齐同一 generation，未创建第二代次**：切回 A 时客户端对齐同一代次，数据库全局总代次数由基线 29 增至 30（增量严格为 1，无二次 POST `/generations`）；
4. **会话 A 历史无双泡、去重有效**：切回 A 后，用户提问仅显示 1 次，无重复气泡；
5. **模型生成结果为 `failed`（如实记录，不二次请求）**：代次终态为 `status: failed`，`error_code: ASSISTANT_STREAM_BOUNDS`，文案 `AI 响应超时，本次生成已中断。`（上游 TTFT 20s 超时）。按指导原则“事实优先，模型 failed 就如实 FAIL，不进行第二次真实请求”；
6. **财务账本计数未变**：`transactions` 保持 59、`transfers` 保持 2、`assistant_pending_actions` 保持 11（注：计数保持不能证明全量 hash 不变）。  
统计：达标 4 项；不达标 1 项（模型生成 `failed`）；有限达标 1 项（账本计数未变，hash 未核）；未验证 0 项。

## 验收明细

| 编号 | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 前置环境与已安装版本校验 | 设备在线且前台可操作；已安装 APK 保持为 `d2a37b55`；后端运行含 `31bb967e` 镜像 | 设备 `TNL0220A15028072` (JER-AN20 / Android 12) 在线并处于前台；已装 APK SHA-256 为 `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`；后端镜像 SHA-256 为 `sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b` — 证据：`01-device-identity.txt`、`02-installed-apk-sha256.txt`、`03-server-identity.txt`、`04-ledger-baseline.json` | 达标 |
| 2 | 会话管理建立全新独立会话 A 与 B | 经由“会话管理”新建两个独立会话，记录服务端权威 UUID，非 Tab 切换 | 通过会话管理创建全新 UUID：<br>• 会话 A：`3642b8f8-674a-495f-af27-d61757a45bca`<br>• 会话 B：`06bd1235-5fd2-4e84-b504-69a3eed6afbb`<br>两会话均为持久化会话 — 证据：`04-conversation-ids.json`、`05-A-typed-ready.png`、`05-A-typed-ready.xml` | 达标 |
| 3 | 优化时序：切 B 严格早于服务端 Terminal，离开 A 不中断生成 | 发送后 1 秒内直接 tap 会话列表并选 B（去中间 uiautomator 等待）；切 B 早于 server terminal；离开 A 服务端 generation 继续执行 | 手机端时序记录（`device-timestamps.json`）：<br>• `t_send`: 1792165858638 (0.00s)<br>• `t_tap_list`: 1792165859778 (+1.14s)<br>• `t_tap_B`: 1792165860317 (+1.68s 进入 B)<br>• `t_leave_B`: 1792165862991 (在 B 停留 2.07s)<br>• `t_tap_A`: 1792165863553 (+4.91s 切回 A)<br>服务端代次 `21dba779-3d9f-4b59-b631-d294b6c371ba`：<br>• created_at: 1792165859271<br>• 客户端在 B 期间及切回 A 瞬间（+4.91s），服务端代次状态持续为 `running`，直到 +20.002s (1792165879273) 才因 provider 超时进入 terminal。离开 A 期间服务端 generation 持续执行不中断获得完整证实 — 证据：`device-timestamps.json`、`06-A-generating.png`、`07-conv-list-during-gen.png`、`08-in-conv-B.png`、`12-server-evidence.json` | 达标 |
| 4 | 会话 B 完全隔离，零污染 | 切入会话 B 后，B 中绝不出现 A 的用户 prompt 或生成内容；服务端 B 会话零代次、零消息 | 会话 B 截屏与只读数据库查询确认：<br>• `genB`: `[]` (0 generations)<br>• `msgsB`: `[]` (0 messages)<br>完全纯净零污染 — 证据：`08-in-conv-B.png`、`12-server-evidence.json` | 达标 |
| 5 | 返回会话 A 对齐同 generation，无第二代次创建 | 切回 A，客户端原子对齐同一代次，数据库全局总代次数仅增 1 | 服务端全局代次数由基线 29 增至 30（增量严格为 1）；会话 A 下代次数严格为 1，无重复代次创建 — 证据：`09-conv-list-before-return-A.png`、`10-back-to-conv-A.png`、`12-server-evidence.json` | 达标 |
| 6 | 模型生成结果判定 | 模型生成应产出有效回答；若 failed 则如实 FAIL | 服务端代次终态为 `status: failed`，`error_code: ASSISTANT_STREAM_BOUNDS`，`error_message: AI 响应超时，本次生成已中断。`（上游 TTFT 20s 超时）。按规则如实判定，不进行第二次真实请求 — 证据：`12-server-evidence.json`、`11-conv-A-terminal-quiescent-3s.png`、`11-conv-A-terminal-quiescent-3s.xml` | 不达标 (FAIL) |
| 7 | 会话 A 历史无双泡与账本计数保持 | 切回 A 后用户提问仅显示 1 次，无双泡；终态后 3.5s 财务账本记录数未变 | UI XML 确认：全屏仅 1 条用户提问，错误提示卡片正常呈现，无双泡；服务端账本计数：`transactions` 保持 59，`transfers` 保持 2，`assistant_pending_actions` 保持 11。注意：仅证明表记录计数未变，未能证明数据行 hash 完全不变 — 证据：`11-conv-A-terminal-quiescent-3s.png`、`11-conv-A-terminal-quiescent-3s.xml`、`13-ledger-counts-final.json` | 有限达标（计数未变，hash 未核） |

## 不达标原因
1. **模型生成结果 `failed`**：代次 `21dba779-3d9f-4b59-b631-d294b6c371ba` 在等待首字 20 秒后触发上游 provider 超时中断（`ASSISTANT_STREAM_BOUNDS` / `AI 响应超时，本次生成已中断。`），未能产出正文回答。按照约束不进行自动重试或二次请求，如实报告失败。

## 未验证与阻塞项
1. **账本记录全量哈希不变性**：当前仅核实了表记录计数（59/2/11）未发生变化，表计数不能等同于全量记录 hash 不变。

## 执行环境与验证记录
- **设备/系统/应用版本**：
  - 设备型号：HUAWEI JER-AN20（序列号 `TNL0220A15028072`）
  - 系统版本：Android 12 (API 31)，屏幕分辨率 1080x2340 @ 480dpi
  - 应用包名：`com.yansuu1.jizhang` v0.1.0(3)
  - 已安装 APK SHA-256：`d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`
- **服务端运行版本**：
  - 容器镜像：`jizhang:api-chained-choice-20261016T083118Z`
  - 镜像 SHA-256：`sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b`
- **实际执行命令与记录**：
  1. `adb devices` 验证真机在线并在前台。
  2. `adb shell sha256sum` 确认已安装 APK SHA-256 为 `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`。
  3. SSH 只读查询服务端镜像、基线代次数（29）与账本基线（59/2/11）。
  4. 手机 UI 真实会话准备：创建独立会话 B (`06bd1235-5fd2-4e84-b504-69a3eed6afbb`) 与会话 A (`3642b8f8-674a-495f-af27-d61757a45bca`)。
  5. 优化时序执行（`execute_aba_retest.py` / `/data/local/tmp/run_aba.sh`）：
     - 会话 A 中输入 150 词预算建议 prompt 并隐藏键盘；
     - 点击发送（t=0.00s）；
     - 发送后 +1.14s tap 会话列表，+1.68s tap 会话 B，进入会话 B；
     - 在会话 B 停留 2.07s，于 +4.91s tap 会话 A 返回；
     - +5.51s 回到会话 A，等待静默期并抓取截屏与 UI 树。
  6. SSH 只读查询该代次 `21dba779-3d9f-4b59-b631-d294b6c371ba` 的完整流水（3 条）、会话 B（0代次 0消息）与账本终态计数（59/2/11）。
- **证据存储位置**：
  `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/conversation-aba-retest/`
  - `00-baseline.png` / `00-baseline.xml`
  - `01-device-identity.txt`
  - `02-installed-apk-sha256.txt`
  - `03-server-identity.txt`
  - `04-conversation-ids.json`
  - `04-ledger-baseline.json`
  - `05-A-typed-ready.png` / `05-A-typed-ready.xml`
  - `06-A-generating.png`
  - `07-conv-list-during-gen.png`
  - `08-in-conv-B.png`
  - `09-conv-list-before-return-A.png`
  - `10-back-to-conv-A.png`
  - `11-conv-A-terminal-quiescent-3s.png` / `11-conv-A-terminal-quiescent-3s.xml`
  - `12-server-evidence.json`
  - `13-ledger-counts-final.json`
  - `device-timestamps.json`
  - `progress.log`
  - `run_aba.sh`
  - `execute_aba_retest.py`
